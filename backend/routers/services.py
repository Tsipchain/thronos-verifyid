import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, HttpUrl

from core.config import settings
from services.email import EmailService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/services", tags=["services"])


# ── Models ─────────────────────────────────────────────────────────────────

class ServicePackage(BaseModel):
    code: str
    name: str
    monthly_price_eur: int
    description: str
    features: list[str]


class VerifyIDPlan(BaseModel):
    code: str
    name: str
    monthly_price_eur: int
    verifications_per_month: str
    agents: str
    features: list[str]
    highlight: bool = False


class ServiceCategory(BaseModel):
    code: str
    name: str
    description: str
    icon: str


class CallCenterOption(BaseModel):
    code: str
    name: str
    description: str
    note: str


class ServiceLeadRequest(BaseModel):
    # Organisation identity
    company_name: str
    org_type: str = "other"           # taxi_school | drone_operator | fleet | call_center | other
    contact_name: str                  # primary contact / general director
    email: EmailStr                    # primary email
    phone: str

    # Contacts — manager + general director support (multiple)
    manager_emails: list[EmailStr] = []
    staff_count: int = 1

    # VerifyID service selections
    selected_services: list[str] = []  # codes from SERVICE_CATEGORIES
    verifyid_plan: str = "starter"     # starter | professional | enterprise

    # Call center model
    call_center_option: str = "own_self_managed"  # thronos_callcenter | own_with_support | own_self_managed

    # Business infrastructure (legacy fields kept)
    package_code: str = "starter"
    needs_web2_domain: bool = True
    needs_web3_domain: bool = False
    web3_tld: str | None = None
    needs_hosting: bool = True
    hosting_tier: Literal["starter", "business", "enterprise"] = "starter"
    logo_url: HttpUrl | None = None
    notes: str | None = None


# ── Static catalogs ────────────────────────────────────────────────────────

SERVICE_CATEGORIES: list[ServiceCategory] = [
    ServiceCategory(
        code="document_verification",
        name="Document Verification",
        description="Passport, Driver's License, National ID, Residence Permit — AI-powered scan & fraud detection",
        icon="FileCheck",
    ),
    ServiceCategory(
        code="age_verification",
        name="Age Verification",
        description="Quick DOB-based age check for regulatory compliance",
        icon="Calendar",
    ),
    ServiceCategory(
        code="kyc_forms",
        name="KYC Compliance Forms",
        description="Full Know Your Customer data collection — personal info, occupation, source of funds",
        icon="ClipboardList",
    ),
    ServiceCategory(
        code="video_verification",
        name="Video Identification",
        description="Live video call with a verified agent for high-assurance identity confirmation",
        icon="Video",
    ),
    ServiceCategory(
        code="digital_signature",
        name="Digital Signature",
        description="Legally binding electronic signatures for contracts and documents",
        icon="PenTool",
    ),
    ServiceCategory(
        code="driver_program",
        name="Driver Program Verification",
        description="Taxi school & drone operator license verification with blockchain anchoring",
        icon="Car",
    ),
    ServiceCategory(
        code="fraud_analysis",
        name="Fraud Analysis & Detection",
        description="Deep-scan fraud scoring: document quality, biometric, liveness, deepfake detection",
        icon="ShieldAlert",
    ),
]

CALL_CENTER_OPTIONS: list[CallCenterOption] = [
    CallCenterOption(
        code="thronos_callcenter",
        name="Thronos Support Call Center",
        description="Χρησιμοποιείτε το δικό μας managed call center με εκπαιδευμένους agents. Δεν χρειάζεστε δικό σας προσωπικό.",
        note="Απαιτείται συνεννόηση & SLA agreement με την Thronos",
    ),
    CallCenterOption(
        code="own_with_support",
        name="Δικό σας Call Center + Thronos IT Support",
        description="Έχετε δικό σας προσωπικό agents. Η Thronos παρέχει τεχνική υποστήριξη, εκπαίδευση & platform management.",
        note="IT support contract — τιμολογείται ξεχωριστά",
    ),
    CallCenterOption(
        code="own_self_managed",
        name="Δικό σας Call Center — Αυτόνομο",
        description="Πλήρης αυτονομία. Εσείς διαχειρίζεστε το προσωπικό, η Thronos παρέχει μόνο την πλατφόρμα.",
        note="Περιλαμβάνεται στο subscription χωρίς επιπλέον κόστος",
    ),
]

