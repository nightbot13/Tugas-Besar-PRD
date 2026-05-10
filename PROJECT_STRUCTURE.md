# ANPR Parking Gate System — ITB Jatinangor
## Project Structure (WSL2 + VS Code Monorepo)

```
anpr-parking/
│
├── .gitignore                               # Python, Node, Arduino, secrets
│
├── PROJECT_STRUCTURE.md                     # This file
│
│
├── backend/                                 # FastAPI (Python 3.11+)
│   ├── .env.example                         # Secret template — copy to .env
│   ├── __init__.py
│   ├── main.py                              # App entrypoint, CORS, lifespan
│   ├── requirements.txt
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py                        # Env settings (pydantic-settings)
│   │   ├── security.py                      # JWT encode/decode, Bearer deps
│   │   └── database.py                      # Mock DB dict + Redis cache layer
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── gate.py                          # Pydantic request/response schemas
│   │   └── vehicle.py                       # Vehicle & session domain models
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   └── gate.py                          # POST /trigger, GET /history, WS
│   │
│   └── services/
│       ├── __init__.py
│       ├── gate_service.py                  # Business logic: lookup, session, billing
│       └── ws_manager.py                    # WebSocket broadcast manager
│
│
├── frontend/                                # Next.js 14 (App Router, TypeScript)
│   ├── .env.local.example                   # Frontend env template
│   ├── next.config.ts                       # Rewrites, static asset caching
│   ├── package.json
│   ├── tsconfig.json
│   │
│   ├── app/
│   │   ├── globals.css                      # ★ SINGLE CSS SOURCE OF TRUTH
│   │   │                                    #   @imports all SIX CSS files,
│   │   │                                    #   fixes Bootstrap 3 conflicts,
│   │   │                                    #   all parking component styles
│   │   ├── layout.tsx                       # Root layout — imports globals.css only
│   │   ├── page.tsx                         # Root redirect → /parkir
│   │   ├── parkir/
│   │   │   └── page.tsx                     # Main parking page — composes all tabs
│   │   └── api/
│   │       └── auth/token/
│   │           └── route.ts                 # Next.js API route — issues dashboard JWT
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx                   # SIX dark topnav (sticky, React)
│   │   │   └── Breadcrumb.tsx               # SIX breadcrumb trail
│   │   │
│   │   ├── parking/
│   │   │   ├── TabMenu.tsx                  # Tab switcher bar
│   │   │   ├── VehicleCard.tsx              # Registered vehicle row + e-wallet panel
│   │   │   ├── ParkingStatus.tsx            # Live session detail + stat grid
│   │   │   ├── HistoryTable.tsx             # Filterable riwayat table
│   │   │   └── TarifInfo.tsx                # Tarif calculator + reference cards
│   │   │
│   │   └── ui/
│   │       ├── Badge.tsx                    # Semantic badge chip
│   │       ├── PlateTag.tsx                 # License plate display chip
│   │       └── LiveGateEvent.tsx            # WebSocket real-time gate feed
│   │
│   ├── hooks/
│   │   ├── useGateEvents.ts                 # WS subscription (auto-reconnect)
│   │   └── useParkingHistory.ts             # SWR polling hook for history
│   │
│   ├── lib/
│   │   └── api.ts                           # Typed fetch wrapper + WS URL builder
│   │
│   └── public/
│       └── css/                             # ★ ALL SIX STATIC CSS FILES HERE
│           ├── bootstrap.min.css            # Bootstrap 3.3.7 (uploaded: bootstrap_min.css)
│           ├── bootstrap-theme.min.css      # Bootstrap theme  (uploaded: bootstrap-theme_min.css)
│           ├── roboto.css                   # Google Fonts Roboto (uploaded: css)
│           ├── all.css                      # Font Awesome 5 Free (patched: ../webfonts → /webfonts)
│           ├── v4-shims.css                 # FA v4 compat shims
│           ├── style-20200730.css           # Real SIX base overrides
│           ├── bootstrap-notifications.min.css
│           ├── jquery-confirm.min.css
│           └── six-parkir.css              # (legacy — superseded by globals.css)
│
│       └── webfonts/                        # ★ MUST ADD MANUALLY
│           ├── fa-solid-900.woff2           # Font Awesome glyph files
│           ├── fa-regular-400.woff2         # (not included in uploads — see note)
│           └── fa-brands-400.woff2
│
│
├── anpr/                                    # ANPR Edge Script (Python 3.11+)
│   ├── .env.example                         # Camera & API secret template
│   ├── anpr_main.py                         # YOLOv8 + fast_plate_ocr, async HTTP
│   └── requirements.txt
│
│
├── firmware/
│   └── esp32_gate/
│       ├── esp32_gate.ino                   # ESP32 WebSocket + GPIO relay controller
│       └── README.md                        # Wiring diagram + flashing guide
│
│
└── docs/
    ├── SECURITY.md                          # Token generation, TLS, threat model
    └── DEPLOYMENT.md                        # WSL2 + VS Code step-by-step guide
```

---

## CSS Architecture

