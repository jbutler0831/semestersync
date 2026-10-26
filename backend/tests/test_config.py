import pytest
from pydantic import ValidationError
from app.config import Settings

BASE = {"database_url": "postgresql+psycopg://x@localhost/x", "token_pepper": "p" * 40}


def test_production_needs_real_email_and_rate_limits():
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", email_backend="console")
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", email_backend="smtp", rate_limits=False)
    assert Settings(**BASE, app_env="production", email_backend="smtp").app_env == "production"


def test_pepper_must_be_long():
    with pytest.raises(ValidationError):
        Settings(database_url=BASE["database_url"], token_pepper="short")
