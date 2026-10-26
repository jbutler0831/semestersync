"""Request and response shapes. Passwords are length-checked here; nothing echoes them back."""
import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator

PASSWORD_MIN, PASSWORD_MAX = 8, 128


class EmailIn(BaseModel):
    email: EmailStr

    @field_validator("email", mode="after")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.strip().lower()


class RegisterIn(EmailIn):
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    device: str = Field("", max_length=80)


class LoginIn(EmailIn):
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    device: str = Field("", max_length=80)


class ResetConfirmIn(EmailIn):
    code: str = Field(pattern=r"^\s*\d{6}\s*$")
    new_password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    new_password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    email_verified: bool
    created_at: datetime
    sync_available: bool = True


class SessionOut(BaseModel):
    token: str
    expires_at: datetime
    user: UserOut


class DeviceOut(BaseModel):
    id: uuid.UUID
    device: str
    created_at: datetime
    last_seen_at: datetime
    current: bool


class Status(BaseModel):
    status: str
