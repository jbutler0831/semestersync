"""Sends account emails. Codes appear only in the email body, never in logs."""
import logging
import smtplib
import ssl
from email.message import EmailMessage
from .config import settings

log = logging.getLogger("semestersync.email")
outbox: list[dict] = []  # the 'memory' backend, used by tests


def send(to: str, subject: str, text: str) -> None:
    s = settings()
    if s.email_backend == "memory":
        outbox.append({"to": to, "subject": subject, "text": text})
        return
    if s.email_backend == "console":
        if s.app_env == "production":
            raise RuntimeError("The console email backend is for development only")
        print(f"\n--- email to {to}: {subject}\n{text}\n---\n", flush=True)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.email_from, to, subject
    msg.set_content(text)
    ctx = ssl.create_default_context()
    if s.smtp_ssl:
        server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ctx, timeout=15)
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
    with server:
        if s.smtp_starttls:
            server.starttls(context=ctx)
        if s.smtp_username:
            server.login(s.smtp_username, s.smtp_password)
        server.send_message(msg)
    log.info("email sent", extra={"purpose": subject})


def send_code(to: str, purpose: str, code: str, minutes: int) -> None:
    """Only password reset sends a code (purpose "reset")."""
    send(to, "Reset your SemesterSync password",
         f"Your SemesterSync password reset code is:\n\n    {code}\n\nEnter it in the app with your new password. It expires in {minutes} minutes.\n\nIf you didn't ask to reset your password, you can ignore this email; your password hasn't changed.")
