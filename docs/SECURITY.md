# Security Architecture

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Network replay attack (LAN) | JWT `exp` claim + server-side Redis cooldown (10s) |
| Plate injection bypassing ANPR | Pydantic regex validation + OCR confidence ≥ 0.85 |
| Rogue device triggering gate | `anpr_service` Bearer token required on trigger endpoint |
| Student triggering ANPR verify | `parking_admin` token required; not accessible from /parkir |
| ESP32 impersonation | Separate `esp32_gate` token with `gate_id` claim |
| Stale dashboard WebSocket | Token validated on WS handshake; closed on JWTError |
| Unverified vehicle opening gate | `anpr_verified=True` check is step 4 of decision tree |
| Campus LAN MITM | WSS + HTTPS in production (see TLS section) |
| .env token exposure | .env in .gitignore; tokens never logged or returned in API |
| db.json data loss | File written after every mutation; atomic write pattern |

---

## Token Types

```
┌──────────────────┬──────────────────┬───────────┬──────────────────────────────────┐
│ Client           │ sub claim        │ TTL       │ Protected endpoints               │
├──────────────────┼──────────────────┼───────────┼──────────────────────────────────┤
│ ANPR script      │ anpr_service     │ 365 days  │ POST /api/v1/gate/trigger only    │
│ Dashboard user   │ dashboard_user   │ 8 hours   │ /api/v1/vehicles/* + /gate/history│
│ Admin (petugas)  │ parking_admin    │ 365 days  │ /api/v1/admin/* only              │
│ ESP32 gate unit  │ esp32_gate       │ 30 days   │ WS /ws/esp32/{gate_id}            │
└──────────────────┴──────────────────┴───────────┴──────────────────────────────────┘
```

Each token type is validated by a separate FastAPI dependency in `core/security.py`.
A `dashboard_user` token cannot call admin endpoints (403 Forbidden) and vice versa.
The `anpr_service` token can ONLY call `/gate/trigger` — not history, not vehicles.

---

## Token Generation

Run all commands from `backend/` with venv activated:

```bash
cd backend && source .venv/bin/activate
```

### 1. JWT_SECRET_KEY — master signing key (run once)
```bash
python -c "import secrets; print(secrets.token_hex(32))"
# Store in: backend/.env → JWT_SECRET_KEY=...
# If this changes, ALL existing tokens become invalid immediately.
```

### 2. ANPR Service Token
```bash
python -c "
from core.config import get_settings
from core.security import create_anpr_service_token
print(create_anpr_service_token(get_settings()))
"
# Store in: backend/.env → ANPR_SERVICE_TOKEN=...
# AND in:   anpr/.env    → API_SECRET_KEY=...   (same value, different key name)
```

### 3. Dashboard Token (for frontend dev)
```bash
python -c "
from core.config import get_settings
from core.security import create_dashboard_token
print(create_dashboard_token('2021184750', get_settings()))
"
# Store in: frontend/.env.local → NEXT_PUBLIC_DASHBOARD_TOKEN=...
# In production: issued dynamically by your auth system (SIX SSO/LDAP)
```

### 4. ESP32 Gate Token (one per gate unit)
```bash
python -c "
from core.config import get_settings
from core.security import create_esp32_gate_token
print(create_esp32_gate_token('G1', get_settings()))
"
# Flash directly into firmware/esp32_gate/esp32_gate.ino → WS_URL param
# Rotate every 30 days — reflash firmware with new token
```

### 5. Admin Token — NOT pre-generated
Admin JWTs are issued dynamically at `/api/v1/admin/auth/token` when petugas
logs in. No static token to manage. Session lives in browser `sessionStorage`
and expires when the tab closes.

Default credentials (change before production — edit `routers/admin.py`):
```
admin   / parkir2024
petugas / gerbang123
```

---

## ANPR Confidence Architecture

The confidence value sent to the backend is **OCR vote consistency**, not the
YOLO object detection score. This is a critical distinction:

```
YOLO score (0.25–0.85 typical):
  Measures: "Is there a license plate in this bounding box?"
  Used for: Filtering noise (YOLO_MIN_CONF = 0.25)
  NOT sent to backend.

OCR confidence (0.0–1.0):
  Measures: "What fraction of the last N OCR readings agree?"
  Formula:  count(best_plate) / len(history)
  Sent to backend as `confidence` field.
  Backend threshold: ≥ 0.85 (85% of readings must agree)

Example: 9 out of 10 readings say "D4321ITB"
  → ocr_confidence = 0.90 → passes backend threshold → gate opens
```

