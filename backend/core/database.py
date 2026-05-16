"""
core/database.py
Storage layers:
  • Redis        — active sessions + cooldown (fast, ephemeral)
  • db.json      — vehicle registry (persists across restarts)
  • history.json — completed parking sessions (persists across restarts)
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import redis.asyncio as aioredis

from .config import get_settings

# ── Persistence paths ─────────────────────────────────────────────────────────
_DB_FILE      = Path(__file__).parent / "db.json"
_HISTORY_FILE = Path(__file__).parent / "history.json"

# ── E-wallet options ──────────────────────────────────────────────────────────
SUPPORTED_EWALLETS = ["GoPay", "OVO", "ShopeePay", "Dana", "LinkAja"]

# ── Gate ID → Location mapping ────────────────────────────────────────────────
GATE_LOCATIONS: dict[str, str] = {
    "G1":    "Parkir Mahasiswa",
    "G2":    "Parkir Utama",
}

# ── Default seed data ─────────────────────────────────────────────────────────
_DEFAULT_VEHICLES: dict[str, dict] = {
    "D4321ITB": {
        "plate_raw":     "D 4321 ITB",
        "nim":           "2021184750",
        "owner":         "Muhammad Abduh",
        "vehicle_type":  "motor",
        "model":         "Honda Beat",
        "status":        "active",
        "anpr_verified": True,
        "ewallets": [
            {"provider": "GoPay", "balance": 85000,  "masked_account": "0812****7890", "is_primary": True},
            {"provider": "OVO",   "balance": 120000, "masked_account": "0856****1234", "is_primary": False},
        ],
    },
    "D9876KW": {
        "plate_raw":     "D 9876 KW",
        "nim":           "2021184750",
        "owner":         "Muhammad Abduh",
        "vehicle_type":  "motor",
        "model":         "Yamaha NMAX",
        "status":        "inactive",
        "anpr_verified": False,
        "ewallets":      [],
    },
}


# ── Vehicle DB ────────────────────────────────────────────────────────────────
def _load_db() -> dict:
    if _DB_FILE.exists():
        try:
            with open(_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"[DB] Warning: db.json corrupted ({e}), resetting to defaults.")
    _write_json(_DB_FILE, _DEFAULT_VEHICLES)
    return dict(_DEFAULT_VEHICLES)


def _write_json(path: Path, data) -> None:
    """Atomic write via temp file → rename."""
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)
    except OSError as e:
        print(f"[DB] Warning: could not write {path.name}: {e}")


# ── History DB ────────────────────────────────────────────────────────────────
def _load_history() -> list:
    if _HISTORY_FILE.exists():
        try:
            with open(_HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"[DB] Warning: history.json corrupted ({e}), starting fresh.")
    return []


# ── Live in-memory stores ─────────────────────────────────────────────────────
VEHICLE_DB: dict[str, dict] = _load_db()
HISTORY_DB: list[dict]      = _load_history()


# ── Public save helpers ───────────────────────────────────────────────────────
def save_vehicle_db() -> None:
    """Persist VEHICLE_DB to disk. Call after every mutation."""
    _write_json(_DB_FILE, VEHICLE_DB)


def save_history_db() -> None:
    """Persist HISTORY_DB to disk. Call after every new completed session."""
    _write_json(_HISTORY_FILE, HISTORY_DB)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _normalize(plate: str) -> str:
    return plate.upper().replace(" ", "")


def gate_location(gate_id: str) -> str:
    """Return human-readable location for a gate ID."""
    return GATE_LOCATIONS.get(gate_id, f"Gerbang {gate_id}")


# ── Redis ─────────────────────────────────────────────────────────────────────
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
        "plate":         _normalize(plate),
        "gate_id":       gate_id,
        "gate_location": gate_location(gate_id),
        "confidence":    confidence,
        "entry_time":    datetime.now(timezone.utc).isoformat(),
        "entry_ts":      time.time(),
        "status":        "active",
    }
    await redis.set(
        f"session:{_normalize(plate)}",
        json.dumps(session),
        ex=settings.REDIS_SESSION_TTL,
    )
    return session


async def close_session(plate: str) -> Optional[dict]:
    """Close session, compute billing, deduct e-wallet, archive to history."""
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

    # Deduct e-wallet balance (primary first, then backup)
    payment_method = "manual"
    paid_provider  = None
    ewallets       = vehicle.get("ewallets", [])

    for ew in sorted(ewallets, key=lambda x: (not x["is_primary"])):
        if ew["balance"] >= fee:
            ew["balance"] -= fee
            payment_method = "autodebit"
            paid_provider  = ew["provider"]
            break

    if payment_method == "autodebit":
        save_vehicle_db()

    session.update({
        "exit_time":      datetime.now(timezone.utc).isoformat(),
        "duration_secs":  int(duration_secs),
        "duration_hours": duration_hours,
        "fee":            fee,
        "payment_method": payment_method,
        "paid_provider":  paid_provider,
        "gate_location":  session.get("gate_location", gate_location(session.get("gate_id", ""))),
        "status":         "completed",
    })

    HISTORY_DB.append(session)
    save_history_db()   # ← persist history to disk

    await redis.delete(f"session:{_normalize(plate)}")
    return session


async def lookup_vehicle(plate: str) -> Optional[dict]:
    return VEHICLE_DB.get(_normalize(plate))
