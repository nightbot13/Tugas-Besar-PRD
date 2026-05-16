# Deployment Guide — WSL2 (Backend/Frontend) + Windows PowerShell (ANPR)

## Prerequisites

| Tool | Platform | Version | Install |
|------|----------|---------|---------|
| WSL2 (Ubuntu 24.04) | Windows | 2.x | `wsl --install` |
| Python | WSL2 + Windows | 3.11+ | WSL: `sudo apt install python3.11` / Win: python.org |
| Node.js | WSL2 | 20 LTS | `nvm install 20` |
| Redis | WSL2 | 7.x | `sudo apt install redis-server` |
| Arduino IDE | Windows | 2.x | arduino.cc |
| VS Code | Windows | Latest | With WSL + Python extensions |
| python-dotenv | Windows (ANPR) | Latest | `pip install python-dotenv` |

> **Note:** The ANPR script runs on **Windows PowerShell** because WSL2 cannot
> access the laptop camera directly. All other components run in WSL2.

---

## Step 1 — Clone & Setup

```bash
# In WSL2
git clone https://github.com/your-org/anpr-parking.git
cd anpr-parking
```

---

## Step 2 — Backend (WSL2)

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure secrets
cp .env.example .env
nano .env   # Fill in values (see token generation below)

# Generate JWT_SECRET_KEY (run once)
python -c "import secrets; print(secrets.token_hex(32))"
# → paste into .env as JWT_SECRET_KEY

# Generate ANPR service token
python -c "
from core.config import get_settings
from core.security import create_anpr_service_token
print(create_anpr_service_token(get_settings()))
"
# → paste into .env as ANPR_SERVICE_TOKEN
# → also paste into anpr/.env as API_SECRET_KEY

# Generate dashboard token (for frontend .env.local)
python -c "
from core.config import get_settings
from core.security import create_dashboard_token
print(create_dashboard_token('2021184750', get_settings()))
"
# → paste into frontend/.env.local as NEXT_PUBLIC_DASHBOARD_TOKEN

# Start Redis
sudo service redis-server start

# Start FastAPI
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# Swagger UI (DEBUG=true only): http://localhost:8000/docs
```

**backend/.env** should look like:
```env
APP_NAME=ANPR Parking Gate — ITB Jatinangor
APP_VERSION=1.0.0
DEBUG=true

JWT_SECRET_KEY=<32-byte hex from step above>
JWT_ALGORITHM=HS256

ANPR_SERVICE_TOKEN=<token from create_anpr_service_token>
ESP32_GATE_TOKEN=<token from create_esp32_gate_token>

REDIS_URL=redis://localhost:6379/0
REDIS_COOLDOWN_TTL=10
REDIS_SESSION_TTL=86400

CORS_ORIGINS=["http://localhost:3000"]
GATE_OPEN_DURATION_MS=1000
```

---

## Step 3 — Frontend (WSL2)

```bash
cd frontend
npm install

cp .env.local.example .env.local
nano .env.local
```

**frontend/.env.local** should look like:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_DASHBOARD_TOKEN=<token from create_dashboard_token>
```

```bash
# Copy SIX CSS files into public/css/
mkdir -p public/css
# Copy: bootstrap.min.css, bootstrap-theme.min.css, roboto.css,
#        all.css, v4-shims.css, jquery-confirm.min.css,
#        bootstrap-notifications.min.css

# Font Awesome webfonts (for icons)
mkdir -p public/webfonts
# Option A: Download from github.com/FortAwesome/Font-Awesome/releases/tag/5.15.4
#   extract webfonts/ folder → copy *.woff2 files to public/webfonts/
# Option B: Replace all.css imports in globals.css with CDN link

npm run dev
# Student dashboard: http://localhost:3000/parkir
# Admin panel:       http://localhost:3000/admin
```

---

## Step 4 — ANPR Script (Windows PowerShell)

> The ANPR script runs in **Windows PowerShell**, not WSL2, because WSL2 cannot
> access the laptop's built-in camera (DirectShow device).

```powershell
# Open PowerShell in the anpr/ folder
cd D:\path\to\anpr-parking\anpr

# Create virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install dependencies (python-dotenv is required)
pip install -r requirements.txt

# Create .env file — NO inline comments after values
# Copy ANPR_SERVICE_TOKEN from backend/.env as API_SECRET_KEY
```

