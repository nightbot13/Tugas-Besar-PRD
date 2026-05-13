# ANPR Parking Gate System — ITB Jatinangor
## Project Structure (WSL2 + VS Code Monorepo)

```
anpr-parking/
│
├── .gitignore                               # Ignores .env, node_modules, *.pt, build artifacts
├── PROJECT_STRUCTURE.md                     # This file
│
├── backend/                                 # FastAPI (Python 3.11+)
│   ├── __init__.py
│   ├── main.py                              # App entrypoint: CORS, lifespan, router registration
│   ├── requirements.txt                     # fastapi, uvicorn, python-jose, redis, pydantic-settings
│   ├── .env.example                         # Secret template → copy to .env
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py                        # Pydantic-settings: JWT keys, Redis URL, CORS, tokens
│   │   ├── security.py                      # JWT encode/decode + 4 role dependencies:
│   │   │                                    #   require_anpr_token     → sub: anpr_service
│   │   │                                    #   require_dashboard_token → sub: dashboard_user
│   │   │                                    #   require_admin_token    → sub: parking_admin  ← NEW
│   │   │                                    #   verify_esp32_token     → sub: esp32_gate
│   │   └── database.py                      # In-memory mock DB:
│   │                                        #   VEHICLE_DB dict (plate → vehicle + ewallets)
│   │                                        #   HISTORY_DB list (completed sessions)
│   │                                        #   SUPPORTED_EWALLETS list
│   │                                        #   Redis helpers: session, cooldown, balance deduction
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── gate.py                          # Pydantic: GateTriggerRequest, GateTriggerResponse
│   │   └── vehicle.py                       # Pydantic: RegisteredVehicle, EWallet, ActiveSession
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── gate.py                          # Gate trigger + WebSocket routes:
│   │   │                                    #   POST /api/v1/gate/trigger      (ANPR token)
│   │   │                                    #   GET  /api/v1/gate/history      (dashboard token)
│   │   │                                    #   GET  /api/v1/gate/status       (public)
│   │   │                                    #   WS   /ws/gate-events           (dashboard WS)
│   │   │                                    #   WS   /ws/esp32/{gate_id}       (ESP32 WS)
│   │   │
│   │   ├── vehicles.py                      # Student vehicle CRUD + e-wallet management:
│   │   │                                    #   GET    /api/v1/vehicles/              (list)
│   │   │                                    #   POST   /api/v1/vehicles/              (add)
│   │   │                                    #   DELETE /api/v1/vehicles/{plate}       (remove)
│   │   │                                    #   GET    /api/v1/vehicles/sessions      (stats)
│   │   │                                    #   POST   /api/v1/vehicles/{plate}/ewallet
│   │   │                                    #   PUT    /api/v1/vehicles/{plate}/ewallet/{prov}/balance
│   │   │                                    #   DELETE /api/v1/vehicles/{plate}/ewallet/{prov}
│   │   │                                    #   PUT    /api/v1/vehicles/{plate}/ewallet/{prov}/primary
│   │   │                                    #   All require: dashboard_user token
│   │   │
│   │   └── admin.py                         # Admin-only routes (sub: parking_admin):   ← NEW
│   │                                        #   POST /api/v1/admin/auth/token           (login)
│   │                                        #   GET  /api/v1/admin/vehicles             (all vehicles)
│   │                                        #   POST /api/v1/admin/vehicles/{plate}/verify-anpr
│   │                                        #   POST /api/v1/admin/vehicles/{plate}/unverify-anpr
│   │
│   └── services/
│       ├── __init__.py
│       ├── gate_service.py                  # 5-step decision tree: confidence → cooldown →
│       │                                    #   DB lookup → status → duplicate → open_gate
│       │                                    #   Also: balance deduction on exit via close_session()
│       └── ws_manager.py                    # WebSocket manager:
│                                            #   dashboard fan-out broadcast
│                                            #   ESP32 per-gate command delivery
│
├── frontend/                                # Next.js 14 (App Router, TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts                       # API proxy rewrites + CSS cache headers
│   ├── .env.local.example                   # Template → copy to .env.local
│   │
│   ├── app/
│   │   ├── globals.css                      # SINGLE CSS SOURCE OF TRUTH:
│   │   │                                    #   @import Bootstrap 3.3.7, Roboto, Font Awesome 5
│   │   │                                    #   Verbatim style-20200730.css rules (real SIX)
│   │   │                                    #   Next.js layout fixes (cancel padding-top 70px)
│   │   │                                    #   All parking component styles
│   │   │                                    #   Responsive breakpoints (992px, 768px, 480px)
│   │   │
│   │   ├── layout.tsx                       # Root layout: import globals.css only, metadata
│   │   ├── page.tsx                         # Root → redirect to /parkir
│   │   │
│   │   ├── parkir/
│   │   │   └── page.tsx                     # Student parking dashboard:
│   │   │                                    #   Fetches vehicles from backend on mount
│   │   │                                    #   Add vehicle with live plate validation
│   │   │                                    #   Delete vehicle via API
│   │   │                                    #   Passes token to all child components
│   │   │
│   │   ├── admin/
│   │   │   └── page.tsx                     # Admin-only panel (URL: /admin):        ← NEW
│   │   │                                    #   Login screen (username + password)
│   │   │                                    #   Session stored in sessionStorage
│   │   │                                    #   Vehicle table: all vehicles, all NIMs
│   │   │                                    #   Search by plate / name / NIM / model
│   │   │                                    #   Filter: Semua / Terverifikasi / Belum Diverifikasi
│   │   │                                    #   Per-row ANPR verify / revoke with notes
│   │   │                                    #   Stat cards: total, verified, unverified, parked
│   │   │
│   │   └── api/
│   │       └── auth/
│   │           └── token/
│   │               └── route.ts             # Next.js API route: issue dashboard JWT
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx                   # Pixel-accurate SIX navbar from struktur.html source:
│   │   │   │                                #   background #222, Bootstrap .navbar-inverse values
│   │   │   │                                #   SIX + fa-home brand (font-weight 400, not bold)
│   │   │   │                                #   Aplikasi ▾ / Menu ▾ (color #9d9d9d, hover #080808)
│   │   │   │                                #   ID (active: bg #080808 white) / EN toggle
│   │   │   │                                #   fa-user-circle-o + name + Bootstrap caret
│   │   │   └── Breadcrumb.tsx               # Bootstrap ol.breadcrumb inside .container wrapper
│   │   │                                    #   padding 0 15px, separator »
│   │   │
│   │   ├── parking/
│   │   │   ├── TabMenu.tsx                  # 4-tab switcher (Kendaraan / Status / Riwayat / Tarif)
│   │   │   ├── VehicleCard.tsx              # Vehicle row with full e-wallet management panel:
│   │   │   │                                #   Add: GoPay, OVO, ShopeePay, Dana, LinkAja
│   │   │   │                                #   Edit saldo (customizable, decreases on autodebit)
│   │   │   │                                #   Set primary / remove e-wallet
│   │   │   │                                #   ANPR status shown as read-only text (no button)
│   │   │   │                                #   Delete blocks if vehicle currently parked
│   │   │   ├── ParkingStatus.tsx            # Status tab: reads live data from backend sessions
│   │   │   │                                #   GET /api/v1/vehicles/sessions → stat grid
│   │   │   │                                #   Active session bar: plate, gate, time, duration, fee
│   │   │   │                                #   Refreshes every 30s + on WebSocket gate event
│   │   │   ├── HistoryTable.tsx             # Riwayat tab: fetches GET /api/v1/gate/history
│   │   │   │                                #   Filter by plate + month, total biaya footer
│   │   │   └── TarifInfo.tsx                # Tarif tab: interactive fee calculator + rate cards
│   │   │
│   │   └── ui/
│   │       ├── Badge.tsx                    # Reusable pill badge (6 color variants)
│   │       ├── PlateTag.tsx                 # Indonesian plate chip (sm/md/lg sizes)
│   │       └── LiveGateEvent.tsx            # Real-time gate feed (WebSocket, auto-reconnect)
│   │                                        #   onEvent callback → triggers ParkingStatus refresh
│   │
│   ├── hooks/
│   │   ├── useGateEvents.ts                 # WS hook: /ws/gate-events, exponential backoff,
│   │   │                                    #   onEvent callback for parent stat refresh
│   │   └── useParkingHistory.ts             # SWR hook: polls GET /api/v1/gate/history every 60s
│   │
│   ├── lib/
│   │   └── api.ts                           # Typed fetch wrapper + all API functions:
│   │                                        #   vehicleApi.list / add / delete / sessions
│   │                                        #   gateApi.getStatus / getHistory
│   │                                        #   validatePlate() — Indonesian plate regex
│   │                                        #   buildGateEventsWsUrl()
│   │
│   └── public/
│       └── css/                             # Static assets served at /css/* (no build step)
│           ├── bootstrap.min.css            # Bootstrap 3.3.7
│           ├── bootstrap-theme.min.css      # Bootstrap optional theme
│           ├── roboto.css                   # Google Fonts Roboto (real SIX font file)
│           ├── all.css                      # Font Awesome 5 Free (paths fixed: /webfonts/)
│           ├── v4-shims.css                 # Font Awesome v4 shims
│           ├── bootstrap-notifications.min.css
│           ├── jquery-confirm.min.css
│           ├── style-20200730.css           # Real SIX overrides (reference — rules in globals.css)
│           └── six-parkir.css              # Legacy (superseded by globals.css — safe to delete)
│
├── anpr/                                    # ANPR Edge Script (runs on camera PC)
│   ├── anpr_main.py                         # YOLOv8 + fast_plate_ocr, async HTTP via aiohttp
│   │                                        #   Non-blocking: asyncio.run_coroutine_threadsafe()
│   │                                        #   Local 5s cooldown + server-side Redis cooldown
│   ├── requirements.txt                     # ultralytics, fast-plate-ocr, opencv-python, aiohttp
│   └── .env.example                         # API_ENDPOINT, API_SECRET_KEY, GATE_ID, GATE_DIRECTION
│
├── firmware/
│   └── esp32_gate/
│       ├── esp32_gate.ino                   # ESP32 WebSocket gate controller (C++)
│       │                                    #   esp_timer hardware relay (no delay())
│       │                                    #   Auto-reconnect with exponential backoff
│       │                                    #   Safety: relay closes if WS drops while open
│       └── README.md                        # Wiring diagram, library list, flashing guide
│
└── docs/
    ├── SECURITY.md                          # Threat model, token types/TTLs, TLS setup
    └── DEPLOYMENT.md                        # WSL2 step-by-step, VS Code workspace, supervisor
```

