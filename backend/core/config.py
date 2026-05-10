"""
core/config.py
Environment-driven configuration. Create a `.env` file in /backend with these values.
Never commit `.env` to version control.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ── Application ──────────────────────────────────────────────────────────
    APP_NAME: str = "ANPR Parking Gate — ITB Jatinangor"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # ── Security ─────────────────────────────────────────────────────────────
    # Generate with: python -c "import secrets; print(secrets.token_hex(32))"
    JWT_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_32_BYTE_HEX"
    JWT_ALGORITHM: str = "HS256"

    # Static long-lived token issued to the ANPR edge script.
    # Rotate this periodically. Store in env variable on the camera PC.
    ANPR_SERVICE_TOKEN: str = "CHANGE_ME_ANPR_TOKEN"

    # Optional: token for the ESP32 WebSocket connection (query param)
    ESP32_GATE_TOKEN: str = "CHANGE_ME_ESP32_TOKEN"

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_COOLDOWN_TTL: int = 10       # seconds — duplicate-trigger suppression
    REDIS_SESSION_TTL: int = 86400     # 24 h  — active parking sessions

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Only allow the Next.js dev server and production domain
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "https://six.itb.ac.id"]

    # ── Gate Hardware ─────────────────────────────────────────────────────────
    GATE_OPEN_DURATION_MS: int = 1000  # milliseconds the relay stays HIGH


@lru_cache
def get_settings() -> Settings:
    return Settings()
