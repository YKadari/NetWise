"""Deterministic housing optimization over the public Chicago dataset."""

from .engine import optimize_housing
from .models import Preferences

__all__ = ["Preferences", "optimize_housing"]
