"""Atomic daily Firebase/Firestore quotas for ephemeral Gemini extractions."""
from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .firebase_auth import FirebaseUnavailable, firestore_client

RESERVATION_LEASE_SECONDS = 180
COLLECTION_NAME = "nestwise_gemini_daily"


class QuotaUnavailable(RuntimeError):
    pass


class UserDailyLimitReached(RuntimeError):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


class GlobalDailyLimitReached(RuntimeError):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


class ConcurrentLimitReached(RuntimeError):
    pass


@dataclass(frozen=True)
class QuotaLimits:
    user_daily: int
    global_daily: int
    concurrent: int


@dataclass(frozen=True)
class QuotaReservation:
    day: str
    reservation_id: str


def quota_limits_from_environment() -> QuotaLimits | None:
    try:
        user_daily = int(os.environ["NESTWISE_GEMINI_USER_DAILY_LIMIT"])
        global_daily = int(os.environ["NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT"])
        concurrent = int(os.environ.get("NESTWISE_GEMINI_MAX_CONCURRENT", "2"))
    except (KeyError, ValueError):
        return None
    if not (1 <= user_daily <= 3 and 1 <= global_daily <= 60 and 1 <= concurrent <= 2):
        return None
    return QuotaLimits(user_daily, global_daily, concurrent)


def _hash_uid(uid: str) -> str:
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()


def _retry_after_utc(now: datetime) -> int:
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def _get_db(db: Any = None):
    if db is not None:
        return db
    try:
        return firestore_client()
    except FirebaseUnavailable:
        raise QuotaUnavailable("quota_database_unavailable") from None


def reserve_extraction(uid: str, limits: QuotaLimits, *, db: Any = None, now: datetime | None = None) -> QuotaReservation:
    """Atomically consume one daily attempt and reserve one shared in-flight slot.

    A Gemini/provider failure does not restore the daily count. This deliberately
    bounds retries; the short-lived in-flight lease is always released by the
    caller when possible and expires after three minutes if the process disappears.
    """
    database = _get_db(db)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    day = current.strftime("%Y-%m-%d")
    retry_after = _retry_after_utc(current)
    reservation_id = uuid.uuid4().hex
    expires_at = current + timedelta(seconds=RESERVATION_LEASE_SECONDS)
    quota_expires_at = current + timedelta(days=30)
    try:
        daily_ref = database.collection(COLLECTION_NAME).document(day)
        user_ref = daily_ref.collection("users").document(_hash_uid(uid))
        transaction = database.transaction()
        from firebase_admin import firestore

        @firestore.transactional
        def _reserve(tx):
            daily_snapshot = daily_ref.get(transaction=tx)
            user_snapshot = user_ref.get(transaction=tx)
            daily = daily_snapshot.to_dict() or {}
            user = user_snapshot.to_dict() or {}
            active = [
                item for item in daily.get("active_reservations", [])
                if isinstance(item, dict) and item.get("expires_at") and item["expires_at"] > current
            ]
            if int(user.get("request_count", 0)) >= limits.user_daily:
                raise UserDailyLimitReached(retry_after)
            if int(daily.get("request_count", 0)) >= limits.global_daily:
                raise GlobalDailyLimitReached(retry_after)
            if len(active) >= limits.concurrent:
                raise ConcurrentLimitReached()
            active.append({"reservation_id": reservation_id, "expires_at": expires_at})
            # Counts are consumed at reservation. Failed upstream attempts remain charged.
            tx.set(daily_ref, {"request_count": int(daily.get("request_count", 0)) + 1,
                               "active_reservations": active, "expire_at": quota_expires_at}, merge=True)
            tx.set(user_ref, {"request_count": int(user.get("request_count", 0)) + 1,
                              "expire_at": quota_expires_at}, merge=True)

        _reserve(transaction)
        return QuotaReservation(day, reservation_id)
    except (UserDailyLimitReached, GlobalDailyLimitReached, ConcurrentLimitReached):
        raise
    except Exception:
        raise QuotaUnavailable("quota_reservation_failed") from None


def finish_reservation(reservation: QuotaReservation, *, db: Any = None) -> None:
    """Release only the concurrency lease; daily attempt counts are never decremented."""
    database = _get_db(db)
    try:
        daily_ref = database.collection(COLLECTION_NAME).document(reservation.day)
        transaction = database.transaction()
        from firebase_admin import firestore

        @firestore.transactional
        def _finish(tx):
            snapshot = daily_ref.get(transaction=tx)
            daily = snapshot.to_dict() or {}
            active = [item for item in daily.get("active_reservations", [])
                      if isinstance(item, dict) and item.get("reservation_id") != reservation.reservation_id]
            tx.set(daily_ref, {"active_reservations": active}, merge=True)

        _finish(transaction)
    except Exception:
        # The lease expires automatically. Do not expose Firestore details or restore quotas.
        raise QuotaUnavailable("quota_reservation_release_failed") from None

