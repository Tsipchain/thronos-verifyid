import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, HttpUrl

from core.config import settings
from services.email import EmailService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/services", tags=["services"])


class ServicePackage(BaseModel):
    code: str
    name: str
    monthly_price_eur: int
    description: str
    features: list[str]


class ServiceLeadRequest(BaseModel):
    company_name: str
    contact_name: str
    email: EmailStr
    phone: str
    package_code: str
    needs_web2_domain: bool = True
    needs_web3_domain: bool = False
    web3_tld: str | None = None
    needs_hosting: bool = True
    hosting_tier: Literal["starter", "business", "enterprise"] = "starter"
    logo_url: HttpUrl | None = None
    notes: str | None = None


SERVICE_PACKAGES: list[ServicePackage] = [
    ServicePackage(
        code="starter",
        name="Starter Business Identity",
        monthly_price_eur=99,
        description="Για μικρές ομάδες που θέλουν εταιρικό email + domain + βασικό hosting.",
        features=[
            "1 Web2 domain (.com/.org)",
            "Up to 10 corporate mailboxes",
            "Managed DNS + SSL",
            "Basic web hosting",
            "Partner logo placement request",
        ],
    ),
    ServicePackage(
        code="growth",
        name="Growth Web2 + Web3",
        monthly_price_eur=249,
        description="Για εταιρείες που θέλουν πλήρη παρουσία σε Web2 και Web3.",
        features=[
            "1 Web2 domain + 1 Web3 name",
            "Up to 50 corporate mailboxes",
            "Priority hosting",
            "Traffic analytics",
            "Dedicated onboarding specialist",
        ],
    ),
    ServicePackage(
        code="enterprise",
        name="Enterprise Sovereign Stack",
        monthly_price_eur=799,
        description="Για call-centers/enterprise πελάτες με full managed υπηρεσίες.",
        features=[
            "Multi-domain architecture",
            "Unlimited corporate mailboxes",
            "High-availability hosting",
            "SLA + incident response",
            "Custom partner branding + logo integration",
        ],
    ),
]


@router.get("/packages", response_model=list[ServicePackage])
async def list_service_packages():
    return SERVICE_PACKAGES


@router.post("/leads")
async def create_service_lead(payload: ServiceLeadRequest):
    package_exists = any(pkg.code == payload.package_code for pkg in SERVICE_PACKAGES)
    if not package_exists:
        raise HTTPException(status_code=400, detail="Invalid package_code")

    logger.info(
        "[services] new lead company=%s email=%s package=%s web2=%s web3=%s hosting=%s",
        payload.company_name,
        payload.email,
        payload.package_code,
        payload.needs_web2_domain,
        payload.needs_web3_domain,
        payload.needs_hosting,
    )

    if EmailService.is_configured():
        sales_inbox = getattr(settings, "sales_inbox_email", "sales@thronoschain.org")
        html_body = (
            "<h2>New Services Lead</h2>"
            f"<p><strong>Company:</strong> {payload.company_name}</p>"
            f"<p><strong>Contact:</strong> {payload.contact_name} ({payload.email})</p>"
            f"<p><strong>Phone:</strong> {payload.phone}</p>"
            f"<p><strong>Package:</strong> {payload.package_code}</p>"
            f"<p><strong>Web2 Domain:</strong> {payload.needs_web2_domain}</p>"
            f"<p><strong>Web3 Domain:</strong> {payload.needs_web3_domain}</p>"
            f"<p><strong>Hosting:</strong> {payload.needs_hosting} ({payload.hosting_tier})</p>"
            f"<p><strong>Logo URL:</strong> {payload.logo_url or '-'}</p>"
            f"<p><strong>Notes:</strong> {payload.notes or '-'}</p>"
        )
        try:
            EmailService.send_email(
                to_email=sales_inbox,
                subject=f"New Thronos Service Lead - {payload.company_name}",
                html_body=html_body,
                text_body=f"New lead from {payload.company_name} ({payload.email})",
            )
        except Exception as exc:
            logger.warning("Failed to send lead email notification: %s", exc)

    return {
        "status": "received",
        "message": "Your request has been received. Our team will contact you shortly.",
    }
