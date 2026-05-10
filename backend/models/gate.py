"""
models/gate.py
Strict Pydantic v2 schemas for the gate trigger API.
Field-level validation catches malformed input before it reaches business logic.
"""
import re
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


# ── Indonesian plate regex ─────────────────────────────────────────────────────
_PLATE_RE = re.compile(r"^[A-Z]{1,2}\d{1,4}[A-Z]{1,3}$")


class GateTriggerRequest(BaseModel):
    """Payload sent by the ANPR edge script to POST /api/v1/gate/trigger."""

    plate_number: str = Field(
        ...,
        min_length=4,
        max_length=12,
        description="Normalized plate (uppercase, no spaces). E.g. 'D4321ITB'",
        examples=["D4321ITB"],
    )
    gate_id: str = Field(
        default="G1",
        max_length=8,
        description="Hardware gate ID the ANPR camera is attached to.",
    )
    confidence: float = Field(
        default=0.95,
        ge=0.0,
        le=1.0,
        description="ANPR recognition confidence score (0.0 – 1.0).",
    )
    direction: Literal["entry", "exit"] = Field(
        default="entry",
        description="Whether this is a gate entry or exit trigger.",
    )

    @field_validator("plate_number")
    @classmethod
    def validate_plate(cls, v: str) -> str:
        normalized = v.upper().replace(" ", "")
        if not _PLATE_RE.match(normalized):
            raise ValueError(
                f"'{v}' is not a valid Indonesian plate number format."
            )
        return normalized

    @field_validator("gate_id")
    @classmethod
    def validate_gate_id(cls, v: str) -> str:
        allowed = {"G1", "G2", "G3", "G4", "EXIT1", "EXIT2"}
        if v not in allowed:
            raise ValueError(f"Unknown gate_id '{v}'. Must be one of {allowed}.")
        return v


class GateTriggerResponse(BaseModel):
    """Backend decision payload returned to the ANPR script."""

    action: Literal["open_gate", "deny_access", "cooldown", "low_confidence"]
    plate_number: str
    gate_id: str
    reason: str
    session_id: Optional[str] = None
    fee: Optional[int] = None            # Only on exit; in IDR (integer cents)
    owner: Optional[str] = None
    vehicle_model: Optional[str] = None
    timestamp: str


class ParkingSession(BaseModel):
    """Public-facing model for an active or historical parking session."""

    plate: str
    gate_id: str
    confidence: float
    entry_time: str
    exit_time: Optional[str] = None
    duration_secs: Optional[int] = None
    fee: Optional[int] = None
    status: Literal["active", "completed"]
