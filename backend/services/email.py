import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from core.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    """Simple email service for domain/service integration via SMTP."""

    @staticmethod
    def is_configured() -> bool:
        return bool(
            settings.email_enabled
            and settings.smtp_host
            and settings.smtp_username
            and settings.smtp_password
            and settings.email_from_address
        )

    @staticmethod
    def send_email(to_email: str, subject: str, html_body: str, text_body: str | None = None) -> None:
        if not EmailService.is_configured():
            raise ValueError(
                "Email service is not configured. Set EMAIL_ENABLED=true and SMTP_* credentials."
            )

        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
        message["To"] = to_email
        if settings.email_reply_to:
            message["Reply-To"] = settings.email_reply_to

        plain_text = text_body or "This email requires HTML support."
        message.attach(MIMEText(plain_text, "plain", "utf-8"))
        message.attach(MIMEText(html_body, "html", "utf-8"))

        if settings.smtp_use_ssl:
            smtp_client = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20)
        else:
            smtp_client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)

        try:
            smtp_client.ehlo()
            if settings.smtp_use_tls and not settings.smtp_use_ssl:
                smtp_client.starttls()
                smtp_client.ehlo()
            smtp_client.login(settings.smtp_username, settings.smtp_password)
            smtp_client.sendmail(settings.email_from_address, [to_email], message.as_string())
            logger.info("Email sent successfully to %s", to_email)
        finally:
            smtp_client.quit()
