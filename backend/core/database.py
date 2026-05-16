"""
core/database.py
Two-tier storage:
  • Redis    — active sessions + cooldown deduplication (fast, ephemeral)
  • JSON file — vehicle registry that PERSISTS across server restarts

The JSON file (db.json) is saved next to this file in backend/core/.
Every write to VEHICLE_DB is immediately flushed to disk so that:
  - Vehicles added via the web survive server restarts
  - ANPR verifications done via admin panel survive restarts
  - E-wallet connections and balances survive restarts

HISTORY_DB (completed sessions) is kept in memory only — it resets on restart.
In production, replace with PostgreSQL + asyncpg.
"""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import redis.asyncio as aioredis

from .config import get_settings

# ── Persistence path ──────────────────────────────────────────────────────────
_DB_FILE = Path(__file__).parent / "db.json"

# ── E-wallet options ──────────────────────────────────────────────────────────
SUPPORTED_EWALLETS = ["GoPay", "OVO", "ShopeePay", "Dana", "LinkAja"]

# ── Default seed data (used ONLY when db.json does not exist yet) ─────────────
_DEFAULT_VEHICLES: dict[str, dict] = {
    "D4321ITB": {
        "plate_raw":      "D 4321 ITB",
        "nim":            "2021184750",
        "owner":          "Muhammad Abduh",
        "vehicle_type":   "motor",
        "model":          "Honda Beat",
        "status":         "active",
        "anpr_verified":  True,
        "ewallets": [
            {
                "provider":       "GoPay",
                "balance":        85000,
                "masked_account": "0812****7890",
                "is_primary":     True,
            },
            {
                "provider":       "OVO",
                "balance":        120000,
                "masked_account": "0856****1234",
                "is_primary":     False,
            },
        ],
    },
    "D9876KW": {
        "plate_raw":      "D 9876 KW",
        "nim":            "2021184750",
        "owner":          "Muhammad Abduh",
        "vehicle_type":   "motor",
        "model":          "Yamaha NMAX",
        "status":         "inactive",
        "anpr_verified":  False,
        "ewallets":       [],
    },
}


# ── Load or initialise VEHICLE_DB from disk ───────────────────────────────────
def _load_db() -> dict:
    """Load vehicle DB from db.json, or create it from defaults."""
    if _DB_FILE.exists():
        try:
            with open(_DB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data
        except (json.JSONDecodeError, OSError) as e:
            # Corrupted file — fall back to defaults and overwrite
            print(f"[DB] Warning: db.json corrupted ({e}), resetting to defaults.")

    # First run — write defaults to disk
    _save_db(_DEFAULT_VEHICLES)
    return dict(_DEFAULT_VEHICLES)


def _save_db(db: dict) -> None:
    """Flush the entire VEHICLE_DB to db.json atomically."""
    tmp = _DB_FILE.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
        tmp.replace(_DB_FILE)   # atomic rename
    except OSError as e:
        print(f"[DB] Warning: could not save db.json: {e}")


# ── Live in-memory vehicle registry ───────────────────────────────────────────
VEHICLE_DB: dict[str, dict] = _load_db()

# ── Session history (in-memory only, resets on restart) ───────────────────────
HISTORY_DB: list[dict] = []


# ── Public save helper — call after every mutation ────────────────────────────
def save_vehicle_db() -> None:
    """Persist current VEHICLE_DB state to disk. Call after every write."""
    _save_db(VEHICLE_DB)


# ── Helpers ────────────────────────────────────────────────────────────────────
def _normalize(plate: str) -> str:
    return plate.upper().replace(" ", "")


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
    await redis.set(
        f"session:{_normalize(plate)}",
        json.dumps(session),
        ex=settings.REDIS_SESSION_TTL,
    )
    return session


async def close_session(plate: str) -> Optional[dict]:
    """Close session, compute billing, deduct e-wallet balance, archive."""
    redis = await get_redis()
    session = await get_active_session(plate)
    if not session:
        return None

    duration_secs  = time.time() - session["entry_ts"]
    duration_hours = max(1, int(duration_secs / 3600) + (1 if duration_secs % 3600 > 0 else 0))

    key     = _normalize(plate)
    vehicle = VEHICLE_DB.get(key, {})
    vtype   = vehicle.get("vehicle_type", "motor")
    fee     = (
        min(1000 + (duration_hours - 1) * 1000, 2000)
        if vtype == "motor"
        else min(2000 + (duration_hours - 1) * 1000, 10000)
    )

    # ── Deduct e-wallet balance ───────────────────────────────────────────────
    payment_method = "manual"
    paid_provider  = None
    ewallets       = vehicle.get("ewallets", [])

    for ew in sorted(ewallets, key=lambda x: (not x["is_primary"])):
        if ew["balance"] >= fee:
            ew["balance"] -= fee
            payment_method = "autodebit"
            paid_provider  = ew["provider"]
            break

    # Persist balance change to disk
    if payment_method == "autodebit":
        save_vehicle_db()

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
