# SIX Parkir ANPR — Panduan Setup & Integrasi

## Struktur File

```
├── app.py                  ← Flask backend (API + Socket.IO)
├── anpr_scanner.py         ← ANPR scanner (modifikasi dari ANPR-rendy.py)
├── gate_servo.ino          ← Kode Arduino untuk servo gerbang
├── Prototype_SIX_Parkir2.html  ← Frontend web user
└── parkir_six.db           ← SQLite database (dibuat otomatis)
```

---

## 1. Skema Database SQLite

### Tabel `users`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| nim | TEXT UNIQUE | NIM / ID user (integrasi SSO ITB) |
| name | TEXT | Nama lengkap |
| password_hash | TEXT | SHA-256 password |

### Tabel `registered_vehicles` ← **Kunci privasi**
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER FK | Relasi ke users |
| plate | TEXT | Format no-spasi: `D4321ITB` |
| plate_display | TEXT | Format tampil: `D 4321 ITB` |
| jenis | TEXT | Motor / Mobil |
| model | TEXT | Merek/model |
| ewallet_primary | TEXT | GoPay/OVO/Dana/ShopeePay |
| ewallet_secondary | TEXT | E-wallet cadangan |
| ewallet_balance | INTEGER | Saldo simulasi (Rp) |
| status | TEXT | aktif / nonaktif / diblokir |
| anpr_verified | INTEGER | 1 jika pernah terdeteksi ANPR |

### Tabel `parking_sessions`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| plate | TEXT | Plat kendaraan |
| user_id | INTEGER FK | NULL jika tamu |
| masuk_at | TEXT | Timestamp masuk |
| keluar_at | TEXT | Timestamp keluar |
| biaya | INTEGER | Biaya parkir (Rp) |
| metode_bayar | TEXT | autodebit / qris / cash / tamu_manual |
| is_registered | INTEGER | **1=terdaftar, 0=tamu** |
| status | TEXT | aktif / selesai |

### Tabel `system_logs` ← **Audit internal, tidak expose ke user**
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK | |
| event_type | TEXT | DETECTION / GATE_OPEN / REGISTER |
| plate | TEXT | Semua plat (termasuk tamu) |
| user_id | INTEGER | NULL jika tamu |
| is_registered | INTEGER | 0 = tamu, 1 = terdaftar |
| confidence | REAL | Confidence score ANPR |
| details | TEXT | JSON detail event |

---

## 2. Install Dependencies

```bash
# Backend (Python)
pip install flask flask-socketio flask-cors eventlet requests pyserial

# ANPR Scanner
pip install ultralytics fast-plate-ocr opencv-python
```

---

## 3. Urutan Menjalankan

### Step 1 — Jalankan Flask backend
```bash
python app.py
# Server berjalan di http://localhost:5000
```

### Step 2 — Upload kode ke Arduino
1. Buka `gate_servo.ino` di Arduino IDE
2. Sesuaikan pin jika perlu (lihat komentar di file)
3. Upload ke Arduino Uno/Nano
4. Biarkan Serial Monitor terbuka untuk debug

### Step 3 — Jalankan ANPR scanner
```bash
# Edit config di atas anpr_scanner.py jika perlu:
# - ARDUINO_PORT (atau biarkan None untuk auto-detect)
# - GATE_ID
# - DIRECTION ('masuk' / 'keluar')

python anpr_scanner.py
```

### Step 4 — Buka Website
- Buka `Prototype_SIX_Parkir2.html` di browser
- Koneksi Socket.IO otomatis ke `localhost:5000`

---

## 4. Logika Privasi — Detail

```
ANPR Scanner mendeteksi plat
        │
        ▼
POST /api/anpr/detection (X-ANPR-Key diperlukan)
        │
        ├── Cek ke tabel registered_vehicles
        │
        ├── [TERDAFTAR] ─────────────────────────────────────────┐
        │     │                                                   │
        │     ├── Buat parking_sessions (user_id diisi)          │
        │     ├── socketio.emit('parking_masuk')                 │
        │     │     └── room = 'user_{user_id}'                  │
        │     │           ← HANYA user pemilik plat yg terima    │
        │     ├── Catat system_logs (is_registered=1)            │
        │     └── Arduino: LED Hijau + Buka Servo                │
        │                                                         │
        └── [TAMU] ───────────────────────────────────────────── ┘
              │
              ├── Buat parking_sessions (user_id = NULL)
              ├── TIDAK ada socketio.emit ke room user manapun
              │     ← Data tamu tidak pernah sampai ke browser user
              ├── Catat system_logs (is_registered=0, mode=TAMU)
              └── Arduino: LED Kuning + Buka Servo (bayar manual)
```

---

## 5. Wiring Arduino

```
Arduino Uno
├── Pin 9  → Servo Signal (kabel kuning/putih)
├── Pin 4  → LED Hijau (via resistor 220Ω) → GND
├── Pin 5  → LED Kuning (via resistor 220Ω) → GND
├── Pin 6  → LED Merah (via resistor 220Ω) → GND
├── Pin 7  → Buzzer + → GND
└── GND, 5V → Servo Power (gunakan power supply eksternal jika servo besar)
```

### Serial Commands (dari Python ke Arduino):
| Karakter | Aksi |
|---|---|
| `R` | LED Hijau nyala (kendaraan terdaftar) |
| `G` | LED Kuning nyala (tamu) |
| `O` | Buka servo ke 90°, tutup otomatis setelah 5 detik |
| `C` | Tutup servo paksa (override) |
| `S` | Kirim status ke Serial Monitor |

---

## 6. API Endpoints

### User (Browser)
| Method | Endpoint | Keterangan |
|---|---|---|
| POST | /api/login | Login |
| GET | /api/me | Info user aktif |
| GET | /api/vehicles | Daftar kendaraan milik user |
| POST | /api/vehicles | Daftarkan kendaraan baru |
| DELETE | /api/vehicles/{id} | Hapus kendaraan |
| GET | /api/parking/active | Sesi parkir aktif milik user |
| GET | /api/parking/history | Riwayat parkir milik user |

### ANPR Scanner (internal, butuh X-ANPR-Key)
| Method | Endpoint | Keterangan |
|---|---|---|
| POST | /api/anpr/detection | Lapor deteksi plat |
| GET | /api/admin/logs | Audit log (admin only) |
| GET | /api/admin/all_sessions | Semua sesi (admin only) |

### Socket.IO Events
| Event | Arah | Keterangan |
|---|---|---|
| `join_user_room` | Client→Server | Masuk ke room privat |
| `parking_masuk` | Server→Client | Kendaraan user masuk |
| `parking_keluar` | Server→Client | Kendaraan user keluar |
| `gate_event` | Server→Client | Status gerbang |

---

## 7. Konfigurasi Multi-Gate

Untuk setup dengan beberapa gerbang, jalankan `anpr_scanner.py` 
terpisah untuk setiap gate, dengan `GATE_ID` dan `DIRECTION` berbeda:

```bash
# Gate masuk motor
GATE_ID="MOTOR_MASUK" DIRECTION="masuk" python anpr_scanner.py

# Gate keluar motor
GATE_ID="MOTOR_KELUAR" DIRECTION="keluar" python anpr_scanner.py
```
