"""Settings come only from environment variables (or a local .env in development). No secrets in code."""
from functools import lru_cache
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field("development", description="development, test or production")
    database_url: str = Field(..., description="postgresql+psycopg://user:pass@host:5432/db")
    # Secret key mixed into every stored token and code hash, so a database leak alone can't be used to
    # check guesses. At least 32 random bytes; generate with: python -c "import secrets;print(secrets.token_urlsafe(48))"
    token_pepper: str = Field(..., min_length=32)

    session_days: int = 60
    code_minutes: int = 15
    code_max_attempts: int = 5

    email_backend: str = Field("smtp", description="smtp, console (development only) or memory (tests)")
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = False
    smtp_ssl: bool = False
    email_from: str = "SemesterSync <no-reply@localhost>"

    # Only trust X-Forwarded-For when the API runs behind your own reverse proxy (Caddy in production).
    trust_proxy: bool = False
    # Rate limits can be relaxed in tests that aren't about rate limits.
    rate_limits: bool = True

    @model_validator(mode="after")
    def production_rules(self):
        if self.email_backend not in ("smtp", "console", "memory"):
            raise ValueError("EMAIL_BACKEND must be smtp, console or memory")
        if self.app_env == "production" and (self.email_backend != "smtp" or not self.rate_limits):
            raise ValueError("Production sends real email (EMAIL_BACKEND=smtp) and keeps rate limits on")
        return self


@lru_cache
def settings() -> Settings:
    return Settings()
