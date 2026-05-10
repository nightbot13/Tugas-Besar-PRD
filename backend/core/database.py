"""
core/database.py
Two-tier storage:
  • Tier 1 (Redis):  Hot cache for active sessions + cooldown deduplication.
                    Sub-millisecond lookup; data survives ANPR script restarts.
  • Tier 2 (Dict):  Mock relational DB for registered vehicles and history.
                    Replace with asyncpg + PostgreSQL in production.

All functions are async-safe and designed for FastAPI's async event loop.
"""
import json
import time
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

from .config import get_settings

# ── Redis client (shared singleton) ──────────────────────────────────────────
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


# ── Mock vehicle registry (replace with PostgreSQL in production) ─────────────
# Schema: plate_number → {owner, vehicle_type, model, ewallet, status, nim}
VEHICLE_DB: dict[str, dict] = {
    "D4321ITB": {
        "plate_raw": "D 4321 ITB",
        "nim": "2021184750",
        "owner": "Muhammad Abduh",
        "vehicle_type": "motor",
        "model": "Honda Beat",
        "ewallet_primary": {"provider": "GoPay", "balance": 85000},
        "ewallet_backup": {"provider": "OVO", "balance": 120000},
        "status": "active",       # active | blocked | flagged
        "anpr_verified": True,
    },
    "D9876KW": {
        "plate_raw": "D 9876 KW",
        "nim": "2021184750",
        "owner": "Muhammad Abduh",
        "vehicle_type": "motor",
        "model": "Yamaha NMAX",
        "ewallet_primary": None,
        "ewallet_backup": None,
        "status": "active",
        "anpr_verified": False,
    },
}

# Mock parking history (in production: PostgreSQL table `parking_sessions`)
HISTORY_DB: list[dict] = []


# ── Redis helpers ─────────────────────────────────────────────────────────────
def _normalize_plate(plate: str) -> str:
    """Strip spaces and uppercase — canonical form for Redis keys."""
    return plate.upper().replace(" ", "")


async def check_cooldown(plate: str) -> bool:
    """
    Returns True if the plate is still within the cooldown window.
    Prevents duplicate gate triggers from the same plate.
    """
    redis = await get_redis()
    key = f"cooldown:{_normalize_plate(plate)}"
    return await redis.exists(key) == 1


async def set_cooldown(plate: str):
    """Mark a plate as recently triggered. Auto-expires per config."""
    redis = await get_redis()
    settings = get_settings()
    key = f"cooldown:{_normalize_plate(plate)}"
    await redis.set(key, "1", ex=settings.REDIS_COOLDOWN_TTL)


async def get_active_session(plate: str) -> Optional[dict]:
    """Retrieve the current parking session for a plate (None if not parked)."""
    redis = await get_redis()
    key = f"session:{_normalize_plate(plate)}"
    raw = await redis.get(key)
    return json.loads(raw) if raw else None


async def create_session(plate: str, gate_id: str, confidence: float) -> dict:
    """Open a new parking session. Returns the session dict."""
    redis = await get_redis()
    settings = get_settings()
    session = {
        "plate": plate,
        "gate_id": gate_id,
        "confidence": confidence,
        "entry_time": datetime.now(timezone.utc).isoformat(),
        "entry_ts": time.time(),
        "status": "active",
    }
    key = f"session:{_normalize_plate(plate)}"
    await redis.set(key, json.dumps(session), ex=settings.REDIS_SESSION_TTL)
    return session


async def close_session(plate: str) -> Optional[dict]:
    """Close an active session, compute duration and billing, archive to history."""
    redis = await get_redis()
    session = await get_active_session(plate)
    if not session:
        return None

    # Compute duration
    duration_secs = time.time() - session["entry_ts"]
    duration_hours = max(1, int(duration_secs / 3600) + (1 if duration_secs % 3600 > 0 else 0))

    # Billing (ITB Jatinangor tariff)
    vehicle = VEHICLE_DB.get(_normalize_plate(plate), {})
    vtype = vehicle.get("vehicle_type", "motor")
    if vtype == "motor":
        fee = min(1000 + (duration_hours - 1) * 1000, 2000)
    else:
        fee = min(2000 + (duration_hours - 1) * 1000, 10000)

    session.update({
        "exit_time": datetime.now(timezone.utc).isoformat(),
        "duration_secs": int(duration_secs),
        "duration_hours": duration_hours,
        "fee": fee,
        "status": "completed",
    })

    # Archive
    HISTORY_DB.append(session)

    # Remove active session from Redis
    await redis.delete(f"session:{_normalize_plate(plate)}")
    return session


# ── Vehicle lookup ─────────────────────────────────────────────────────────────
async def lookup_vehicle(plate: str) -> Optional[dict]:
    """Look up a plate in the registered vehicle database."""
    return VEHICLE_DB.get(_normalize_plate(plate))
