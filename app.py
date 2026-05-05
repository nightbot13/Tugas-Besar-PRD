"""
app.py — SIX Parkir ANPR Backend
=================================
Flask + Flask-SocketIO backend untuk:
  - Manajemen database SQLite (registered_vehicles, parking_sessions, system_logs)
  - API pendaftaran kendaraan user
  - Penerimaan data deteksi dari ANPR scanner (anpr_scanner.py)
  - Pengiriman real-time via Socket.IO ke browser user
  - Routing privasi: hanya plat milik user yang dikirim ke user tsb

Install:
    pip install flask flask-socketio flask-cors eventlet

Jalankan:
    python app.py
"""

import sqlite3
import hashlib
import os
import time
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, session, g
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
DATABASE = "parkir_six.db"
SECRET_KEY = os.environ.get("SECRET_KEY", "six-parkir-secret-2026")
ANPR_API_KEY = os.environ.get("ANPR_API_KEY", "anpr-internal-key-itb")  # key dari scanner

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")


# ─────────────────────────────────────────
# DATABASE SETUP
# ─────────────────────────────────────────
SCHEMA = """
-- Tabel pengguna (simulasi, di produksi ikut SSO ITB)
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nim         TEXT    UNIQUE NOT NULL,          -- NIM / ID user
    name        TEXT    NOT NULL,
    password_hash TEXT  NOT NULL,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
);

-- Kendaraan yang didaftarkan oleh user
CREATE TABLE IF NOT EXISTS registered_vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    plate       TEXT    NOT NULL,                 -- format: D1234ITB (tanpa spasi, uppercase)
    plate_display TEXT  NOT NULL,                 -- format tampil: D 1234 ITB
    jenis       TEXT    NOT NULL DEFAULT 'Motor', -- Motor | Mobil
    model       TEXT,                             -- merek/model kendaraan
    ewallet_primary   TEXT,                       -- GoPay | OVO | Dana | ShopeePay
    ewallet_secondary TEXT,
    ewallet_balance   INTEGER DEFAULT 0,          -- saldo dalam Rp (simulasi)
    status      TEXT    DEFAULT 'aktif',          -- aktif | nonaktif | diblokir
    anpr_verified INTEGER DEFAULT 0,              -- 1 jika ANPR sudah mencocokkan 1x
    created_at  TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, plate)
);

-- Sesi parkir aktif & selesai
CREATE TABLE IF NOT EXISTS parking_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    plate           TEXT    NOT NULL,
    plate_display   TEXT    NOT NULL,
    user_id         INTEGER REFERENCES users(id),  -- NULL jika tamu
    jenis           TEXT    NOT NULL DEFAULT 'Motor',
    lokasi          TEXT    DEFAULT 'Parkir Mahasiswa',
    masuk_at        TEXT    NOT NULL,
    keluar_at       TEXT,
    durasi_menit    INTEGER,
    biaya           INTEGER DEFAULT 0,
    metode_bayar    TEXT,                          -- autodebit | qris | cash | tamu_manual
    status          TEXT    DEFAULT 'aktif',       -- aktif | selesai
    is_registered   INTEGER DEFAULT 0,             -- 1 = terdaftar, 0 = tamu
    confidence      REAL    DEFAULT 0,
    foto_masuk      TEXT,                          -- path/URL foto
    foto_keluar     TEXT,
    notes           TEXT
);

-- Log sistem (untuk semua deteksi, termasuk tamu — hanya untuk audit internal)
CREATE TABLE IF NOT EXISTS system_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT    NOT NULL,  -- DETECTION | GATE_OPEN | GATE_CLOSE | REGISTER | ERROR
    plate       TEXT,
    plate_display TEXT,
    user_id     INTEGER,
    is_registered INTEGER DEFAULT 0,
    confidence  REAL,
    details     TEXT,              -- JSON string
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(e=None):
    db = g.pop("db", None)
    if db:
        db.close()


def init_db():
    with app.app_context():
        db = sqlite3.connect(DATABASE)
        db.executescript(SCHEMA)
        # Seed user demo jika belum ada
        cur = db.execute("SELECT id FROM users WHERE nim='13522001'")
        if not cur.fetchone():
            pw = hashlib.sha256("password123".encode()).hexdigest()
            db.execute(
                "INSERT INTO users (nim, name, password_hash) VALUES (?,?,?)",
                ("13522001", "Muhammad Abduh", pw),
            )
            db.execute(
                """INSERT INTO registered_vehicles
                   (user_id, plate, plate_display, jenis, model, ewallet_primary, ewallet_balance, status, anpr_verified)
                   VALUES (1,'D4321ITB','D 4321 ITB','Motor','Honda Beat','GoPay',85000,'aktif',1)"""
            )
            db.execute(
                """INSERT INTO registered_vehicles
                   (user_id, plate, plate_display, jenis, model, status)
                   VALUES (1,'D9876KW','D 9876 KW','Motor','Yamaha NMAX','aktif')"""
            )
        db.commit()
        db.close()
    print("[DB] Database siap:", DATABASE)


def normalize_plate(p: str) -> str:
    """Hapus spasi dan uppercase: 'D 4321 ITB' → 'D4321ITB'"""
    return p.upper().replace(" ", "")


def log_event(event_type, plate=None, plate_display=None, user_id=None,
              is_registered=0, confidence=0, details=None):
    db = get_db()
    db.execute(
        """INSERT INTO system_logs
           (event_type, plate, plate_display, user_id, is_registered, confidence, details)
           VALUES (?,?,?,?,?,?,?)""",
        (event_type, plate, plate_display, user_id, is_registered,
         confidence, str(details) if details else None),
    )
    db.commit()


# ─────────────────────────────────────────
# AUTH HELPERS (simple session-based)
# ─────────────────────────────────────────
def require_login(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Belum login"}), 401
        return f(*args, **kwargs)
    return wrapped


def require_anpr_key(f):
    """Middleware untuk endpoint yang dipanggil oleh ANPR scanner (bukan browser)."""
    @wraps(f)
    def wrapped(*args, **kwargs):
        key = request.headers.get("X-ANPR-Key") or request.json.get("api_key", "")
        if key != ANPR_API_KEY:
            return jsonify({"error": "Unauthorized ANPR key"}), 403
        return f(*args, **kwargs)
    return wrapped


# ─────────────────────────────────────────
# AUTH ROUTES
# ─────────────────────────────────────────
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    nim = data.get("nim", "").strip()
    pw = hashlib.sha256(data.get("password", "").encode()).hexdigest()
    db = get_db()
    user = db.execute(
        "SELECT * FROM users WHERE nim=? AND password_hash=?", (nim, pw)
    ).fetchone()
    if not user:
        return jsonify({"error": "NIM atau password salah"}), 401
    session["user_id"] = user["id"]
    session["user_name"] = user["name"]
    session["user_nim"] = user["nim"]
    return jsonify({"ok": True, "name": user["name"], "nim": user["nim"]})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
@require_login
def me():
    return jsonify({"user_id": session["user_id"], "name": session["user_name"], "nim": session["user_nim"]})


# ─────────────────────────────────────────
# VEHICLE MANAGEMENT ROUTES
# ─────────────────────────────────────────
@app.route("/api/vehicles", methods=["GET"])
@require_login
def list_vehicles():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM registered_vehicles WHERE user_id=? ORDER BY created_at",
        (session["user_id"],),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/vehicles", methods=["POST"])
@require_login
def register_vehicle():
    data = request.json or {}
    plate_display = data.get("plate_display", "").strip().upper()
    jenis = data.get("jenis", "Motor")
    model = data.get("model", "").strip()

    if not plate_display or not model:
        return jsonify({"error": "Plat nomor dan model wajib diisi"}), 400

    plate = normalize_plate(plate_display)
    db = get_db()

    # Cek duplikat untuk user ini
    existing = db.execute(
        "SELECT id FROM registered_vehicles WHERE user_id=? AND plate=?",
        (session["user_id"], plate),
    ).fetchone()
    if existing:
        return jsonify({"error": "Plat nomor sudah terdaftar di akun Anda"}), 409

    db.execute(
        """INSERT INTO registered_vehicles (user_id, plate, plate_display, jenis, model)
           VALUES (?,?,?,?,?)""",
        (session["user_id"], plate, plate_display, jenis, model),
    )
    db.commit()
    log_event("REGISTER", plate=plate, plate_display=plate_display,
              user_id=session["user_id"], is_registered=1)
    return jsonify({"ok": True, "plate": plate_display, "message": f"{plate_display} berhasil didaftarkan"})


@app.route("/api/vehicles/<int:vid>", methods=["DELETE"])
@require_login
def delete_vehicle(vid):
    db = get_db()
    row = db.execute(
        "SELECT * FROM registered_vehicles WHERE id=? AND user_id=?",
        (vid, session["user_id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Kendaraan tidak ditemukan"}), 404
    db.execute("UPDATE registered_vehicles SET status='nonaktif' WHERE id=?", (vid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/vehicles/<int:vid>/ewallet", methods=["POST"])
@require_login
def update_ewallet(vid):
    data = request.json or {}
    db = get_db()
    db.execute(
        """UPDATE registered_vehicles
           SET ewallet_primary=?, ewallet_secondary=?, ewallet_balance=?
           WHERE id=? AND user_id=?""",
        (data.get("primary"), data.get("secondary"), data.get("balance", 0),
         vid, session["user_id"]),
    )
    db.commit()
    return jsonify({"ok": True})


# ─────────────────────────────────────────
# PARKING STATUS ROUTES (hanya milik user)
# ─────────────────────────────────────────
@app.route("/api/parking/active")
@require_login
def active_parking():
    """Hanya kembalikan sesi parkir aktif milik user ini."""
    db = get_db()
    rows = db.execute(
        """SELECT ps.*, rv.model, rv.jenis, rv.ewallet_primary
           FROM parking_sessions ps
           LEFT JOIN registered_vehicles rv ON rv.plate = ps.plate AND rv.user_id = ?
           WHERE ps.user_id=? AND ps.status='aktif'
           ORDER BY ps.masuk_at DESC""",
        (session["user_id"], session["user_id"]),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/parking/history")
@require_login
def parking_history():
    """Riwayat parkir hanya milik user ini."""
    db = get_db()
    rows = db.execute(
        """SELECT * FROM parking_sessions
           WHERE user_id=? ORDER BY masuk_at DESC LIMIT 50""",
        (session["user_id"],),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ─────────────────────────────────────────
# *** ANPR DETECTION ENDPOINT ***
# Dipanggil oleh anpr_scanner.py, BUKAN browser
# ─────────────────────────────────────────
@app.route("/api/anpr/detection", methods=["POST"])
@require_anpr_key
def anpr_detection():
    """
    Endpoint utama yang dipanggil ANPR scanner setiap deteksi plat.
    
    Body JSON:
        plate_raw   : string plat dari OCR (tanpa format, e.g. 'D4321ITB')
        confidence  : float 0-100
        gate_id     : string ID gerbang (e.g. 'GATE_MAHASISWA_MASUK')
        direction   : 'masuk' | 'keluar'
        foto_path   : path foto (opsional)
    
    Logika privasi:
        - Jika plat TERDAFTAR → emit ke room user via Socket.IO + buka gate
        - Jika plat TIDAK TERDAFTAR (tamu) → catat ke system_logs saja, 
          TIDAK emit ke room user manapun, tetap buka gate (mode tamu)
    """
    data = request.json or {}
    plate_raw   = normalize_plate(data.get("plate_raw", ""))
    confidence  = float(data.get("confidence", 0))
    gate_id     = data.get("gate_id", "UNKNOWN")
    direction   = data.get("direction", "masuk")
    foto_path   = data.get("foto_path", "")

    if not plate_raw:
        return jsonify({"error": "plate_raw kosong"}), 400

    db = get_db()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ── Cek apakah plat terdaftar ──
    vehicle = db.execute(
        """SELECT rv.*, u.name as user_name, u.nim
           FROM registered_vehicles rv
           JOIN users u ON u.id = rv.user_id
           WHERE rv.plate=? AND rv.status='aktif'""",
        (plate_raw,),
    ).fetchone()

    if vehicle:
        # ════════════════════════════════
        # PLAT TERDAFTAR — User SIX
        # ════════════════════════════════
        user_id = vehicle["user_id"]
        plate_display = vehicle["plate_display"]
        is_registered = 1

        if direction == "masuk":
            # Buat sesi parkir baru
            db.execute(
                """INSERT INTO parking_sessions
                   (plate, plate_display, user_id, jenis, masuk_at, status,
                    is_registered, confidence, foto_masuk, lokasi)
                   VALUES (?,?,?,?,?,'aktif',1,?,?,?)""",
                (plate_raw, plate_display, user_id, vehicle["jenis"],
                 now_str, confidence, foto_path, gate_id),
            )
            db.commit()

            session_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

            # Tandai ANPR terverifikasi
            db.execute(
                "UPDATE registered_vehicles SET anpr_verified=1 WHERE id=?",
                (vehicle["id"],),
            )
            db.commit()

            # Autodebit info
            has_ewallet = bool(vehicle["ewallet_primary"])
            autodebit_info = "Autodebit Aktif" if has_ewallet else "Bayar Manual saat Keluar"

            # ── Emit HANYA ke room user pemilik plat ──
            socketio.emit("parking_masuk", {
                "session_id"    : session_id,
                "plate"         : plate_display,
                "plate_raw"     : plate_raw,
                "jenis"         : vehicle["jenis"],
                "model"         : vehicle["model"],
                "masuk_at"      : now_str,
                "gate"          : gate_id,
                "confidence"    : round(confidence, 1),
                "autodebit"     : has_ewallet,
                "autodebit_info": autodebit_info,
                "ewallet"       : vehicle["ewallet_primary"] or "—",
                "status"        : "Parkir Aktif",
                "is_registered" : True,
            }, room=f"user_{user_id}")

            log_event("DETECTION", plate=plate_raw, plate_display=plate_display,
                      user_id=user_id, is_registered=1, confidence=confidence,
                      details={"direction": "masuk", "gate": gate_id, "session_id": session_id})

            # Kirim sinyal ke Arduino: buka gerbang (registered)
            _trigger_gate(gate_id, "OPEN_REGISTERED", plate_display)

            return jsonify({
                "status"    : "registered",
                "action"    : "GATE_OPEN",
                "user"      : vehicle["user_name"],
                "plate"     : plate_display,
                "autodebit" : has_ewallet,
                "session_id": session_id,
            })

        else:  # direction == 'keluar'
            # Cari sesi aktif
            active = db.execute(
                """SELECT * FROM parking_sessions
                   WHERE plate=? AND user_id=? AND status='aktif'
                   ORDER BY masuk_at DESC LIMIT 1""",
                (plate_raw, user_id),
            ).fetchone()

            if active:
                masuk_dt = datetime.strptime(active["masuk_at"], "%Y-%m-%d %H:%M:%S")
                durasi_menit = max(1, int((datetime.now() - masuk_dt).total_seconds() / 60))
                jam = (durasi_menit + 59) // 60

                # Hitung biaya
                if vehicle["jenis"] == "Motor":
                    biaya = min(1000 + (jam - 1) * 1000, 2000)
                else:
                    biaya = min(2000 + (jam - 1) * 1000, 10000)

                # Proses autodebit jika ada ewallet
                metode = "tamu_manual"
                if vehicle["ewallet_primary"]:
                    saldo = vehicle["ewallet_balance"] or 0
                    if saldo >= biaya:
                        db.execute(
                            "UPDATE registered_vehicles SET ewallet_balance=ewallet_balance-? WHERE id=?",
                            (biaya, vehicle["id"]),
                        )
                        metode = "autodebit"
                    else:
                        metode = "qris"  # saldo tidak cukup, bayar manual

                db.execute(
                    """UPDATE parking_sessions
                       SET keluar_at=?, durasi_menit=?, biaya=?, metode_bayar=?,
                           status='selesai', foto_keluar=?
                       WHERE id=?""",
                    (now_str, durasi_menit, biaya, metode, foto_path, active["id"]),
                )
                db.commit()

                # Emit keluar ke user
                socketio.emit("parking_keluar", {
                    "session_id"   : active["id"],
                    "plate"        : plate_display,
                    "jenis"        : vehicle["jenis"],
                    "masuk_at"     : active["masuk_at"],
                    "keluar_at"    : now_str,
                    "durasi_menit" : durasi_menit,
                    "biaya"        : biaya,
                    "metode"       : metode,
                    "gate"         : gate_id,
                    "confidence"   : round(confidence, 1),
                }, room=f"user_{user_id}")

                log_event("DETECTION", plate=plate_raw, plate_display=plate_display,
                          user_id=user_id, is_registered=1, confidence=confidence,
                          details={"direction": "keluar", "biaya": biaya, "metode": metode})

                _trigger_gate(gate_id, "OPEN_REGISTERED", plate_display)

                return jsonify({
                    "status"      : "registered",
                    "action"      : "GATE_OPEN",
                    "plate"       : plate_display,
                    "biaya"       : biaya,
                    "metode"      : metode,
                    "durasi_menit": durasi_menit,
                })

    # ════════════════════════════════════
    # PLAT TIDAK TERDAFTAR — Mode Tamu
    # ════════════════════════════════════
    # PENTING: Data ini TIDAK dikirim ke room user manapun.
    # Hanya dicatat ke system_logs untuk audit internal.

    # Format display terbaik yang bisa kita buat dari raw
    plate_display_tamu = _format_plate_display(plate_raw)

    if direction == "masuk":
        # Catat sesi tamu
        db.execute(
            """INSERT INTO parking_sessions
               (plate, plate_display, user_id, jenis, masuk_at, status,
                is_registered, confidence, foto_masuk, lokasi, metode_bayar, notes)
               VALUES (?,?,NULL,'Motor',?,'aktif',0,?,?,'Tamu',NULL,'Tamu — bayar manual')""",
            (plate_raw, plate_display_tamu, now_str, confidence, foto_path),
        )
        db.commit()
        session_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    else:
        session_id = None
        tamu_session = db.execute(
            """SELECT * FROM parking_sessions
               WHERE plate=? AND is_registered=0 AND status='aktif'
               ORDER BY masuk_at DESC LIMIT 1""",
            (plate_raw,),
        ).fetchone()
        if tamu_session:
            masuk_dt = datetime.strptime(tamu_session["masuk_at"], "%Y-%m-%d %H:%M:%S")
            durasi_menit = max(1, int((datetime.now() - masuk_dt).total_seconds() / 60))
            db.execute(
                """UPDATE parking_sessions
                   SET keluar_at=?, durasi_menit=?, status='selesai',
                       metode_bayar='tamu_manual', foto_keluar=?
                   WHERE id=?""",
                (now_str, durasi_menit, foto_path, tamu_session["id"]),
            )
            db.commit()
            session_id = tamu_session["id"]

    # Log ke system_logs — HANYA untuk audit, tidak expose ke user
    log_event("DETECTION", plate=plate_raw, plate_display=plate_display_tamu,
              user_id=None, is_registered=0, confidence=confidence,
              details={
                  "direction": direction,
                  "gate": gate_id,
                  "mode": "TAMU",
                  "session_id": session_id,
                  "note": "Data tidak dikirim ke dashboard user — privasi tamu"
              })

    # Tetap buka gate mode tamu
    _trigger_gate(gate_id, "OPEN_GUEST", plate_display_tamu)

    return jsonify({
        "status"    : "guest",
        "action"    : "GATE_OPEN",
        "plate"     : plate_display_tamu,
        "note"      : "Tamu — data tidak dikirim ke dashboard user",
        "session_id": session_id,
    })


def _format_plate_display(raw: str) -> str:
    """Coba format 'D4321ITB' → 'D 4321 ITB' untuk tampilan."""
    import re
    m = re.match(r'^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$', raw)
    if m:
        return f"{m.group(1)} {m.group(2)} {m.group(3)}"
    return raw


def _trigger_gate(gate_id: str, command: str, plate: str):
    """
    Kirim sinyal ke Flask route yang mengirim via Serial ke Arduino.
    Di setup produksi, ini bisa memanggil endpoint lokal atau langsung Serial.
    """
    # Emit ke Socket.IO room 'gates' untuk monitoring
    socketio.emit("gate_event", {
        "gate_id" : gate_id,
        "command" : command,
        "plate"   : plate,
        "ts"      : datetime.now().strftime("%H:%M:%S"),
    }, room="gates")


# ─────────────────────────────────────────
# ADMIN / INTERNAL ROUTES
# ─────────────────────────────────────────
@app.route("/api/admin/logs")
@require_anpr_key
def admin_logs():
    """Audit log — hanya untuk sistem internal, tidak expose ke browser user."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/all_sessions")
