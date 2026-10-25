from __future__ import annotations

import copy
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app.lease_extraction import firebase_auth, quota
from backend.app.lease_extraction.firebase_auth import FirebaseServices, InvalidFirebaseToken
from backend.app.lease_extraction.quota import (
    ConcurrentLimitReached,
    GlobalDailyLimitReached,
    QuotaLimits,
    QuotaUnavailable,
    UserDailyLimitReached,
    finish_reservation,
    reserve_extraction,
)
from backend.app.main import app


PROJECT = "nestwise-firebase-test"


def service_account_json(project: str = PROJECT) -> str:
    return json.dumps({"project_id": project, "private_key": "synthetic-private-key"})


def set_enabled_firebase_env(monkeypatch):
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-gemini-key")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", PROJECT)
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", service_account_json())
    monkeypatch.setenv("NESTWISE_GEMINI_USER_DAILY_LIMIT", "3")
    monkeypatch.setenv("NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT", "60")
    monkeypatch.setenv("NESTWISE_GEMINI_MAX_CONCURRENT", "2")


class FakeReference:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, name):
        return FakeReference(self.db, f"{self.path}/{name}")

    def collection(self, name):
        return FakeReference(self.db, f"{self.path}/{name}")

    def get(self, transaction=None):
        return SimpleNamespace(to_dict=lambda: copy.deepcopy(self.db.values.get(self.path)))


class FakeTransaction:
    def __init__(self, db):
        self.db = db

    def set(self, reference, value, merge=False):
        old = self.db.values.get(reference.path, {}) if merge else {}
        self.db.values[reference.path] = {**old, **copy.deepcopy(value)}


class FakeFirestore:
    def __init__(self):
        self.values = {}
        self.lock = threading.RLock()

    def collection(self, name):
        return FakeReference(self, name)

    def transaction(self):
        return FakeTransaction(self)


@pytest.fixture
def transactional_fake_firestore(monkeypatch):
    from firebase_admin import firestore

    def transactional(function):
        def run(transaction, *args, **kwargs):
            with transaction.db.lock:
                return function(transaction, *args, **kwargs)
        return run

    monkeypatch.setattr(firestore, "transactional", transactional)
    return FakeFirestore()


def test_admin_verifier_accepts_correct_project_and_rejects_wrong_audience_or_expiry(monkeypatch):
    now = int(time.time())

    class InvalidToken(Exception):
        pass

    class FakeAuth:
        InvalidIdTokenError = InvalidToken
        ExpiredIdTokenError = InvalidToken
        RevokedIdTokenError = InvalidToken
        UserDisabledError = InvalidToken

        claims = {"uid": "verified-uid", "sub": "verified-uid", "aud": PROJECT,
                  "iss": f"https://securetoken.google.com/{PROJECT}", "exp": now + 120, "iat": now - 30,
                  "firebase": {"sign_in_provider": "google.com"}}

        def verify_id_token(self, _token, **kwargs):
            assert kwargs["check_revoked"] is True
            return self.claims

    services = FirebaseServices(object(), FakeAuth(), object(), PROJECT)
    monkeypatch.setattr(firebase_auth, "_firebase_services", lambda: services)
    assert firebase_auth.verify_firebase_id_token("synthetic-signed-token") == "verified-uid"
    services.auth.claims = {**services.auth.claims, "aud": "another-project"}
    with pytest.raises(InvalidFirebaseToken):
        firebase_auth.verify_firebase_id_token("synthetic-signed-token")
    services.auth.claims = {**services.auth.claims, "aud": PROJECT, "exp": now - 1}
    with pytest.raises(InvalidFirebaseToken):
        firebase_auth.verify_firebase_id_token("synthetic-signed-token")
    services.auth.claims = {**services.auth.claims, "exp": now + 120, "firebase": {"sign_in_provider": "password"}}
    with pytest.raises(InvalidFirebaseToken):
        firebase_auth.verify_firebase_id_token("synthetic-signed-token")


def test_firebase_configuration_requires_matching_project_and_private_server_credentials(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", PROJECT)
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", service_account_json("different-project"))
    assert firebase_auth.firebase_configuration_available() is False
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", service_account_json())
    assert firebase_auth.firebase_configuration_available() is True
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    assert firebase_auth.firebase_configuration_available() is False


def test_production_extraction_requires_bearer_and_feature_flag_cannot_be_bypassed(monkeypatch):
    import backend.app.api.lease_routes as routes
    set_enabled_firebase_env(monkeypatch)
    routes._REQUEST_TIMES.clear()
    monkeypatch.setattr(routes, "_reserve_user_quota", lambda _uid: object())
    monkeypatch.setattr(routes, "_release_quota", lambda _reservation: None)
    monkeypatch.setattr(routes, "verify_firebase_id_token", lambda _token: (_ for _ in ()).throw(InvalidFirebaseToken("secret detail")))
    with TestClient(app) as client:
        signed_out = client.post("/api/lease/extract-text", json={"text": "Synthetic lease terms."})
        invalid = client.post("/api/lease/extract-text", json={"text": "Synthetic lease terms."}, headers={"Authorization": "Bearer forged-user-id"})
        monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "false")
        disabled = client.post("/api/lease/extract-text", json={"text": "Synthetic lease terms."}, headers={"Authorization": "Bearer any-token"})
    assert signed_out.status_code == 401
    assert invalid.status_code == 401 and "secret detail" not in invalid.text
    assert disabled.status_code == 503


