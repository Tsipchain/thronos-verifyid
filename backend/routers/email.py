from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from dependencies.auth import get_admin_user
from schemas.auth import UserResponse
from services.email import EmailService

router = APIRouter(prefix="/api/v1/admin/email", tags=["admin-email"])


class TestEmailRequest(BaseModel):
    to_email: EmailStr
    subject: str = "VerifyID email service test"
    message: str = "This is a test email from VerifyID domain services integration."


@router.post("/test")
async def send_test_email(
    payload: TestEmailRequest,
    current_user: UserResponse = Depends(get_admin_user),
):
    """Admin-only endpoint to validate SMTP/domain email delivery configuration."""
    try:
        html_body = (
            "<div style='font-family:Arial,sans-serif;padding:16px'>"
            "<h2>VerifyID Email Service Test</h2>"
            f"<p>{payload.message}</p>"
            f"<p><strong>Triggered by:</strong> {current_user.email}</p>"
            "</div>"
        )
        EmailService.send_email(payload.to_email, payload.subject, html_body, payload.message)
        return {"status": "sent", "to": payload.to_email}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {exc}")
