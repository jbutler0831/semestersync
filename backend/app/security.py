"""Passwords (Argon2id via argon2-cffi), session tokens and one-time codes. No custom cryptography:
tokens and codes come from the secrets module and are stored only as HMAC-SHA256 with a server-side pepper."""
import hashlib
import hmac
import secrets
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from .config import settings

_hasher = PasswordHasher()  # Argon2id with the library's current recommended parameters
# A real hash of a random password, checked when an email doesn't exist so the response takes the same time.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    return _hasher.check_needs_rehash(stored_hash)


def _mac(value: str) -> bytes:
    return hmac.new(settings().token_pepper.encode(), value.encode(), hashlib.sha256).digest()


def new_session_token() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, _mac("session:" + token)


def session_token_hash(token: str) -> bytes:
    return _mac("session:" + token)


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_hash(user_id, purpose: str, code: str) -> bytes:
    return _mac(f"code:{purpose}:{user_id}:{code}")


def same(a: bytes, b: bytes) -> bool:
    return hmac.compare_digest(a, b)