Why this matters: YOLO scores for real license plate detections are typically
0.3–0.7. Using YOLO scores as confidence would cause every trigger to be
rejected by the backend's 85% threshold, making the system non-functional.

---

## Gate Access Decision Tree

```
POST /api/v1/gate/trigger  (requires anpr_service JWT)
  │
  ├─ 1. OCR confidence < 0.85?   → deny: low_confidence
  ├─ 2. Redis cooldown active?    → skip: cooldown (duplicate)
  ├─ 3. Plate not in VEHICLE_DB? → deny: unregistered
  ├─ 4. anpr_verified == False?  → deny: not verified by petugas
  ├─ 5. status == "blocked"?     → deny: explicitly banned
  └─ ALL PASS → open_gate
       ├─ Entry: create Redis session (TTL 24h), broadcast WS, send ESP32 cmd
       └─ Exit:  deduct e-wallet balance, archive session, save db.json
```

Step 4 is the authoritative access control gate. `anpr_verified` can only be
set to `true` by an admin via `/api/v1/admin/vehicles/{plate}/verify-anpr`
(requires `parking_admin` token) or via `/api/v1/vehicles/{plate}/verify`
(requires `dashboard_user` token — intended for trusted internal use).

---

## Data Persistence & Security

### db.json
```
Location: backend/db.json
Contents: VEHICLE_DB (all vehicles, ewallets, anpr_verified, balances)
Written:  After every mutation (add/delete vehicle, add/remove/edit ewallet,
          ANPR verify/revoke, balance deduction on exit)
Read:     On FastAPI startup (load_vehicle_db())
Security: Add to .gitignore — contains real balance data
```

### Redis
```
Keys:
  session:{plate}   → active parking session (TTL: REDIS_SESSION_TTL = 86400s)
  cooldown:{plate}  → duplicate trigger prevention (TTL: REDIS_COOLDOWN_TTL = 10s)

Security: Redis is LAN-only, no authentication by default.
          In production, enable Redis AUTH: requirepass <password>
```

### HISTORY_DB
```
In-memory list — resets on server restart.
For production: migrate to PostgreSQL (replace HISTORY_DB with asyncpg queries).
```

---

## TLS in Production (Campus LAN)

```bash
# Generate self-signed cert for the LAN IP
mkdir backend/certs
openssl req -x509 -newkey rsa:4096 \
  -keyout backend/certs/key.pem \
  -out    backend/certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=192.168.1.100" \
  -addext "subjectAltName=IP:192.168.1.100"

# Run uvicorn with TLS
uvicorn main:app --host 0.0.0.0 --port 8443 \
  --ssl-keyfile ./certs/key.pem \
  --ssl-certfile ./certs/cert.pem

# Update anpr/.env
API_ENDPOINT=https://192.168.1.100:8443/api/v1/gate/trigger

# Update frontend/.env.local
NEXT_PUBLIC_API_URL=https://192.168.1.100:8443
NEXT_PUBLIC_WS_URL=wss://192.168.1.100:8443

# Update ESP32 firmware: ws:// → wss://
# Trust self-signed cert on ANPR camera PC (Windows cert store)
```

---

## Sensitive Data Checklist

| Data | Storage | Never |
|---|---|---|
| JWT_SECRET_KEY | backend/.env only | log, API response, source code |
| ANPR_SERVICE_TOKEN | backend/.env | commit to git |
| API_SECRET_KEY (ANPR) | anpr/.env only | inline comments in .env |
| ESP32 JWT | firmware binary | store in accessible filesystem |
| Admin passwords | routers/admin.py | use weak passwords in production |
| E-wallet balances | db.json | expose in public API without auth |

---

## Redis Cooldown — Two Layers

```
Layer 1 (ANPR script, client-side):
  COOLDOWN_SECS = 5.0
  Prevents repeated HTTP calls for the same plate within 5 seconds.
  Saves bandwidth. Can be bypassed by a rogue client.

Layer 2 (Backend, server-side):
  REDIS_COOLDOWN_TTL = 10 seconds
  Authoritative. Cannot be bypassed. Rejects duplicate triggers even if
  the ANPR script sends multiple requests.

The server layer is always authoritative. The client layer is an optimization.
```
