"""
anpr_scanner.py — ANPR Scanner dengan Integrasi Backend
=========================================================
Modifikasi dari ANPR-rendy.py oleh Rendy.

Tambahan:
  - Cek plat ke API Flask (registered_vehicles)
  - Kirim sinyal Serial ke Arduino berdasarkan status
  - History stabilizer (voting 10 frame)
  - Confidence estimasi dari ukuran bbox + regex

Install:
    pip install requests pyserial ultralytics fast-plate-ocr opencv-python

Jalankan setelah app.py aktif:
    python anpr_scanner.py
"""

import re
import time
import threading
import requests
import serial
import serial.tools.list_ports
from collections import Counter, deque
from datetime import datetime

import cv2
from fast_plate_ocr import LicensePlateRecognizer
from ultralytics import YOLO

# =========================
# CONFIG
# =========================
FLASK_BASE_URL  = "http://localhost:5000"
ANPR_API_KEY    = "anpr-internal-key-itb"   # harus sama dengan app.py
GATE_ID         = "PARKIR_MAHASISWA_MASUK"  # ID gerbang ini
DIRECTION       = "masuk"                   # 'masuk' atau 'keluar'
CAMERA_INDEX    = 0                         # 0 = default, 1 = DroidCam
CONF_THRESHOLD  = 0.50                      # YOLO threshold
HISTORY_SIZE    = 10
STABLE_MIN      = 5          # frame minimal sebelum plat dianggap stabil
SEND_COOLDOWN   = 5.0        # jeda (detik) sebelum plat sama dikirim ulang

# Arduino Serial
ARDUINO_PORT    = None       # None = auto-detect; atau isi manual: 'COM3' / '/dev/ttyUSB0'
ARDUINO_BAUD    = 9600
ARDUINO_ENABLED = True       # Set False jika tidak ada Arduino

# =========================
# YOLO MODEL
# =========================
print("[INIT] Loading YOLO model...")
yolo = YOLO(
    "https://huggingface.co/wuriyanto/yolo8-indonesian-license-plate-detection/resolve/main/model.pt"
)

# =========================
# FAST OCR MODEL
# =========================
print("[INIT] Loading OCR model...")
ocr_model = LicensePlateRecognizer("cct-s-v2-global-model")

# =========================
# REGEX PLAT INDO
# =========================
pattern = re.compile(r"^[A-Z]{1,2}\d{1,4}[A-Z]{1,3}$")

# =========================
# STATE
# =========================
history         = deque(maxlen=HISTORY_SIZE)
last_sent_plate = None
last_sent_time  = 0
arduino_conn    = None

