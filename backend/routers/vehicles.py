"""
routers/vehicles.py — Full vehicle CRUD + e-wallet management + ANPR verification.

Routes:
  GET    /api/v1/vehicles/                     → list vehicles for NIM
  POST   /api/v1/vehicles/                     → register new vehicle
  DELETE /api/v1/vehicles/{plate}              → remove vehicle
  GET    /api/v1/vehicles/sessions             → active sessions + stats
  POST   /api/v1/vehicles/{plate}/ewallet      → add e-wallet to vehicle
  PUT    /api/v1/vehicles/{plate}/ewallet/{provider}/balance → update balance
  DELETE /api/v1/vehicles/{plate}/ewallet/{provider} → remove e-wallet
  PUT    /api/v1/vehicles/{plate}/ewallet/{provider}/primary → set as primary
  POST   /api/v1/vehicles/{plate}/verify-anpr  → mark ANPR as verified
"""
import re
import time
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from core.database import (
    VEHICLE_DB, HISTORY_DB, SUPPORTED_EWALLETS,
    get_active_session, _normalize,
)
from core.security import require_dashboard_token

router = APIRouter()

PLATE_RE = re.compile(r"^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}$")

def fmt_plate(normalized: str) -> str:
    m = re.match(r"^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$", normalized)
    return f"{m.group(1)} {m.group(2)} {m.group(3)}" if m else normalized


# ── Schemas ───────────────────────────────────────────────────────────────────

class AddVehicleRequest(BaseModel):
    plate_number:  str = Field(..., min_length=3, max_length=12)
    vehicle_type:  Literal["motor", "mobil"]
    model:         str = Field(..., min_length=2, max_length=60)
    nim:           str = Field(default="2021184750")

    @field_validator("plate_number")
    @classmethod
    def validate_plate(cls, v: str) -> str:
        c = v.strip().upper()
        if not PLATE_RE.match(c):
            raise ValueError("Format plat tidak valid. Contoh: B 1234 ABC, D 4321 ITB")
        return _normalize(c)


class AddEwalletRequest(BaseModel):
    provider:        str = Field(..., description="GoPay | OVO | ShopeePay | Dana | LinkAja")
    masked_account:  str = Field(default="", max_length=20)
    initial_balance: int = Field(default=100000, ge=0, le=100_000_000)
    set_as_primary:  bool = Field(default=False)

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        if v not in SUPPORTED_EWALLETS:
            raise ValueError(f"Provider tidak valid. Pilihan: {', '.join(SUPPORTED_EWALLETS)}")
        return v


class UpdateBalanceRequest(BaseModel):
    balance: int = Field(..., ge=0, le=100_000_000, description="Saldo baru dalam IDR")


class VerifyAnprRequest(BaseModel):
    verified_by: str = Field(default="Petugas Parkir", description="Nama petugas yang memverifikasi")