---

## Role & Token Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TOKEN TYPES                                       │
├──────────────────┬──────────────────┬───────────┬───────────────────────────│
│ Client           │ sub claim        │ TTL       │ Used by                   │
├──────────────────┼──────────────────┼───────────┼───────────────────────────│
│ ANPR script      │ anpr_service     │ 365 days  │ routers/gate.py trigger   │
│ Dashboard user   │ dashboard_user   │ 8 hours   │ routers/vehicles.py       │
│ Admin (petugas)  │ parking_admin    │ 365 days  │ routers/admin.py ← NEW    │
│ ESP32 gate unit  │ esp32_gate       │ 30 days   │ WS /ws/esp32/{gate_id}    │
└──────────────────┴──────────────────┴───────────┴───────────────────────────│
```

**Admin credentials** (defined in `routers/admin.py` → `ADMIN_USERS`):

| Username | Password | Role |
|---|---|---|
| `admin` | `parkir2024` | Full admin |
| `petugas` | `gerbang123` | Gate officer |

---

## ANPR Verification Flow

```
Student registers vehicle → status: "inactive", anpr_verified: false
         │
         ▼
  [/admin page — petugas login]
  Petugas checks STNK physically at gate → clicks "Verifikasi ANPR"
         │
         ▼
  POST /api/v1/admin/vehicles/{plate}/verify-anpr  (requires parking_admin JWT)
         │
         ▼
  vehicle.anpr_verified = true, vehicle.status = "active"
         │
         ▼
  ANPR script detects plate → backend lookup passes → gate opens automatically
