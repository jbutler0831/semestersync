"""SemesterSync account API."""
import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from .config import settings
from .db import engine
from .routers import account, auth, rooms, sync

MAX_BODY = 16 * 1024
MAX_SYNC_BODY = 4 * 1024 * 1024  # a batch of synced documents
log = logging.getLogger("semestersync")

prod = settings().app_env == "production"
app = FastAPI(title="SemesterSync API", version="0.1.0",
              docs_url=None if prod else "/docs", redoc_url=None, openapi_url=None if prod else "/openapi.json")
app.include_router(auth.router)
app.include_router(account.router)
app.include_router(sync.router)
app.include_router(rooms.router)


def error(status: int, code: str, message: str, headers=None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    if isinstance(exc.detail, dict):
        return error(exc.status_code, exc.detail.get("code", "error"), exc.detail.get("message", ""), exc.headers)
    return error(exc.status_code, "not_found" if exc.status_code == 404 else "error", str(exc.detail), exc.headers)


@app.exception_handler(RequestValidationError)
async def invalid(request: Request, exc: RequestValidationError):
    # Says which fields are wrong without echoing what was sent (it may be a password).
    fields = sorted({str(e["loc"][-1]) for e in exc.errors() if e.get("loc")})
    msg = "Check " + ", ".join(fields) + "." if fields else "The request wasn't valid."
    if "password" in fields or "new_password" in fields:
        msg = "Passwords need 8 to 128 characters." if fields in (["password"], ["new_password"]) else msg
    if fields == ["email"]:
        msg = "Enter a valid email address."
    return error(422, "invalid_request", msg)


@app.exception_handler(Exception)
async def crashed(request: Request, exc: Exception):
    log.error("unhandled error on %s %s: %s", request.method, request.url.path, type(exc).__name__)
    return error(500, "server_error", "Something went wrong on our side. Try again in a moment.")


@app.middleware("http")
async def guard(request: Request, call_next):
    size = request.headers.get("content-length")
    limit = MAX_SYNC_BODY if request.url.path == "/v1/sync/push" else MAX_BODY
    if size and (not size.isdigit() or int(size) > limit):
        return error(413, "too_large", "That request is too large.")
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if prod:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


@app.get("/healthz")
def health():
    with engine().connect() as c:
        c.execute(text("select 1"))
    return {"status": "ok"}
