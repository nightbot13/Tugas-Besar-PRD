"""
core/database.py
Two-tier storage:
  • Redis  — active sessions + cooldown deduplication
  • Dict   — mock relational DB for vehicles, e-wallets, history
"""
import json
import time
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

from .config import get_settings

# ── Redis client ───────────────────────────────────────────────────────────────
_redis: Optional[aioredis.Redis] = None

async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        settings = get_settings()
        _redis = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    return _redis

async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None

# ── E-wallet structure ────────────────────────────────────────────────────────
# Each ewallet entry: { provider, balance, masked_account, is_primary }
SUPPORTED_EWALLETS = ["GoPay", "OVO", "ShopeePay", "Dana", "LinkAja"]

# ── Vehicle DB ────────────────────────────────────────────────────────────────
# Key: normalized plate (no spaces, uppercase)
# ewallet: list of e-wallet dicts (primary first)
VEHICLE_DB: dict[str, dict] = {
    "D4321ITB": {
        "plate_raw":    "D 4321 ITB",
        "nim":          "2021184750",
        "owner":        "Muhammad Abduh",
        "vehicle_type": "motor",
        "model":        "Honda Beat",
        "status":       "active",
        "anpr_verified": True,
        "ewallets": [
            {"provider": "GoPay",  "balance": 85000,  "masked_account": "0812****7890", "is_primary": True},
            {"provider": "OVO",    "balance": 120000, "masked_account": "0856****1234", "is_primary": False},
        ],
    },
    "D9876KW": {
        "plate_raw":    "D 9876 KW",
        "nim":          "2021184750",
        "owner":        "Muhammad Abduh",
        "vehicle_type": "motor",
        "model":        "Yamaha NMAX",
        "status":       "active",
        "anpr_verified": False,
        "ewallets": [],
    },
}

HISTORY_DB: list[dict] = []

# ── Helpers ────────────────────────────────────────────────────────────────────
def _normalize(plate: str) -> str:
    return plate.upper().replace(" ", "")

# ── Redis helpers ──────────────────────────────────────────────────────────────
async def check_cooldown(plate: str) -> bool:
    redis = await get_redis()
    return await redis.exists(f"cooldown:{_normalize(plate)}") == 1

async def set_cooldown(plate: str):
    redis = await get_redis()
    settings = get_settings()
    await redis.set(f"cooldown:{_normalize(plate)}", "1", ex=settings.REDIS_COOLDOWN_TTL)

async def get_active_session(plate: str) -> Optional[dict]:
    redis = await get_redis()
    raw = await redis.get(f"session:{_normalize(plate)}")
    return json.loads(raw) if raw else None

async def create_session(plate: str, gate_id: str, confidence: float) -> dict:
    redis = await get_redis()
    settings = get_settings()
    session = {
        "plate":      _normalize(plate),
        "gate_id":    gate_id,
        "confidence": confidence,
        "entry_time": datetime.now(timezone.utc).isoformat(),
        "entry_ts":   time.time(),
        "status":     "active",
    }
    await redis.set(f"session:{_normalize(plate)}", json.dumps(session), ex=settings.REDIS_SESSION_TTL)
    return session

async def close_session(plate: str) -> Optional[dict]:
    """Close session, compute billing, deduct e-wallet balance, archive to history."""
    redis = await get_redis()
    session = await get_active_session(plate)
    if not session:
        return None

    duration_secs  = time.time() - session["entry_ts"]
    duration_hours = max(1, int(duration_secs / 3600) + (1 if duration_secs % 3600 > 0 else 0))

    key     = _normalize(plate)
    vehicle = VEHICLE_DB.get(key, {})
    vtype   = vehicle.get("vehicle_type", "motor")
    fee     = min(1000 + (duration_hours - 1) * 1000, 2000) if vtype == "motor" \
              else min(2000 + (duration_hours - 1) * 1000, 10000)

    # ── Deduct e-wallet balance ───────────────────────────────────────────────
    payment_method = "manual"
    paid_provider  = None
    ewallets       = vehicle.get("ewallets", [])

    # Try primary first, then backup
    for ew in sorted(ewallets, key=lambda x: (not x["is_primary"])):
        if ew["balance"] >= fee:
            ew["balance"] -= fee
            payment_method = "autodebit"
            paid_provider  = ew["provider"]
            break

    session.update({
        "exit_time":      datetime.now(timezone.utc).isoformat(),
        "duration_secs":  int(duration_secs),
        "duration_hours": duration_hours,
        "fee":            fee,
        "payment_method": payment_method,
        "paid_provider":  paid_provider,
        "status":         "completed",
    })

    HISTORY_DB.append(session)
    await redis.delete(f"session:{_normalize(plate)}")
    return session

async def lookup_vehicle(plate: str) -> Optional[dict]:
    return VEHICLE_DB.get(_normalize(plate))
