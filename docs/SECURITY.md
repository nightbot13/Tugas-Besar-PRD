# Security Architecture

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Network replay attack (LAN) | JWT with `exp` claim + server-side Redis cooldown window |
| Plate injection (crafted request bypassing ANPR) | Pydantic regex validation + ≥85% confidence threshold |
| Unauthorized gate trigger from rogue device | Bearer token required; `sub` claim checked per client type |
| ESP32 firmware impersonation | Separate `esp32_gate` token with `gate_id` claim binding |
| Stale dashboard WebSocket session | Token validated on handshake; connection closed on `JWTError` |
| Campus LAN MITM | Use WSS (TLS) and HTTPS in production; see TLS setup below |

## Token Types

```
┌──────────────────┬──────────────┬───────────────────┬─────────────────────┐
│ Client           │ sub claim    │ TTL               │ Rotation            │
├──────────────────┼──────────────┼───────────────────┼─────────────────────┤
│ ANPR script      │ anpr_service │ 365 days          │ Annually / on breach│
│ ESP32 gate unit  │ esp32_gate   │ 30 days           │ Monthly via CI/CD   │
│ Dashboard browser│ dashboard_user│ Session-scoped   │ On every login      │
└──────────────────┴──────────────┴───────────────────┴─────────────────────┘
```

## Generating Tokens

```bash
# 1. Generate JWT_SECRET_KEY (run once, store in .env)
python -c "import secrets; print(secrets.token_hex(32))"

# 2. ANPR service token (run once per installation)
cd backend
python -c "
from core.config import get_settings
from core.security import create_anpr_service_token
print(create_anpr_service_token(get_settings()))
"

# 3. ESP32 gate token (run once per gate unit per rotation period)
python -c "
from core.config import get_settings
from core.security import create_esp32_gate_token
print(create_esp32_gate_token('G1', get_settings()))
"
```

## TLS in Production (uvicorn + self-signed for LAN)

```bash
# Generate a self-signed cert for the campus LAN IP
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem \
  -out certs/cert.pem -days 365 -nodes \
  -subj "/CN=192.168.1.100" \
  -addext "subjectAltName=IP:192.168.1.100"

# Run uvicorn with TLS
uvicorn main:app --host 0.0.0.0 --port 8443 \
  --ssl-keyfile ./certs/key.pem \
  --ssl-certfile ./certs/cert.pem

# Update ESP32 WS_URL to wss://
# Update ANPR API_ENDPOINT to https://
# Install self-signed cert on the ANPR camera PC (trust store)
```

## Redis Cooldown

Two-layer duplicate-trigger prevention:
1. **ANPR client-side** (`COOLDOWN_SECS=5` in `anpr/.env`) — blocks before network call
2. **Server-side Redis** (`REDIS_COOLDOWN_TTL=10` in `backend/.env`) — blocks even if client sends anyway

The server layer is authoritative. The client layer saves bandwidth.

## Sensitive Data

- **JWT_SECRET_KEY** — never log, never expose in API responses
- **API_SECRET_KEY** (ANPR token) — store in ANPR PC's `.env`, not in source
- **ESP32 JWT** — flash into firmware, not stored on an accessible filesystem
- **E-wallet credentials** — never stored by this system; only provider + balance from OAuth API
