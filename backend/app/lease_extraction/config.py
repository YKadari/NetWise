"""Secret-safe local Gemini configuration."""
from __future__ import annotations

import os
from pathlib import Path


def is_production_environment() -> bool:
    return os.environ.get("NESTWISE_ENV", "").strip().casefold() in {"production", "prod"}


def load_environment() -> None:
    # Production secrets/configuration come from the hosting environment only.
    if is_production_environment():
        return
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=False)


def extraction_enabled() -> bool:
    """Default on for local development, off in production unless explicitly enabled."""
    load_environment()
    raw = os.environ.get("NESTWISE_ENABLE_PUBLIC_GEMINI")
    if raw is None:
        return not is_production_environment()
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def provider_status() -> dict[str, object]:
    load_environment()
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    configured = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    enabled = extraction_enabled()
    return {"configured": configured, "model": model, "service_ready": configured and enabled}


def get_api_key() -> str | None:
    load_environment()
    return os.environ.get("GEMINI_API_KEY", "").strip() or None


def get_model() -> str:
    load_environment()
    return os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
