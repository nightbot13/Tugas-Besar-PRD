# Deployment Guide — WSL2 & VS Code

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| WSL2 (Ubuntu 24.04) | 2.x | `wsl --install` |
| Python | 3.11+ | `sudo apt install python3.11` |
| Node.js | 20 LTS | `nvm install 20` |
| Redis | 7.x | `sudo apt install redis-server` |
| Arduino IDE | 2.x | Download from arduino.cc |
| VS Code | Latest | With WSL extension |

## Step 1 — Clone & Setup

```bash
git clone https://github.com/your-org/anpr-parking.git
cd anpr-parking
```

## Step 2 — Backend

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

# Configure secrets
cp .env.example .env
# Edit .env: set JWT_SECRET_KEY, generate ANPR_SERVICE_TOKEN

# Generate the ANPR service token
python -c "
from core.config import get_settings
from core.security import create_anpr_service_token
print(create_anpr_service_token(get_settings()))
"
# Paste output into .env as ANPR_SERVICE_TOKEN

# Start Redis (in a separate terminal)
sudo service redis-server start

# Start FastAPI
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# API docs: http://localhost:8000/docs (DEBUG=true only)
```

## Step 3 — Frontend

```bash
cd frontend
npm install

# Configure environment
cp .env.local.example .env.local
# Edit: set NEXT_PUBLIC_API_URL=http://localhost:8000

# Copy SIX CSS files into public/css/
mkdir -p public/css
# Copy: bootstrap.min.css, bootstrap-theme.min.css, style-20200730.css,
#        all.css, v4-shims.css, jquery-confirm.min.css, bootstrap-notifications.min.css

npm run dev
# Dashboard: http://localhost:3000/parkir
```

## Step 4 — ANPR Script

```bash
cd anpr
python3.11 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

# Configure secrets
cp .env.example .env
# Edit: set API_SECRET_KEY to the ANPR service token from Step 2

# Start (entry gate, camera 0)
GATE_ID=G1 GATE_DIRECTION=entry python anpr_main.py

# Start (exit gate, camera 1)
GATE_ID=EXIT1 GATE_DIRECTION=exit CAMERA_INDEX=1 python anpr_main.py
```

## Step 5 — ESP32 Firmware

1. Open `firmware/esp32_gate/esp32_gate.ino` in Arduino IDE 2.x
2. Generate ESP32 token: `python backend/core/security.py` (see SECURITY.md)
3. Edit `WS_URL` and `WIFI_PASSWORD` constants in the sketch
4. Select board: **ESP32 Dev Module**
5. Click **Upload**
6. Open Serial Monitor (115200 baud) to verify connection

## VS Code Workspace

Create `anpr-parking.code-workspace`:

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
    "python.defaultInterpreterPath": "${workspaceFolder:Backend}/.venv/bin/python"
  }
}
```

## Process Manager (Production)

Use `supervisor` or `systemd` to keep services alive:

```ini
# /etc/supervisor/conf.d/anpr-backend.conf
[program:anpr-backend]
command=/home/ubuntu/anpr-parking/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
directory=/home/ubuntu/anpr-parking/backend
autostart=true
autorestart=true
stderr_logfile=/var/log/anpr-backend.err.log
stdout_logfile=/var/log/anpr-backend.out.log

[program:anpr-camera-g1]
command=/home/ubuntu/anpr-parking/anpr/.venv/bin/python anpr_main.py
directory=/home/ubuntu/anpr-parking/anpr
environment=GATE_ID="G1",GATE_DIRECTION="entry"
autostart=true
autorestart=true
```
