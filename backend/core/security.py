"""
core/security.py
Bearer-token validation for two distinct clients:
  1. ANPR script  → static pre-shared JWT (issued offline, long TTL)
  2. ESP32 firmware → WebSocket query-param token (short TTL, rotatable)

Using python-jose for JWT; no database round-trip on validation
→ sub-millisecond overhead, safe for real-time gate trigger path.
"""
from datetime import datetime, timezone, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import get_settings, Settings

# ── FastAPI dependency: extract Bearer header ─────────────────────────────────
_bearer_scheme = HTTPBearer(auto_error=True)


def _decode_token(token: str, settings: Settings) -> dict:
    """
    Decode and verify a JWT. Raises HTTP 401 on any failure.
    Keeps error messages intentionally vague to prevent oracle attacks.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_anpr_token(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """
    FastAPI dependency for the POST /gate/trigger endpoint.
    Validates the static ANPR service token and checks the 'sub' claim.
    """
    payload = _decode_token(credentials.credentials, settings)

    # Enforce service identity — the ANPR script must carry sub="anpr_service"
    if payload.get("sub") != "anpr_service":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: token does not have gate-trigger permission.",
        )
    return payload


def verify_esp32_token(token: str, settings: Settings) -> bool:
    """
    Lightweight check used in the ESP32 WebSocket handshake.
    Returns True/False (caller decides whether to close the socket).
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload.get("sub") == "esp32_gate"
    except JWTError:
        return False


# ── Token generation utilities (run once, offline) ───────────────────────────
def create_anpr_service_token(settings: Settings) -> str:
    """
    Generate the long-lived JWT for the ANPR edge script.
    Run this ONCE and store the output as ANPR_SERVICE_TOKEN in .env.
    
    Usage:
        python -c "
        from core.config import get_settings
        from core.security import create_anpr_service_token
        print(create_anpr_service_token(get_settings()))
        "
    """
    payload = {
        "sub": "anpr_service",
        "iss": "itb-parking-backend",
        "iat": datetime.now(timezone.utc),
        # 1-year expiry; rotate annually or on suspected compromise
        "exp": datetime.now(timezone.utc) + timedelta(days=365),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_esp32_gate_token(gate_id: str, settings: Settings) -> str:
    """Generate a short-lived (30-day) token for an ESP32 gate unit."""
    payload = {
        "sub": "esp32_gate",
        "gate_id": gate_id,
        "iss": "itb-parking-backend",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def require_dashboard_token(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """
    FastAPI dependency for dashboard API calls (vehicle CRUD, session stats).
    Accepts tokens with sub = 'dashboard_user' OR 'anpr_service' (for testing).
    """
    payload = _decode_token(credentials.credentials, settings)
    allowed = {"dashboard_user", "anpr_service"}
    if payload.get("sub") not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: insufficient permission.",
        )
    return payload


def create_dashboard_token(nim: str, settings: Settings) -> str:
    """Generate a session-scoped dashboard JWT for a logged-in student."""
    payload = {
        "sub": "dashboard_user",
        "nim": nim,
        "iss": "itb-parking-backend",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