@require_anpr_key
def admin_sessions():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM parking_sessions ORDER BY masuk_at DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ─────────────────────────────────────────
# SOCKET.IO EVENTS
# ─────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    print(f"[WS] Client terhubung: {request.sid}")


@socketio.on("disconnect")
def on_disconnect():
    print(f"[WS] Client disconnect: {request.sid}")


@socketio.on("join_user_room")
def on_join_user(data):
    """
    Browser user bergabung ke room privat mereka.
    Room ID: 'user_{user_id}'
    Hanya event parkir milik user ini yang akan diterima.
    """
    user_id = data.get("user_id")
    token   = data.get("token")  # bisa dikembangkan jadi JWT
    if user_id:
        room = f"user_{user_id}"
        join_room(room)
        print(f"[WS] User {user_id} join room: {room}")
        emit("room_joined", {"room": room, "user_id": user_id})


@socketio.on("join_gates_room")
def on_join_gates(data):
    """Operator monitoring bergabung ke room gates."""
    join_room("gates")
    emit("room_joined", {"room": "gates"})


@socketio.on("leave_room")
def on_leave(data):
    leave_room(data.get("room", ""))


# ─────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print("=" * 55)
    print("  SIX Parkir ANPR — Flask Backend")
    print("  HTTP  : http://localhost:5000")
    print("  Socket: ws://localhost:5000")
    print("=" * 55)
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
