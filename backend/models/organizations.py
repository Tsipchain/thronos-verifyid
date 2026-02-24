"""
SaaS tenant models for DriverIntelligent white-label resale.

An Organization is any external entity (taxi school, drone operator, fleet
company, call center) that purchases access to the DriverIntelligent
verification platform.  They bring their own staff and call-centre and embed
the verification widget on their own systems.

Tables:
  organizations       — the tenant entity
  tenant_api_keys     — widget/API keys issued to each tenant
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum as SQLEnum, Integer, String, Text
from sqlalchemy.sql import func

from .base import Base


class OrgType(str, enum.Enum):
    TAXI_SCHOOL    = "taxi_school"
    DRONE_OPERATOR = "drone_operator"
    FLEET          = "fleet"
    CALL_CENTER    = "call_center"
    OTHER          = "other"


class OrgStatus(str, enum.Enum):
    TRIAL     = "trial"
    ACTIVE    = "active"
    SUSPENDED = "suspended"
    PENDING   = "pending"
    CANCELLED = "cancelled"


class ServicePlan(str, enum.Enum):
    STARTER      = "starter"       # €49/mo,  100 verif, 1 agent
    PROFESSIONAL = "professional"  # €199/mo, 1 000 verif, 5 agents
    ENTERPRISE   = "enterprise"    # €499/mo, unlimited, unlimited


PLAN_LIMITS = {
    ServicePlan.STARTER:      {"verifications": 100,   "agents": 1,  "price_eur": 49},
    ServicePlan.PROFESSIONAL: {"verifications": 1_000, "agents": 5,  "price_eur": 199},
    ServicePlan.ENTERPRISE:   {"verifications": -1,    "agents": -1, "price_eur": 499},
}


class Organization(Base):
    """
    SaaS tenant organisation.

    Each org:
      - has a unique widget_api_key used by the embeddable widget
      - is linked to a ServicePlan that controls limits
      - can have multiple users (staff / call agents) inside the platform
    """
    __tablename__ = "organizations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Identity
    name          = Column(String(255), nullable=False)
    org_type      = Column(SQLEnum(OrgType), nullable=False, default=OrgType.OTHER)
    status        = Column(SQLEnum(OrgStatus), nullable=False, default=OrgStatus.TRIAL)
    country       = Column(String(2), nullable=True)   # ISO-2 country code

    # Contact
    contact_name  = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=False)
    contact_phone = Column(String(50), nullable=True)

    # Plan
    plan          = Column(SQLEnum(ServicePlan), nullable=False, default=ServicePlan.STARTER)
    plan_status   = Column(String(50), nullable=False, default="trialing")
    # plan_status: trialing | active | past_due | canceled

    # Usage counters (reset monthly by a background job / on billing cycle)
    verifications_this_month = Column(Integer, default=0, nullable=False)
    verifications_total      = Column(Integer, default=0, nullable=False)

    # Widget
    widget_api_key       = Column(String(64), nullable=False, unique=True,
                                  default=lambda: "wk_" + uuid.uuid4().hex)
    widget_allowed_origins = Column(Text, nullable=True)  # JSON array ["https://example.com"]
    custom_branding        = Column(Text, nullable=True)  # JSON {logo_url, primary_color, name}

    # Internal notes from Thronos admin
    admin_notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    suspended_at = Column(DateTime, nullable=True)
    plan_expires_at = Column(DateTime, nullable=True)


class TenantAPIKey(Base):
    """
    Audit log of widget API keys issued to an organisation.
    Only the most-recent active key is valid; older keys are revoked on rotation.
    """
    __tablename__ = "tenant_api_keys"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    org_id      = Column(String(36), nullable=False, index=True)
    key_value   = Column(String(64), nullable=False, unique=True)
    is_active   = Column(Boolean, default=True, nullable=False)
    created_by  = Column(String(255), nullable=True)   # admin user_id who issued it
    revoked_at  = Column(DateTime, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
