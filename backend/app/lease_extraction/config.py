"""Secret-safe local Gemini configuration."""
from __future__ import annotations

import os
from pathlib import Path


def load_environment() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=False)


def provider_status() -> dict[str, object]:
    load_environment()
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    configured = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    return {"configured": configured, "model": model, "service_ready": configured}


def get_api_key() -> str | None:
    load_environment()
    return os.environ.get("GEMINI_API_KEY", "").strip() or None


def get_model() -> str:
    load_environment()
    return os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
