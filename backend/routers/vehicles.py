"""
routers/vehicles.py
CRUD endpoints for registered vehicles.
All routes require the dashboard Bearer token (sub: dashboard_user OR anpr_service).

Routes:
  GET    /api/v1/vehicles/          → list all vehicles for current user (NIM)
  POST   /api/v1/vehicles/          → register a new vehicle
  DELETE /api/v1/vehicles/{plate}   → remove a vehicle
  GET    /api/v1/vehicles/sessions  → all active sessions + stats
"""
import re
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from core.database import VEHICLE_DB, HISTORY_DB, get_active_session, lookup_vehicle
from core.security import require_dashboard_token

router = APIRouter()

# ── Indonesian plate regex (all formats) ─────────────────────────────────────
# Format: 1-2 letter area code + 1-4 digits + 1-3 letter suffix
# Examples: B 1234 ABC, D 4321 ITB, AB 123 CD, F 1 A
PLATE_RE = re.compile(r"^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}$")

def normalize_plate(raw: str) -> str:
    """Remove all spaces, uppercase → canonical form for DB key."""
    return raw.upper().replace(" ", "")

def format_plate(raw: str) -> str:
    """
    Format plate into display form with spaces: B 1234 ABC
    Handles: prefix letters | digits | suffix letters
    """
    normalized = normalize_plate(raw)
    match = re.match(r"^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$", normalized)
    if match:
        return f"{match.group(1)} {match.group(2)} {match.group(3)}"
    return normalized


# ── Request schemas ───────────────────────────────────────────────────────────
class AddVehicleRequest(BaseModel):
    plate_number: str = Field(..., min_length=3, max_length=12)
    vehicle_type: str = Field(..., pattern="^(motor|mobil)$")
    model: str = Field(..., min_length=2, max_length=60)
    nim: str = Field(default="2021184750")

    @field_validator("plate_number")
    @classmethod
    def validate_plate(cls, v: str) -> str:
        cleaned = v.strip().upper()
        # Normalize spaces for regex test
        if not PLATE_RE.match(cleaned):
            raise ValueError(
                "Format plat nomor tidak valid. "
                "Contoh yang benar: B 1234 ABC, D 4321 ITB, AB 12 CD"
            )
        return normalize_plate(cleaned)


# ── GET /api/v1/vehicles/ ────────────────────────────────────────────────────
@router.get("/", summary="List all registered vehicles for NIM")
async def list_vehicles(
    nim: str = "2021184750",
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> list[dict]:
    result = []
    for plate_key, v in VEHICLE_DB.items():
        if v.get("nim") != nim:
            continue
        # Check if currently parked (active session in Redis)
        session = await get_active_session(plate_key)
        result.append({
            "plate_normalized": plate_key,
            "plate_raw": v["plate_raw"],
            "nim": v["nim"],
            "owner": v["owner"],
            "vehicle_type": v["vehicle_type"],
            "model": v["model"],
            "status": v["status"],
            "anpr_verified": v["anpr_verified"],
            "ewallet": v.get("ewallet_primary"),
            "ewallet_backup": v.get("ewallet_backup"),
            "is_parked": session is not None,
            "active_session": session,
        })
    return result


# ── POST /api/v1/vehicles/ ───────────────────────────────────────────────────
@router.post("/", summary="Register a new vehicle", status_code=status.HTTP_201_CREATED)
async def add_vehicle(
    req: AddVehicleRequest,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = req.plate_number  # Already normalized by validator

    if key in VEHICLE_DB:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Plat nomor {format_plate(key)} sudah terdaftar di sistem.",
        )

    VEHICLE_DB[key] = {
        "plate_raw": format_plate(key),
        "nim": req.nim,
        "owner": "Muhammad Abduh",   # In production: from session/auth
        "vehicle_type": req.vehicle_type,
        "model": req.model,
        "ewallet_primary": None,
        "ewallet_backup": None,
        "status": "inactive",        # Requires manual ANPR verification at gate
        "anpr_verified": False,
    }

    return {
        "message": f"Kendaraan {format_plate(key)} berhasil didaftarkan.",
        "plate_normalized": key,
        "plate_raw": format_plate(key),
        "status": "inactive",
    }


# ── DELETE /api/v1/vehicles/{plate} ─────────────────────────────────────────
@router.delete("/{plate}", summary="Remove a registered vehicle")
async def delete_vehicle(
    plate: str,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = normalize_plate(plate)

    if key not in VEHICLE_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plat nomor {format_plate(key)} tidak ditemukan.",
        )

    # Block deletion if vehicle is currently parked
    session = await get_active_session(key)
    if session:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Kendaraan {format_plate(key)} sedang parkir. Tidak dapat dihapus.",
        )

    del VEHICLE_DB[key]
    return {"message": f"Kendaraan {format_plate(key)} berhasil dihapus."}


# ── GET /api/v1/vehicles/sessions ────────────────────────────────────────────
@router.get("/sessions", summary="Active sessions + dashboard stats")
async def get_sessions_stats(
    nim: str = "2021184750",
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    """
    Returns everything the Status Parkir tab needs:
      - active_sessions: list of vehicles currently parked
      - total_vehicles: count of registered vehicles for this NIM
      - history_today: count of completed sessions today
    """
    import time

    user_vehicles = {
        k: v for k, v in VEHICLE_DB.items() if v.get("nim") == nim
    }

    active_sessions = []
    for plate_key, vehicle in user_vehicles.items():
        session = await get_active_session(plate_key)
        if session:
            # Compute live duration
            elapsed_secs = int(time.time() - session.get("entry_ts", time.time()))
            elapsed_hours = max(1, (elapsed_secs // 3600) + (1 if elapsed_secs % 3600 > 0 else 0))
            if vehicle["vehicle_type"] == "motor":
                est_fee = min(1000 + (elapsed_hours - 1) * 1000, 2000)
            else:
                est_fee = min(2000 + (elapsed_hours - 1) * 1000, 10000)

            h = elapsed_secs // 3600
            m = (elapsed_secs % 3600) // 60

            active_sessions.append({
                "plate_normalized": plate_key,
                "plate_raw": vehicle["plate_raw"],
                "model": vehicle["model"],
                "vehicle_type": vehicle["vehicle_type"],
                "gate_id": session.get("gate_id", "G1"),
                "entry_time": session.get("entry_time", ""),
                "entry_ts": session.get("entry_ts", 0),
                "elapsed_secs": elapsed_secs,
                "duration_label": f"{h}j {m}m",
                "est_fee": est_fee,
                "est_fee_label": f"Rp{est_fee:,}".replace(",", "."),
                "ewallet": vehicle.get("ewallet_primary"),
            })

    today = datetime.now(timezone.utc).date().isoformat()
    today_sessions = [
        s for s in HISTORY_DB
        if s.get("entry_time", "").startswith(today)
    ]

    return {
        "total_vehicles": len(user_vehicles),
        "active_sessions": active_sessions,
        "active_count": len(active_sessions),
        "today_completed": len(today_sessions),
    }