**anpr/.env** must look exactly like this (no `# comments` on value lines):
```env
API_ENDPOINT=http://localhost:8000/api/v1/gate/trigger
API_SECRET_KEY=<same value as ANPR_SERVICE_TOKEN in backend/.env>
CAMERA_INDEX=0
GATE_ID=G1
GATE_DIRECTION=entry
```

```powershell
# Run the ANPR script
python anpr_main.py

# For exit gate (second camera)
# Change .env: GATE_ID=EXIT1, GATE_DIRECTION=exit, CAMERA_INDEX=1
# Then re-run
```

**What you should see when working correctly:**
```
ANPR started | gate=G1 | dir=entry | camera=0 | endpoint=http://localhost:8000/...
YOLO conf=0.63 | OCR → 'D4321ITB'
🔒 Plate locked: D4321ITB | ocr_conf=100% | yolo_conf=63%
→ Trigger dispatched | plate=D4321ITB | dir=entry | gate=G1 | ocr_conf=100%
✅ GATE G1 OPENED | plate=D4321ITB | owner=Muhammad Abduh | fee=–
```

**Common errors:**

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Wrong or missing API_SECRET_KEY | Copy ANPR_SERVICE_TOKEN from backend/.env |
| `ValueError: invalid literal for int` | Inline comments in .env | Remove all `# comments` from value lines |
| `deny_access: belum diverifikasi ANPR` | Vehicle not verified | Go to /admin → Verifikasi ANPR |
| `deny_access: plate not registered` | Plate not in DB | Add via /parkir → Kendaraan Saya |
| `Cannot reach backend` | FastAPI not running | Start uvicorn in WSL2 |

---

## Step 5 — ESP32 Firmware

1. Open `firmware/esp32_gate/esp32_gate.ino` in Arduino IDE 2.x

2. Generate ESP32 gate token (in WSL2):
```bash
cd backend
source .venv/bin/activate
python -c "
from core.config import get_settings
from core.security import create_esp32_gate_token
print(create_esp32_gate_token('G1', get_settings()))
"
```

3. Edit the sketch constants:
```cpp
static const char* WIFI_SSID     = "ITB-PARKING-IOT";
static const char* WIFI_PASSWORD  = "your_wifi_password";
static const char* WS_URL =
    "ws://192.168.x.x:8000/ws/esp32/G1?token=<token from step 2>";
```

4. Board: **ESP32 Dev Module** → Upload
5. Open Serial Monitor (115200 baud) → should show "Connected to backend"

---

## Step 6 — Add & Verify a Vehicle (End-to-End Test)

```
1. Open http://localhost:3000/parkir
2. Tab "Kendaraan Saya" → Tambah Kendaraan Baru
   → Enter plate: F 6797 OB, Jenis: Motor, Model: ADV
   → Click "+ Daftarkan"
3. Click "Hubungkan E-Wallet" → add GoPay Rp100.000
4. Open http://localhost:3000/admin (admin / parkir2024)
5. Find F6797OB → Click "Verifikasi ANPR" → Confirm
6. Run ANPR script in PowerShell → show plate to camera
7. Terminal should show: ✅ GATE G1 OPENED
8. Dashboard Status Parkir → vehicle appears in "Kendaraan Sedang Parkir"
```

---

## VS Code Workspace

Create `anpr-parking.code-workspace` in the project root:

```json
{
  "folders": [
    { "name": "Backend",  "path": "./backend"  },
    { "name": "Frontend", "path": "./frontend" },
    { "name": "ANPR",     "path": "./anpr"     },
    { "name": "Firmware", "path": "./firmware" },
    { "name": "Docs",     "path": "./docs"     }
  ],
  "settings": {
    "python.defaultInterpreterPath": "${workspaceFolder:Backend}/.venv/bin/python",
    "files.exclude": {
      "**/node_modules": true,
      "**/__pycache__": true,
      "**/.next": true
    }
  }
}
```

---

## Production Process Manager (WSL2 + supervisor)

```bash
sudo apt install supervisor

# Backend
sudo nano /etc/supervisor/conf.d/anpr-backend.conf
```

```ini
[program:anpr-backend]
command=/home/ubuntu/anpr-parking/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
directory=/home/ubuntu/anpr-parking/backend
environment=HOME="/home/ubuntu"
autostart=true
autorestart=true
stderr_logfile=/var/log/anpr-backend.err.log
stdout_logfile=/var/log/anpr-backend.out.log
user=ubuntu

[program:anpr-redis]
command=redis-server
autostart=true
autorestart=true
```

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
```

For the ANPR script on Windows, use **Task Scheduler** to auto-start `run_anpr.ps1` on login.