```
globals.css  (app/globals.css — imported by layout.tsx)
│
├── @import /css/bootstrap.min.css           ← Bootstrap 3.3.7 grid + components
├── @import /css/bootstrap-theme.min.css     ← Bootstrap optional theme
├── @import /css/roboto.css                  ← Roboto font (real SIX font)
├── @import /css/all.css                     ← Font Awesome 5 (paths patched)
├── @import /css/v4-shims.css                ← FA v4 compat
├── @import /css/bootstrap-notifications.min.css
├── @import /css/jquery-confirm.min.css
│
├── SIX base overrides                       ← verbatim from style-20200730.css
│   body { font-family: 'Roboto' }
│   h1–h6 { color: #036; font-weight: 300 }
│   .breadcrumb, .panel, .alert, .wizard…
│
├── Next.js layout fixes                     ← cancel Bootstrap fixed-navbar assumptions
│   body { padding-top: 0 !important }       ← style-20200730 adds 70px for navbar
│   body { margin-bottom: 0 !important }     ← style-20200730 adds 110px for footer
│
├── Parking component styles                 ← .topnav, .tab, .plate, .stat-grid…
│
└── Responsive breakpoints                   ← ≤992px, ≤768px, ≤480px
```

### Bootstrap 3 Conflict Resolution

| Bootstrap 3 class | Conflict | Resolution in globals.css |
|---|---|---|
| `.panel` | Different visual style | Override with `!important` |
| `.badge` | Circular counter vs pill label | Reset + override with `!important` |
| `.breadcrumb` | `ol/li` list-based vs our div | Override `display`, `padding`, separator |
| `.alert-info` | Bootstrap blue vs SIX blue | Compatible — kept |
| `.progress-bar` | Animated stripes vs plain bar | `background-image: none !important` |
| `.btn` | Bootstrap gradient/shadow | `box-shadow: none`, `text-shadow: none` |

---

## Network & Security Architecture

```
[ANPR Camera PC]
      │  POST /api/v1/gate/trigger
      │  Authorization: Bearer <ANPR_SERVICE_TOKEN>
      │  { plate_number, gate_id, confidence, direction }
      ▼
[FastAPI :8000]
      │  JWT validation (sub: "anpr_service")
      │  Pydantic schema validation + regex check
      │  Redis cooldown check (10s window)
      │  Vehicle DB lookup + status check
      │  Session create/close + billing
      │
      ├──── WebSocket broadcast ────────────────► [Next.js Dashboard :3000]
      │     /ws/gate-events?token=<JWT>            useGateEvents hook
      │     { type, plate, owner, fee, ts }        LiveGateEvent component
      │
      └──── WebSocket command ──────────────────► [ESP32 Gate Unit]
            /ws/esp32/G1?token=<JWT>               esp32_gate.ino
            { action:"open_gate", duration_ms:1000 }
                                                         │
                                                   GPIO4 HIGH (1000ms)
                                                         │
                                                   Physical relay → Gate motor
```

---

## Quick Start

### Prerequisites
```bash
# WSL2 Ubuntu 24.04
sudo apt install python3.11 python3.11-venv redis-server
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 20
sudo service redis-server start
```

### 1. Backend
```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          
# Edit: set JWT_SECRET_KEY (32-byte hex)
python -c "import secrets; print(secrets.token_hex(32))"

# Generate ANPR service token
python -c "
from core.config import get_settings
from core.security import create_anpr_service_token
print(create_anpr_service_token(get_settings()))
"
# Paste output into .env as ANPR_SERVICE_TOKEN

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local

# Add Font Awesome webfonts (required for icons)
mkdir -p public/webfonts
# Download from: https://use.fontawesome.com/releases/v5.15.1/fontawesome-free-5.15.1-web.zip
# Extract /webfonts/ contents into public/webfonts/

npm run dev   # → http://localhost:3000/parkir
```

### 3. ANPR Script
```bash
cd anpr
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # Edit: set API_SECRET_KEY from Step 1

GATE_ID=G1 GATE_DIRECTION=entry python anpr_main.py
```

### 4. ESP32 Firmware
```
1. Open firmware/esp32_gate/esp32_gate.ino in Arduino IDE 2.x
2. Generate ESP32 token (see docs/SECURITY.md)
3. Edit WS_URL and WIFI_PASSWORD in the sketch
4. Flash to ESP32 DevKit V1
5. Monitor at 115200 baud
```

---

## File Naming — Uploaded → Renamed

| Uploaded filename | Placed at | Reason |
|---|---|---|
| `bootstrap_min.css` | `public/css/bootstrap.min.css` | Standard naming |
| `bootstrap-theme_min.css` | `public/css/bootstrap-theme.min.css` | Standard naming |
| `bootstrap-notifications_min.css` | `public/css/bootstrap-notifications.min.css` | Standard naming |
| `jquery-confirm_min.css` | `public/css/jquery-confirm.min.css` | Standard naming |
| `style-20200730.css` | `public/css/style-20200730.css` | Unchanged |
| `all.css` | `public/css/all.css` | Font paths patched: `../webfonts/` → `/webfonts/` |
| `v4-shims.css` | `public/css/v4-shims.css` | Unchanged |
| `css` (Google Fonts file) | `public/css/roboto.css` | Renamed to clarify purpose |

---

## ⚠ Manual Steps Required After Cloning

### 1. Font Awesome Webfonts
`all.css` references `/webfonts/*.woff2` files not included in uploads:
```bash
cd frontend
wget https://use.fontawesome.com/releases/v5.15.1/fontawesome-free-5.15.1-web.zip
unzip fontawesome-free-5.15.1-web.zip
cp -r fontawesome-free-5.15.1-web/webfonts public/webfonts
rm -rf fontawesome-free-5.15.1-web* 
```

### 2. Secret generation
See `docs/SECURITY.md` for token generation commands.

### 3. Redis
```bash
sudo service redis-server start   # WSL2
# or: redis-server (macOS/Linux)
```