def test_valid_verified_google_uid_reaches_extraction_but_body_cannot_choose_identity(monkeypatch):
    import backend.app.api.lease_routes as routes
    from backend.app.lease_extraction.models import CandidateTerm, LeaseExtraction
    set_enabled_firebase_env(monkeypatch)
    routes._REQUEST_TIMES.clear()
    seen_uids = []
    monkeypatch.setattr(routes, "verify_firebase_id_token", lambda token: "verified-google-uid" if token == "valid-mocked-firebase-id-token" else None)
    monkeypatch.setattr(routes, "reserve_extraction", lambda uid, _limits: (seen_uids.append(uid) or object()))
    monkeypatch.setattr(routes, "finish_reservation", lambda _reservation: None)
    monkeypatch.setattr(routes, "extract_with_gemini", lambda *_args, **_kwargs: LeaseExtraction(terms=[CandidateTerm(field_id="monthly_base_rent", status="not_found")]))
    with TestClient(app) as client:
        response = client.post("/api/lease/extract-text", json={"text": "Synthetic redacted lease."}, headers={"Authorization": "Bearer valid-mocked-firebase-id-token"})
        forged_uid = client.post("/api/lease/extract-text", json={"text": "Synthetic redacted lease.", "uid": "administrator"}, headers={"Authorization": "Bearer valid-mocked-firebase-id-token"})
    assert response.status_code == 200
    assert seen_uids == ["verified-google-uid"]
    assert forged_uid.status_code == 422


@pytest.mark.parametrize("missing", ["FIREBASE_PROJECT_ID", "FIREBASE_SERVICE_ACCOUNT_JSON", "NESTWISE_GEMINI_USER_DAILY_LIMIT", "NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT"])
def test_missing_production_auth_or_quota_configuration_fails_closed(monkeypatch, missing):
    set_enabled_firebase_env(monkeypatch)
    monkeypatch.delenv(missing)
    status = firebase_auth.firebase_configuration_available()
    from backend.app.lease_extraction.config import provider_status
    ready = provider_status()["service_ready"]
    assert not ready
    if missing.startswith("FIREBASE_"):
        assert status is False
    else:
        assert status is True


def test_fire_store_reservations_enforce_user_global_and_concurrent_quotas_atomically(transactional_fake_firestore):
    db = transactional_fake_firestore
    now = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    with pytest.raises(UserDailyLimitReached):
        first = reserve_extraction("user-one", QuotaLimits(1, 10, 2), db=db, now=now)
        # A completed/failed provider call still consumes its daily reservation.
        finish_reservation(first, db=db)
        reserve_extraction("user-one", QuotaLimits(1, 10, 2), db=db, now=now)

    db.values.clear()
    reserve_extraction("user-a", QuotaLimits(10, 1, 2), db=db, now=now)
    with pytest.raises(GlobalDailyLimitReached):
        reserve_extraction("user-b", QuotaLimits(10, 1, 2), db=db, now=now)

    db.values.clear()
    barrier = threading.Barrier(2)
    outcomes = []

    def reserve(user):
        barrier.wait()
        try:
            outcomes.append(reserve_extraction(user, QuotaLimits(10, 10, 1), db=db, now=now))
        except ConcurrentLimitReached:
            outcomes.append("concurrent-limit")

    threads = [threading.Thread(target=reserve, args=(f"parallel-{i}",)) for i in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert sum(item == "concurrent-limit" for item in outcomes) == 1
    assert sum(item != "concurrent-limit" for item in outcomes) == 1


def test_firestore_reservation_expires_and_usage_stores_only_hashed_uid(transactional_fake_firestore):
    db = transactional_fake_firestore
    first_time = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    first = reserve_extraction("private-firebase-uid", QuotaLimits(3, 10, 1), db=db, now=first_time)
    next_reservation = reserve_extraction("another-user", QuotaLimits(3, 10, 1), db=db, now=first_time + timedelta(seconds=181))
    assert first.day == next_reservation.day
    assert all("private-firebase-uid" not in path for path in db.values)
    assert any("users/" in path for path in db.values)


def test_firestore_unavailable_fails_closed():
    class BrokenDb:
        def collection(self, _name): raise OSError("private connection detail")

    with pytest.raises(QuotaUnavailable):
        reserve_extraction("user", QuotaLimits(3, 60, 2), db=BrokenDb())


def test_authenticated_pdf_keeps_existing_upload_limit_and_public_finance_routes_stay_open(monkeypatch):
    import backend.app.api.lease_routes as routes
    from tests.test_rental_api import offer
    set_enabled_firebase_env(monkeypatch)
    routes._REQUEST_TIMES.clear()
    monkeypatch.setattr(routes, "verify_firebase_id_token", lambda _token: "verified-google-uid")
    monkeypatch.setattr(routes, "_reserve_user_quota", lambda _uid: object())
    monkeypatch.setattr(routes, "_release_quota", lambda _reservation: None)
    large_pdf = b"%PDF-" + b"x" * (10 * 1024 * 1024)
    with TestClient(app) as client:
        oversized = client.post("/api/lease/extract-pdf", files={"file": ("redacted.pdf", large_pdf, "application/pdf")}, headers={"Authorization": "Bearer valid-token"})
        evaluated = client.post("/api/rental/evaluate", json={"offer": offer()})
        compared = client.post("/api/rental/compare", json={"left_offer": offer("A"), "right_offer": offer("B", 1100)})
        stressed = client.post("/api/rental/stress-test", json={"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 10, "first_affected_month": 1, "last_affected_month": 1}})
    assert oversized.status_code == 413
    assert evaluated.status_code == compared.status_code == stressed.status_code == 200
