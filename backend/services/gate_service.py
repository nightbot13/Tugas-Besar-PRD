"""
services/gate_service.py
Core business logic for gate trigger decisions.
Separated from the router so it can be unit-tested independently.

Decision tree for entry:
  1. Confidence < 85%         → deny (low_confidence)
  2. Plate in cooldown window → skip (cooldown)
  3. Plate not registered     → deny (unregistered)
  4. Vehicle status blocked   → deny (blocked)
  5. Already has active session (duplicate entry) → deny (already_inside)
  6. All checks pass          → open_gate, create session, send WS command

Decision tree for exit:
  1. No active session found  → deny (no_active_session)
  2. Pass                     → open_gate, close session, charge billing
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from core.database import (
    check_cooldown,
    set_cooldown,
    lookup_vehicle,
    get_active_session,
    create_session,
    close_session,
    HISTORY_DB,
)
from models.gate import GateTriggerRequest, GateTriggerResponse
from services.ws_manager import ws_manager

logger = logging.getLogger("gate_service")

CONFIDENCE_THRESHOLD = 0.85


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def process_gate_trigger(req: GateTriggerRequest) -> GateTriggerResponse:
    plate = req.plate_number  # Already normalized by Pydantic validator
    ts = _now_iso()

    # ── 1. Confidence gate ────────────────────────────────────────────────────
    if req.confidence < CONFIDENCE_THRESHOLD:
        logger.warning("[%s] Low confidence %.2f — access denied.", plate, req.confidence)
        return GateTriggerResponse(
            action="low_confidence",
            plate_number=plate,
            gate_id=req.gate_id,
            reason=f"ANPR confidence {req.confidence:.0%} below threshold {CONFIDENCE_THRESHOLD:.0%}. Gate held; security notified.",
            timestamp=ts,
        )

    # ── 2. Cooldown check (anti-replay / duplicate trigger) ───────────────────
    if await check_cooldown(plate):
        logger.info("[%s] In cooldown window — skipping.", plate)
        return GateTriggerResponse(
            action="cooldown",
            plate_number=plate,
            gate_id=req.gate_id,
            reason="Duplicate trigger within cooldown window. Ignoring.",
            timestamp=ts,
        )

    # ── 3. Database lookup ────────────────────────────────────────────────────
    vehicle: Optional[dict] = await lookup_vehicle(plate)
    if not vehicle:
        logger.warning("[%s] Plate not registered.", plate)
        await set_cooldown(plate)
        return GateTriggerResponse(
            action="deny_access",
            plate_number=plate,
            gate_id=req.gate_id,
            reason="Plate not registered in ITB Jatinangor parking system.",
            timestamp=ts,
        )

    # ── 4. ANPR verification check ────────────────────────────────────────────
    # A vehicle must be ANPR-verified by a petugas before the gate opens.
    # This is the authoritative access control — status field is secondary.
    if not vehicle.get("anpr_verified", False):
        logger.warning("[%s] Not ANPR-verified — access denied.", plate)
        await set_cooldown(plate)
        return GateTriggerResponse(
            action="deny_access",
            plate_number=plate,
            gate_id=req.gate_id,
            reason="Kendaraan belum diverifikasi ANPR oleh petugas. Hubungi pos parkir untuk verifikasi.",
            timestamp=ts,
        )

    # ── 5. Vehicle status check (blocked = explicitly banned) ─────────────────
    if vehicle.get("status") == "blocked":
        logger.warning("[%s] Vehicle is blocked.", plate)
        await set_cooldown(plate)
        return GateTriggerResponse(
            action="deny_access",
            plate_number=plate,
            gate_id=req.gate_id,
            reason="Akses kendaraan diblokir. Hubungi keamanan kampus.",
            timestamp=ts,
        )

    # ── ENTRY flow ─────────────────────────────────────────────────────────────
    if req.direction == "entry":
        existing_session = await get_active_session(plate)
        if existing_session:
            logger.warning("[%s] Already has active session — anomaly detected.", plate)
            await set_cooldown(plate)
            return GateTriggerResponse(
                action="deny_access",
                plate_number=plate,
                gate_id=req.gate_id,
                reason="Vehicle already has an active session. Possible plate cloning — flagged for review.",
                timestamp=ts,
            )

        session = await create_session(plate, req.gate_id, req.confidence)
        await set_cooldown(plate)

        # Broadcast event to dashboard over WebSocket
        event = {
            "type": "gate_entry",
            "plate": plate,
            "plate_raw": vehicle["plate_raw"],
            "gate_id": req.gate_id,
            "owner": vehicle["owner"],
            "vehicle_model": vehicle["model"],
            "confidence": req.confidence,
            "timestamp": ts,
        }
        await ws_manager.broadcast_gate_event(event)

        # Command the physical gate to open
        delivered = await ws_manager.send_gate_command(req.gate_id, {
            "action": "open_gate",
            "gate_id": req.gate_id,
            "duration_ms": 1000,
            "plate": plate,
        })
        if not delivered:
            logger.error("[%s] Gate '%s' is offline — trigger not delivered!", plate, req.gate_id)

        logger.info("[%s] Entry approved → gate %s opened.", plate, req.gate_id)
        return GateTriggerResponse(
            action="open_gate",
            plate_number=plate,
            gate_id=req.gate_id,
            reason="Vehicle registered and access granted.",
            session_id=session["entry_time"],
            owner=vehicle["owner"],
            vehicle_model=vehicle["model"],
            timestamp=ts,
        )

    # ── EXIT flow ──────────────────────────────────────────────────────────────
    else:
        session = await close_session(plate)
        if not session:
            await set_cooldown(plate)
            return GateTriggerResponse(
                action="deny_access",
                plate_number=plate,
                gate_id=req.gate_id,
                reason="No active session found. Vehicle may not have entered through ANPR gate.",
                timestamp=ts,
            )

        await set_cooldown(plate)

        event = {
            "type": "gate_exit",
            "plate": plate,
            "plate_raw": vehicle["plate_raw"],
            "gate_id": req.gate_id,
            "owner": vehicle["owner"],
            "vehicle_model": vehicle["model"],
            "duration_secs": session["duration_secs"],
            "fee": session["fee"],
            "confidence": req.confidence,
            "timestamp": ts,
        }
        await ws_manager.broadcast_gate_event(event)
        await ws_manager.send_gate_command(req.gate_id, {
            "action": "open_gate",
            "gate_id": req.gate_id,
            "duration_ms": 1000,
            "plate": plate,
        })

        logger.info("[%s] Exit approved → fee Rp%d → gate %s opened.", plate, session["fee"], req.gate_id)
        return GateTriggerResponse(
            action="open_gate",
            plate_number=plate,
            gate_id=req.gate_id,
            reason="Exit processed. Billing complete.",
            fee=session["fee"],
            owner=vehicle["owner"],
            vehicle_model=vehicle["model"],
            timestamp=ts,
        )


async def get_history(limit: int = 50) -> list[dict]:
    """Return the last N parking sessions (newest first)."""
    return list(reversed(HISTORY_DB[-limit:]))