```

Students **cannot** trigger this flow — the endpoint requires `parking_admin` JWT.
The "Verifikasi ANPR" button does **not exist** in the student UI (`/parkir`).
It only exists in the admin panel (`/admin`).

---

## E-Wallet & Balance Flow

```
Student adds e-wallet (GoPay/OVO/ShopeePay/Dana/LinkAja)
→ Sets initial balance (customizable anytime via "Edit Saldo")
→ Marks one as Primary, one as Cadangan

On gate exit trigger:
  gate_service.py → close_session()
    → Try Primary e-wallet balance
    → If balance < fee: try Cadangan
    → If both fail: payment_method = "manual"
    → Balance is permanently deducted in VEHICLE_DB
```

---

## CSS Architecture

```
app/globals.css (imported by layout.tsx — the only CSS import)
│
├── @import /css/bootstrap.min.css          ← Bootstrap 3.3.7 base
├── @import /css/bootstrap-theme.min.css
├── @import /css/roboto.css                 ← Roboto font (real SIX font)
├── @import /css/all.css                    ← Font Awesome 5 (/webfonts/ paths)
├── @import /css/v4-shims.css
├── @import /css/bootstrap-notifications.min.css
├── @import /css/jquery-confirm.min.css
│
├── SIX base rules (verbatim from style-20200730.css)
├── Next.js fixes (cancel padding-top: 70px from Bootstrap fixed-navbar)
├── Navbar: #222 bg, #9d9d9d text, #080808 hover/active (Bootstrap .navbar-inverse)
├── All parking component styles (.panel, .badge, .plate, .tab, .stat-grid…)
└── Responsive: ≤992px, ≤768px, ≤480px
```

> **Font Awesome webfonts**: `all.css` needs binary files in `public/webfonts/`.
> Download from FA 5.15.4 release or use CDN (see docs/DEPLOYMENT.md).

---

## Quick Start

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill JWT_SECRET_KEY, generate tokens
sudo service redis-server start
uvicorn main:app --reload --port 8000
# Swagger UI (DEBUG=true): http://localhost:8000/docs
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
# Student dashboard: http://localhost:3000/parkir
# Admin panel:       http://localhost:3000/admin
```

