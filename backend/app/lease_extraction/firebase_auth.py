"""Firebase Admin verification and lazy credential initialization."""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any


class FirebaseUnavailable(RuntimeError):
    pass


class InvalidFirebaseToken(ValueError):
    pass


@dataclass(frozen=True)
class FirebaseServices:
    app: Any
    auth: Any
    firestore: Any
    project_id: str


_SERVICES: FirebaseServices | None = None
_SERVICES_LOCK = threading.Lock()


def firebase_configuration_available() -> bool:
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
    credential_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if not project_id or not credential_json:
        return False
    try:
        value = json.loads(credential_json)
        return isinstance(value, dict) and value.get("project_id") == project_id and bool(value.get("private_key"))
    except (ValueError, TypeError):
        return False


def _firebase_services() -> FirebaseServices:
    global _SERVICES
    if _SERVICES is not None:
        return _SERVICES
    with _SERVICES_LOCK:
        if _SERVICES is not None:
            return _SERVICES
        project_id = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
        raw_credentials = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
        if not project_id or not raw_credentials:
            raise FirebaseUnavailable("firebase_configuration_missing")
        try:
            credential_data = json.loads(raw_credentials)
            if not isinstance(credential_data, dict) or credential_data.get("project_id") != project_id:
                raise ValueError("project_mismatch")
            if not credential_data.get("private_key"):
                raise ValueError("credential_incomplete")
            import firebase_admin
            from firebase_admin import auth, credentials, firestore
            try:
                app = firebase_admin.get_app("nestwise")
            except ValueError:
                app = firebase_admin.initialize_app(
                    credentials.Certificate(credential_data),
                    {"projectId": project_id},
                    name="nestwise",
                )
            _SERVICES = FirebaseServices(app, auth, firestore, project_id)
            return _SERVICES
        except FirebaseUnavailable:
            raise
        except Exception:
            raise FirebaseUnavailable("firebase_initialization_failed") from None


def verify_firebase_id_token(id_token: str) -> str:
    if not isinstance(id_token, str) or not id_token or len(id_token) > 8192:
        raise InvalidFirebaseToken("invalid_token")
    services = _firebase_services()
    try:
        claims = services.auth.verify_id_token(id_token, app=services.app, check_revoked=True)
    except (services.auth.InvalidIdTokenError, services.auth.ExpiredIdTokenError,
            services.auth.RevokedIdTokenError, services.auth.UserDisabledError, ValueError):
        raise InvalidFirebaseToken("invalid_token") from None
    except Exception:
        # Certificate fetch or Firebase availability errors are temporary service failures.
        raise FirebaseUnavailable("firebase_token_verification_unavailable") from None

    uid = claims.get("uid")
    subject = claims.get("sub")
    firebase_claims = claims.get("firebase")
    expected_issuer = f"https://securetoken.google.com/{services.project_id}"
    exp, issued_at = claims.get("exp"), claims.get("iat")
    if (not isinstance(uid, str) or not uid or uid != subject
            or claims.get("aud") != services.project_id or claims.get("iss") != expected_issuer
            or not isinstance(firebase_claims, dict) or firebase_claims.get("sign_in_provider") != "google.com"
            or type(exp) is not int or exp <= int(time.time())
            or type(issued_at) is not int or issued_at > int(time.time()) + 60):
        raise InvalidFirebaseToken("invalid_token")
    return uid


def firestore_client():
    services = _firebase_services()
    try:
        return services.firestore.client(app=services.app)
    except Exception:
        raise FirebaseUnavailable("firestore_initialization_failed") from None