# =========================
# ARDUINO SERIAL SETUP
# =========================
def find_arduino_port():
    """Auto-detect port Arduino."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        if "Arduino" in (p.description or "") or "CH340" in (p.description or "") \
                or "ttyUSB" in p.device or "ttyACM" in p.device:
            return p.device
    return None


def init_arduino():
    global arduino_conn
    if not ARDUINO_ENABLED:
        print("[ARDUINO] Disabled — skip init")
        return

    port = ARDUINO_PORT or find_arduino_port()
    if not port:
        print("[ARDUINO] ⚠️  Tidak ditemukan — sinyal gate dinonaktifkan")
        return
    try:
        arduino_conn = serial.Serial(port, ARDUINO_BAUD, timeout=1)
        time.sleep(2)  # tunggu Arduino reset
        print(f"[ARDUINO] Terhubung di {port} @ {ARDUINO_BAUD} baud")
    except Exception as e:
        print(f"[ARDUINO] Gagal terhubung: {e}")
        arduino_conn = None


def send_arduino(command: str):
    """
    Kirim 1 karakter ke Arduino:
        'O' = OPEN (buka servo 90°)
        'C' = CLOSE (tutup servo 0°) — opsional, Arduino otomatis tutup
        'R' = REGISTERED (LED hijau)
        'G' = GUEST (LED kuning)
    """
    if arduino_conn and arduino_conn.is_open:
        try:
            arduino_conn.write(command.encode())
            arduino_conn.flush()
            print(f"[ARDUINO] Kirim: '{command}'")
        except Exception as e:
            print(f"[ARDUINO] Error kirim: {e}")
    else:
        print(f"[ARDUINO] (Offline) Sinyal yang harusnya dikirim: '{command}'")


# =========================
# FLASK API
# =========================
HEADERS = {
    "Content-Type" : "application/json",
    "X-ANPR-Key"   : ANPR_API_KEY,
}


def report_detection(plate_raw: str, confidence: float, direction: str = DIRECTION):
    """
    Kirim deteksi plat ke app.py.
    app.py yang menentukan: terdaftar / tamu, dan emit Socket.IO ke user yang benar.
    """
    payload = {
        "plate_raw"  : plate_raw,
        "confidence" : confidence,
        "gate_id"    : GATE_ID,
        "direction"  : direction,
        "foto_path"  : "",
        "api_key"    : ANPR_API_KEY,
    }
    try:
        resp = requests.post(
            f"{FLASK_BASE_URL}/api/anpr/detection",
            json=payload,
            headers=HEADERS,
            timeout=3,
        )
        result = resp.json()
        status = result.get("status", "unknown")
        action = result.get("action", "—")

        print(f"[API] Plat: {plate_raw} | Status: {status} | Aksi: {action}")

        if action == "GATE_OPEN":
            if status == "registered":
                # Kendaraan terdaftar → LED hijau + buka servo
                send_arduino("R")   # LED Registered
                time.sleep(0.1)
                send_arduino("O")   # Open servo
                print(f"[GATE] ✅ Terdaftar — Buka gerbang ({plate_raw})")
            elif status == "guest":
                # Tamu → LED kuning + buka servo (bayar manual)
                send_arduino("G")   # LED Guest
                time.sleep(0.1)
                send_arduino("O")   # Open servo
                print(f"[GATE] 🟡 Tamu — Buka gerbang mode tamu ({plate_raw})")
        return result

    except requests.exceptions.ConnectionError:
        print(f"[API] ⚠️  Flask server tidak aktif — buka gate default (safety open)")
        send_arduino("O")  # Safety: tetap buka jika server mati
        return {"status": "error", "action": "GATE_OPEN_SAFETY"}
    except Exception as e:
        print(f"[API] Error: {e}")
        return {"status": "error"}


# =========================
# ESTIMATE CONFIDENCE
# =========================
def estimate_conf(plate_img, text: str) -> float:
    h, w = plate_img.shape[:2]
    # Skor ukuran: plat ideal 200x60 px
    size_score = min(100.0, (w * h) / (200 * 60) * 100)
    # Skor regex validasi format plat Indonesia
    regex_score = 100.0 if pattern.match(text) else 55.0
    # Skor panjang karakter plat
    len_score = 100.0 if 5 <= len(text) <= 10 else 60.0
    return round(size_score * 0.3 + regex_score * 0.5 + len_score * 0.2, 1)


# =========================
# DRAW HUD
# =========================
def draw_hud(frame, plate_raw, conf, status):
    h, w = frame.shape[:2]
    color_map = {
        "registered": (0, 220, 80),   # hijau
        "guest"     : (0, 165, 255),  # oranye
        "waiting"   : (180, 180, 180), # abu
        "error"     : (0, 0, 220),    # merah
    }
    color = color_map.get(status, (180, 180, 180))

    # Bar bawah
    cv2.rectangle(frame, (0, h - 60), (w, h), (20, 20, 20), -1)
    cv2.putText(frame, f"Plat: {plate_raw or '—'}",
                (14, h - 35), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
    cv2.putText(frame, f"Conf: {conf:.1f}% | Gate: {GATE_ID} | {DIRECTION.upper()}",
                (14, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (200, 200, 200), 1)
    # Status pojok kanan
    label = {"registered": "TERDAFTAR", "guest": "TAMU", "waiting": "MENUNGGU", "error": "ERROR"}.get(status, "")
    cv2.putText(frame, label, (w - 160, h - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    # Timestamp
    ts = datetime.now().strftime("%H:%M:%S")
    cv2.putText(frame, ts, (w - 100, 26),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1)


# =========================
# MAIN CAMERA LOOP
# =========================
def main():
    global last_sent_plate, last_sent_time, history

    init_arduino()

    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    cv2.namedWindow("SIX ANPR — Tekan ESC untuk keluar", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("SIX ANPR — Tekan ESC untuk keluar", 1280, 720)

    print(f"[CAM] Kamera aktif. GATE: {GATE_ID} | Arah: {DIRECTION}")
    print(f"[CAM] Backend: {FLASK_BASE_URL}")

    current_status  = "waiting"
    current_plate   = ""
    current_conf    = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = yolo(frame, conf=CONF_THRESHOLD, verbose=False)

        best_plate = None
        best_conf  = 0.0

        for r in results:
            if r.boxes is None:
                continue

            for box in r.boxes.xyxy:
                x1, y1, x2, y2 = map(int, box)
                plate_img = frame[y1:y2, x1:x2]

                if plate_img.shape[0] < 30 or plate_img.shape[1] < 80:
                    continue

                # OCR
                prediction = ocr_model.run(plate_img)
                text = getattr(prediction, "text", str(prediction))
                text = text.upper().replace(" ", "")

                if not text:
                    continue

                conf = estimate_conf(plate_img, text)

                # Warna box: hijau jika regex valid, oranye jika tidak
                box_color = (0, 220, 80) if pattern.match(text) else (0, 140, 220)
                cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                cv2.putText(
                    frame, f"{text} ({conf:.0f}%)",
                    (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, box_color, 2,
                )

                history.append(text)
                if conf > best_conf:
                    best_conf  = conf
                    best_plate = text

        # ── Stabilizer: ambil plat mayoritas dari history ──
        if history:
            counted = Counter(history)
            stable_plate, count = counted.most_common(1)[0]
            now = time.time()

            if count >= STABLE_MIN:
                current_plate = stable_plate
                current_conf  = best_conf if best_plate == stable_plate else estimate_conf(
                    __import__("numpy").zeros((40, 120, 3), dtype=__import__("numpy").uint8),
                    stable_plate
                )
                # Kirim jika plat baru atau cooldown habis
                if (stable_plate != last_sent_plate or
                        (now - last_sent_time) > SEND_COOLDOWN):
                    last_sent_plate = stable_plate
                    last_sent_time  = now
                    print(f"[DETECT] Plat stabil: {stable_plate} | Conf: {current_conf:.1f}% | Count: {count}/{HISTORY_SIZE}")

                    # Kirim ke Flask dalam thread agar kamera tidak hang
                    t = threading.Thread(
                        target=report_detection,
                        args=(stable_plate, current_conf),
                        daemon=True,
                    )
                    t.start()

        draw_hud(frame, current_plate, current_conf, current_status)
        cv2.imshow("SIX ANPR — Tekan ESC untuk keluar", frame)

        if cv2.waitKey(1) == 27:
            break

    cap.release()
    cv2.destroyAllWindows()
    if arduino_conn and arduino_conn.is_open:
        arduino_conn.close()
    print("[ANPR] Scanner dihentikan.")


if __name__ == "__main__":
    main()