VERIFYID_PLANS: list[VerifyIDPlan] = [
    VerifyIDPlan(
        code="starter",
        name="Starter",
        monthly_price_eur=49,
        verifications_per_month="100",
        agents="1",
        features=[
            "100 verifications / μήνα",
            "1 call agent",
            "Basic widget embed",
            "Email support",
            "Standard fraud scoring",
        ],
    ),
    VerifyIDPlan(
        code="professional",
        name="Professional",
        monthly_price_eur=199,
        verifications_per_month="1.000",
        agents="5",
        features=[
            "1.000 verifications / μήνα",
            "5 call agents",
            "Branded widget + custom logo",
            "Priority support",
            "Advanced fraud & deepfake scoring",
        ],
        highlight=True,
    ),
    VerifyIDPlan(
        code="enterprise",
        name="Enterprise",
        monthly_price_eur=499,
        verifications_per_month="Unlimited",
        agents="Unlimited",
        features=[
            "Unlimited verifications",
            "Unlimited agents",
            "White-label widget",
            "Dedicated support + SLA",
            "Blockchain anchoring included",
            "Custom API integrations",
        ],
    ),
]

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


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/packages", response_model=list[ServicePackage])
async def list_service_packages():
    return SERVICE_PACKAGES


@router.get("/categories", response_model=list[ServiceCategory])
async def list_service_categories():
    return SERVICE_CATEGORIES


@router.get("/call-center-options", response_model=list[CallCenterOption])
async def list_call_center_options():
    return CALL_CENTER_OPTIONS


@router.get("/verifyid-plans", response_model=list[VerifyIDPlan])
async def list_verifyid_plans():
    return VERIFYID_PLANS


@router.post("/leads")
async def create_service_lead(payload: ServiceLeadRequest):
    logger.info(
        "[services] new lead company=%s email=%s plan=%s callcenter=%s services=%s staff=%s managers=%d",
        payload.company_name,
        payload.email,
        payload.verifyid_plan,
        payload.call_center_option,
        payload.selected_services,
        payload.staff_count,
        len(payload.manager_emails),
    )

    if EmailService.is_configured():
        sales_inbox = getattr(settings, "sales_inbox_email", "sales@thronoschain.org")

        managers_html = (
            "<ul>" + "".join(f"<li>{m}</li>" for m in payload.manager_emails) + "</ul>"
            if payload.manager_emails else "<p>—</p>"
        )
        services_html = (
            "<ul>" + "".join(f"<li>{s}</li>" for s in payload.selected_services) + "</ul>"
            if payload.selected_services else "<p>—</p>"
        )

        html_body = (
            "<h2>New VerifyID / Services Lead</h2>"
            f"<p><strong>Company:</strong> {payload.company_name} ({payload.org_type})</p>"
            f"<p><strong>Contact (General Director):</strong> {payload.contact_name} — {payload.email}</p>"
            f"<p><strong>Phone:</strong> {payload.phone}</p>"
            f"<p><strong>Staff count:</strong> {payload.staff_count}</p>"
            f"<p><strong>Manager emails:</strong></p>{managers_html}"
            f"<hr/>"
            f"<p><strong>VerifyID Plan:</strong> {payload.verifyid_plan}</p>"
            f"<p><strong>Selected services:</strong></p>{services_html}"
            f"<p><strong>Call Center option:</strong> {payload.call_center_option}</p>"
            f"<hr/>"
            f"<p><strong>Business package:</strong> {payload.package_code}</p>"
            f"<p><strong>Web2 Domain:</strong> {payload.needs_web2_domain}</p>"
            f"<p><strong>Web3 Domain:</strong> {payload.needs_web3_domain} ({payload.web3_tld or '—'})</p>"
            f"<p><strong>Hosting:</strong> {payload.needs_hosting} ({payload.hosting_tier})</p>"
            f"<p><strong>Logo URL:</strong> {payload.logo_url or '—'}</p>"
            f"<p><strong>Notes:</strong> {payload.notes or '—'}</p>"
        )
        try:
            EmailService.send_email(
                to_email=sales_inbox,
                subject=f"New Thronos Lead — {payload.company_name} [{payload.verifyid_plan}]",
                html_body=html_body,
                text_body=f"New lead from {payload.company_name} ({payload.email}), plan={payload.verifyid_plan}",
            )
        except Exception as exc:
            logger.warning("Failed to send lead email notification: %s", exc)

    return {
        "status": "received",
        "message": "Your request has been received. Our team will contact you shortly.",
    }