# ── GET /api/v1/vehicles/ ─────────────────────────────────────────────────────
@router.get("/", summary="List all vehicles for NIM")
async def list_vehicles(
    nim: str = "2021184750",
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> list[dict]:
    result = []
    for key, v in VEHICLE_DB.items():
        if v.get("nim") != nim:
            continue
        session = await get_active_session(key)
        ewallets = v.get("ewallets", [])
        result.append({
            "plate_normalized": key,
            "plate_raw":        v["plate_raw"],
            "nim":              v["nim"],
            "owner":            v["owner"],
            "vehicle_type":     v["vehicle_type"],
            "model":            v["model"],
            "status":           v["status"],
            "anpr_verified":    v["anpr_verified"],
            "ewallets":         ewallets,
            "primary_ewallet":  next((e for e in ewallets if e["is_primary"]), ewallets[0] if ewallets else None),
            "backup_ewallet":   next((e for e in ewallets if not e["is_primary"]), None),
            "is_parked":        session is not None,
            "active_session":   session,
        })
    return result


# ── POST /api/v1/vehicles/ ────────────────────────────────────────────────────
@router.post("/", status_code=status.HTTP_201_CREATED)
async def add_vehicle(
    req: AddVehicleRequest,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = req.plate_number
    if key in VEHICLE_DB:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail=f"Plat {fmt_plate(key)} sudah terdaftar.")
    VEHICLE_DB[key] = {
        "plate_raw":    fmt_plate(key),
        "nim":          req.nim,
        "owner":        "Muhammad Abduh",
        "vehicle_type": req.vehicle_type,
        "model":        req.model,
        "status":       "inactive",
        "anpr_verified": False,
        "ewallets":     [],
    }
    return {"message": f"Kendaraan {fmt_plate(key)} berhasil didaftarkan.", "plate_raw": fmt_plate(key)}


# ── DELETE /api/v1/vehicles/{plate} ──────────────────────────────────────────
@router.delete("/{plate}")
async def delete_vehicle(
    plate: str,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = _normalize(plate)
    if key not in VEHICLE_DB:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Plat {fmt_plate(key)} tidak ditemukan.")
    if await get_active_session(key):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Kendaraan sedang parkir, tidak bisa dihapus.")
    del VEHICLE_DB[key]
    return {"message": f"Kendaraan {fmt_plate(key)} berhasil dihapus."}


# ── GET /api/v1/vehicles/sessions ────────────────────────────────────────────
@router.get("/sessions")
async def get_sessions_stats(
    nim: str = "2021184750",
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    user_vehicles = {k: v for k, v in VEHICLE_DB.items() if v.get("nim") == nim}
    active_sessions = []

    for key, vehicle in user_vehicles.items():
        session = await get_active_session(key)
        if not session:
            continue
        elapsed  = int(time.time() - session.get("entry_ts", time.time()))
        jam      = max(1, (elapsed // 3600) + (1 if elapsed % 3600 > 0 else 0))
        vtype    = vehicle["vehicle_type"]
        est_fee  = min(1000 + (jam-1)*1000, 2000) if vtype == "motor" else min(2000 + (jam-1)*1000, 10000)
        h, m     = elapsed // 3600, (elapsed % 3600) // 60
        ewallets = vehicle.get("ewallets", [])
        primary  = next((e for e in ewallets if e["is_primary"]), ewallets[0] if ewallets else None)
        active_sessions.append({
            "plate_normalized": key,
            "plate_raw":        vehicle["plate_raw"],
            "model":            vehicle["model"],
            "vehicle_type":     vtype,
            "gate_id":          session.get("gate_id", "G1"),
            "entry_time":       session.get("entry_time", ""),
            "entry_ts":         session.get("entry_ts", 0),
            "elapsed_secs":     elapsed,
            "duration_label":   f"{h}j {m}m",
            "est_fee":          est_fee,
            "est_fee_label":    f"Rp{est_fee:,}".replace(",", "."),
            "primary_ewallet":  primary,
        })

    today = datetime.now(timezone.utc).date().isoformat()
    today_done = [s for s in HISTORY_DB if s.get("entry_time", "").startswith(today)]

    return {
        "total_vehicles":   len(user_vehicles),
        "active_sessions":  active_sessions,
        "active_count":     len(active_sessions),
        "today_completed":  len(today_done),
    }


# ── POST /api/v1/vehicles/{plate}/ewallet ────────────────────────────────────
@router.post("/{plate}/ewallet", status_code=status.HTTP_201_CREATED)
async def add_ewallet(
    plate: str,
    req: AddEwalletRequest,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = _normalize(plate)
    if key not in VEHICLE_DB:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Kendaraan tidak ditemukan.")
    
    vehicle  = VEHICLE_DB[key]
    ewallets = vehicle.get("ewallets", [])

    # Check duplicate provider
    if any(e["provider"] == req.provider for e in ewallets):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail=f"{req.provider} sudah terhubung ke kendaraan ini.")

    new_ew = {
        "provider":       req.provider,
        "balance":        req.initial_balance,
        "masked_account": req.masked_account or f"08xx-xxxx-xxxx",
        "is_primary":     req.set_as_primary or len(ewallets) == 0,
    }

    # If set_as_primary, demote existing primary
    if new_ew["is_primary"]:
        for e in ewallets:
            e["is_primary"] = False

    ewallets.append(new_ew)
    vehicle["ewallets"] = ewallets

    # Activate vehicle if it was inactive (has e-wallet now)
    if vehicle["status"] == "inactive" and vehicle["anpr_verified"]:
        vehicle["status"] = "active"

    return {"message": f"{req.provider} berhasil dihubungkan.", "ewallet": new_ew}


# ── PUT /api/v1/vehicles/{plate}/ewallet/{provider}/balance ──────────────────
@router.put("/{plate}/ewallet/{provider}/balance")
async def update_balance(
    plate: str,
    provider: str,
    req: UpdateBalanceRequest,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = _normalize(plate)
    if key not in VEHICLE_DB:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Kendaraan tidak ditemukan.")
    
    ewallets = VEHICLE_DB[key].get("ewallets", [])
    ew = next((e for e in ewallets if e["provider"] == provider), None)
    if not ew:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{provider} tidak terhubung.")
    
    ew["balance"] = req.balance
    return {"message": f"Saldo {provider} diperbarui.", "balance": req.balance}


# ── DELETE /api/v1/vehicles/{plate}/ewallet/{provider} ───────────────────────
@router.delete("/{plate}/ewallet/{provider}")
async def remove_ewallet(
    plate: str,
    provider: str,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = _normalize(plate)
    if key not in VEHICLE_DB:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Kendaraan tidak ditemukan.")
    
    ewallets = VEHICLE_DB[key].get("ewallets", [])
    before   = len(ewallets)
    removed  = next((e for e in ewallets if e["provider"] == provider), None)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{provider} tidak ditemukan.")
    
    VEHICLE_DB[key]["ewallets"] = [e for e in ewallets if e["provider"] != provider]

    # If removed was primary, promote next one
    if removed["is_primary"] and VEHICLE_DB[key]["ewallets"]:
        VEHICLE_DB[key]["ewallets"][0]["is_primary"] = True

    return {"message": f"{provider} berhasil dihapus."}


# ── PUT /api/v1/vehicles/{plate}/ewallet/{provider}/primary ──────────────────
@router.put("/{plate}/ewallet/{provider}/primary")
async def set_primary_ewallet(
    plate: str,
    provider: str,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = _normalize(plate)
    if key not in VEHICLE_DB:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Kendaraan tidak ditemukan.")
    
    ewallets = VEHICLE_DB[key].get("ewallets", [])
    found = False
    for e in ewallets:
        e["is_primary"] = (e["provider"] == provider)
        if e["provider"] == provider:
            found = True
    
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{provider} tidak ditemukan.")
    
    return {"message": f"{provider} dijadikan e-wallet primer."}


# ── POST /api/v1/vehicles/{plate}/verify-anpr ────────────────────────────────
@router.post("/{plate}/verify-anpr")
async def verify_anpr(
    plate: str,
    req: VerifyAnprRequest,
    _: Annotated[dict, Depends(require_dashboard_token)] = None,
) -> dict:
    key = _normalize(plate)
    if key not in VEHICLE_DB:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Kendaraan tidak ditemukan.")
    
    vehicle = VEHICLE_DB[key]
    vehicle["anpr_verified"] = True

    # Auto-activate if ANPR verified (regardless of e-wallet)
    if vehicle["status"] == "inactive":
        vehicle["status"] = "active"

    return {
        "message":     f"ANPR untuk {vehicle['plate_raw']} berhasil diverifikasi oleh {req.verified_by}.",
        "plate_raw":   vehicle["plate_raw"],
        "anpr_verified": True,
        "status":      vehicle["status"],
        "verified_by": req.verified_by,
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }
