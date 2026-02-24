"""
Organizations router — SaaS tenant management (admin-only).

Endpoints:
  GET    /api/v1/organizations              list all orgs (with plan + usage)
  POST   /api/v1/organizations              create new org + issue first API key
  GET    /api/v1/organizations/{id}         org detail + stats
  PUT    /api/v1/organizations/{id}         update org info / plan
  POST   /api/v1/organizations/{id}/suspend  suspend org
  POST   /api/v1/organizations/{id}/activate reactivate org
  POST   /api/v1/organizations/{id}/api-key/rotate  generate new widget API key
  GET    /api/v1/organizations/{id}/widget-snippet  return embed code snippet

Widget endpoint (public, X-Widget-API-Key header auth):
  GET    /api/v1/widget/config              return widget config for org
"""

import json
import uuid
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user, require_admin
from dependencies.database import get_db
from models.organizations import (
    PLAN_LIMITS,
    Organization,
    OrgStatus,
    OrgType,
    ServicePlan,
    TenantAPIKey,
)
from models.verifications import DriverProgramVerifications
from schemas.auth import UserResponse

logger = logging.getLogger(__name__)

router     = APIRouter(prefix="/api/v1/organizations", tags=["organizations"])
wgt_router = APIRouter(prefix="/api/v1/widget",        tags=["widget"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str
    org_type: str = "other"
    contact_name: Optional[str] = None
    contact_email: str
    contact_phone: Optional[str] = None
    country: Optional[str] = None
    plan: str = "starter"
    admin_notes: Optional[str] = None
    widget_allowed_origins: Optional[List[str]] = None


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    org_type: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    country: Optional[str] = None
    plan: Optional[str] = None
    plan_status: Optional[str] = None
    admin_notes: Optional[str] = None
    widget_allowed_origins: Optional[List[str]] = None
    custom_branding: Optional[Dict[str, Any]] = None
    plan_expires_at: Optional[datetime] = None


class OrgOut(BaseModel):
    id: str
    name: str
    org_type: str
    status: str
    country: Optional[str]
    contact_name: Optional[str]
    contact_email: str
    contact_phone: Optional[str]
    plan: str
    plan_status: str
    plan_limits: Dict[str, Any]
    verifications_this_month: int
    verifications_total: int
    widget_api_key: str
    widget_allowed_origins: Optional[List[str]]
    custom_branding: Optional[Dict[str, Any]]
    admin_notes: Optional[str]
    created_at: str
    updated_at: str
    suspended_at: Optional[str]
    plan_expires_at: Optional[str]

    class Config:
        from_attributes = True


def _to_out(org: Organization) -> OrgOut:
    plan_key = ServicePlan(org.plan) if org.plan in ServicePlan._value2member_map_ else ServicePlan.STARTER
    origins_raw = org.widget_allowed_origins
    origins = json.loads(origins_raw) if origins_raw else None
    branding_raw = org.custom_branding
    branding = json.loads(branding_raw) if branding_raw else None
    return OrgOut(
        id=org.id,
        name=org.name,
        org_type=org.org_type.value if org.org_type else "other",
        status=org.status.value if org.status else "pending",
        country=org.country,
        contact_name=org.contact_name,
        contact_email=org.contact_email,
        contact_phone=org.contact_phone,
        plan=org.plan.value if org.plan else "starter",
        plan_status=org.plan_status,
        plan_limits=PLAN_LIMITS[plan_key],
        verifications_this_month=org.verifications_this_month,
        verifications_total=org.verifications_total,
        widget_api_key=org.widget_api_key,
        widget_allowed_origins=origins,
        custom_branding=branding,
        admin_notes=org.admin_notes,
        created_at=org.created_at.isoformat(),
        updated_at=org.updated_at.isoformat(),
        suspended_at=org.suspended_at.isoformat() if org.suspended_at else None,
        plan_expires_at=org.plan_expires_at.isoformat() if org.plan_expires_at else None,
    )


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("", response_model=List[OrgOut])
async def list_organizations(
    status: Optional[str] = None,
    plan: Optional[str] = None,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all subscriber organisations (admin only)."""
    stmt = select(Organization).order_by(Organization.created_at.desc())
    if status:
        try:
            stmt = stmt.where(Organization.status == OrgStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    if plan:
        try:
            stmt = stmt.where(Organization.plan == ServicePlan(plan))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid plan: {plan}")
    result = await db.execute(stmt)
    return [_to_out(o) for o in result.scalars().all()]


@router.post("", response_model=OrgOut, status_code=201)
async def create_organization(
    body: OrgCreate,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new subscriber organisation and issue its first widget API key."""
    try:
        org_type = OrgType(body.org_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid org_type: {body.org_type}")
    try:
        plan = ServicePlan(body.plan)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {body.plan}")

    api_key = "wk_" + uuid.uuid4().hex
    org = Organization(
        name=body.name,
        org_type=org_type,
        status=OrgStatus.TRIAL,
        contact_name=body.contact_name,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
        country=body.country,
        plan=plan,
        plan_status="trialing",
        widget_api_key=api_key,
        widget_allowed_origins=(
            json.dumps(body.widget_allowed_origins)
            if body.widget_allowed_origins
            else None
        ),
        admin_notes=body.admin_notes,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(org)
    await db.flush()  # get org.id

    # Record the key in audit log
    db.add(TenantAPIKey(
        org_id=org.id,
        key_value=api_key,
        is_active=True,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    ))
    await db.commit()
    await db.refresh(org)

    logger.info("Admin %s created org %s (%s)", current_user.id, org.id, org.name)
    return _to_out(org)


@router.get("/{org_id}", response_model=OrgOut)
async def get_organization(
    org_id: str,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return _to_out(org)


@router.put("/{org_id}", response_model=OrgOut)
async def update_organization(
    org_id: str,
    body: OrgUpdate,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")

    if body.name is not None:
        org.name = body.name
    if body.org_type is not None:
        try:
            org.org_type = OrgType(body.org_type)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid org_type: {body.org_type}")
    if body.contact_name is not None:
        org.contact_name = body.contact_name
    if body.contact_email is not None:
        org.contact_email = body.contact_email
    if body.contact_phone is not None:
        org.contact_phone = body.contact_phone
    if body.country is not None:
        org.country = body.country
    if body.plan is not None:
        try:
            org.plan = ServicePlan(body.plan)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid plan: {body.plan}")
    if body.plan_status is not None:
        org.plan_status = body.plan_status
    if body.admin_notes is not None:
        org.admin_notes = body.admin_notes
    if body.widget_allowed_origins is not None:
        org.widget_allowed_origins = json.dumps(body.widget_allowed_origins)
    if body.custom_branding is not None:
        org.custom_branding = json.dumps(body.custom_branding)
    if body.plan_expires_at is not None:
        org.plan_expires_at = body.plan_expires_at

    org.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(org)
    return _to_out(org)


@router.post("/{org_id}/suspend", response_model=OrgOut)
async def suspend_organization(
    org_id: str,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if org.status == OrgStatus.SUSPENDED:
        raise HTTPException(status_code=400, detail="Already suspended")

    org.status = OrgStatus.SUSPENDED
    org.plan_status = "canceled"
    org.suspended_at = datetime.utcnow()
    org.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(org)
    logger.info("Admin %s suspended org %s", current_user.id, org_id)
    return _to_out(org)


@router.post("/{org_id}/activate", response_model=OrgOut)
async def activate_organization(
    org_id: str,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")

    org.status = OrgStatus.ACTIVE
    org.plan_status = "active"
    org.suspended_at = None
    org.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(org)
    logger.info("Admin %s activated org %s", current_user.id, org_id)
    return _to_out(org)


@router.post("/{org_id}/api-key/rotate")
async def rotate_api_key(
    org_id: str,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Revoke current widget API key and issue a new one."""
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")

    # Revoke old keys in audit log
    old_stmt = select(TenantAPIKey).where(
        TenantAPIKey.org_id == org_id,
        TenantAPIKey.is_active == True,
    )
    old_result = await db.execute(old_stmt)
    for old_key in old_result.scalars().all():
        old_key.is_active = False
        old_key.revoked_at = datetime.utcnow()

    new_key = "wk_" + uuid.uuid4().hex
    org.widget_api_key = new_key
    org.updated_at = datetime.utcnow()

    db.add(TenantAPIKey(
        org_id=org.id,
        key_value=new_key,
        is_active=True,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    ))
    await db.commit()
    await db.refresh(org)
    logger.info("Admin %s rotated API key for org %s", current_user.id, org_id)
    return {"org_id": org_id, "new_api_key": new_key}


@router.get("/{org_id}/widget-snippet")
async def get_widget_snippet(
    org_id: str,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return the JavaScript embed snippet for the organisation's widget."""
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")

    snippet = (
        f'<!-- DriverIntelligent Verification Widget -->\n'
        f'<div id="driverintelligent-widget"></div>\n'
        f'<script\n'
        f'  src="https://verifyid.thronoschain.org/widget.js"\n'
        f'  data-api-key="{org.widget_api_key}"\n'
        f'  data-org="{org.id}"\n'
        f'  data-theme="light"\n'
        f'  async\n'
        f'></script>'
    )
    return {
        "org_id": org_id,
        "api_key": org.widget_api_key,
        "snippet": snippet,
        "iframe_url": f"https://verifyid.thronoschain.org/driver/verify?org={org.id}&key={org.widget_api_key}",
    }


# ── Widget public endpoint ────────────────────────────────────────────────────

@wgt_router.get("/config")
async def widget_config(
    x_widget_api_key: Optional[str] = Header(default=None, alias="X-Widget-API-Key"),
    db: AsyncSession = Depends(get_db),
):
    """
    Called by the embedded widget JS on load to fetch org branding & config.
    Authenticated by the X-Widget-API-Key header (no user JWT needed).
    """
    if not x_widget_api_key:
        raise HTTPException(status_code=401, detail="X-Widget-API-Key header required")

    stmt = select(Organization).where(Organization.widget_api_key == x_widget_api_key)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=401, detail="Invalid widget API key")
    if org.status == OrgStatus.SUSPENDED:
        raise HTTPException(status_code=403, detail="Organisation subscription is suspended")

    branding = json.loads(org.custom_branding) if org.custom_branding else {}
    plan_key = ServicePlan(org.plan) if org.plan in ServicePlan._value2member_map_ else ServicePlan.STARTER
    limits = PLAN_LIMITS[plan_key]
    usage_pct = (
        (org.verifications_this_month / limits["verifications"] * 100)
        if limits["verifications"] > 0
        else 0
    )

    return {
        "org_id": org.id,
        "org_name": org.name,
        "org_type": org.org_type.value if org.org_type else "other",
        "plan": plan_key.value,
        "branding": branding,
        "programs_enabled": _programs_for_org_type(org.org_type.value if org.org_type else "other"),
        "usage": {
            "this_month": org.verifications_this_month,
            "limit": limits["verifications"],
            "pct": round(usage_pct, 1),
        },
        "status": org.status.value if org.status else "active",
    }


def _programs_for_org_type(org_type: str) -> List[str]:
    mapping = {
        "taxi_school":    ["taxi_school"],
        "drone_operator": ["drone_program"],
        "fleet":          ["taxi_school", "drone_program"],
        "call_center":    ["taxi_school", "drone_program"],
        "other":          ["taxi_school", "drone_program"],
    }
    return mapping.get(org_type, ["taxi_school", "drone_program"])


# ── Export both routers so main.py auto-discovers them ───────────────────────
# main.py iterates attr names ("router", "admin_router") and also handles lists.
admin_router = wgt_router