### ANPR Script
```bash
cd anpr
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
GATE_ID=G1 GATE_DIRECTION=entry python anpr_main.py
```

### ESP32 Firmware
1. Open `firmware/esp32_gate/esp32_gate.ino` in Arduino IDE 2.x
2. Set `WIFI_SSID`, `WIFI_PASSWORD`, `WS_URL` with ESP32 JWT
3. Board: **ESP32 Dev Module** → Upload → Serial Monitor 115200 baud

---

## Admin Panel Usage (`/admin`)

```
1. Navigate to http://localhost:3000/admin
2. Login with: admin / parkir2024  (or petugas / gerbang123)
3. Search vehicles by plate, name, NIM, or model
4. Filter: Semua | Terverifikasi | Belum Diverifikasi
5. Click "Verifikasi ANPR" on a vehicle → enter optional notes → confirm
6. Status changes to "Aktif" + "Terverifikasi" immediately
7. To revoke: click "Cabut Verifikasi" → vehicle returns to "Belum Aktif"
```
### TOKEN
1. JWT_SECRET_KEY : python -c "import secrets; print(secrets.token_hex(32))"
Location : backend/.env
2. ANPR_SERVICE_TOKEN : python -c "
from core.config import get_settings
from core.security import create_anpr_service_token
print(create_anpr_service_token(get_settings()))
"
Location : backend/.env, anpr/.env
3. ESP32_GATE_TOKEN : 
G1 : python -c "
from core.config import get_settings
from core.security import create_esp32_gate_token
print(create_esp32_gate_token('G1', get_settings()))
"
EXIT : python -c "
from core.config import get_settings
from core.security import create_esp32_gate_token
print(create_esp32_gate_token('EXIT1', get_settings()))
"
Location : backend/.env, firmware/esp32_gate/esp32_gate.ino
Contoh : static const char* WS_URL =
"ws://192.168.1.100:8000/ws/esp32/G1?token=eyJhbGci...";
4. NEXT_PUBLIC_DASHBOARD_TOKEN : python -c "
from core.config import get_settings
from core.security import create_dashboard_token
print(create_dashboard_token('2021184750', get_settings()))
"
Location : frontend/.env.local
