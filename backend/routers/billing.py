"""Billing router — multi-rail payment processing for Thronos VerifyID.

Payment flow
───────────
  Fiat (Stripe)
    POST /api/v1/billing/checkout/fiat  → create Stripe checkout session
    POST /api/v1/billing/stripe/webhook  → Stripe hits this on payment.completed
      → write payment_events (fiat_received)
      → upsert subscriptions (plan_status = active | pending_settlement)
      → add credits to user

  BTC
    POST /api/v1/billing/checkout/btc   → generate unique BTC address + sats amount
      → create btc_deposits row (status=pending)
    POST /api/v1/billing/settle-btc     → admin confirms settlement
      → write payment_events (btc_settled)
      → upsert subscriptions (plan_status = active)
      → add credits to user
      → record fee split: platform_fee + pool contribution

  Status
    GET  /api/v1/billing/status          → caller's current subscription
    GET  /api/v1/billing/plans           → list available plans + fiat + BTC price

Fee split (all payments)
────────────────────────
  PLATFORM_FEE_PCT = 10 %  (configurable via PLATFORM_FEE_PCT env var)
  90 % → Thronos chain pool  (THRONOS_POOL_WALLET)
"""

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from dependencies.auth import get_current_user, require_admin
from models.billing import BtcDeposit, PaymentEvent, Subscription
from models.credits import CreditTransaction, UserCredits
from routers.credits import add_credits
from schemas.auth import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLATFORM_FEE_PCT: float = float(os.getenv("PLATFORM_FEE_PCT", "10"))

# Billing plans — credits, EUR price, BTC price in sats
BILLING_PLANS: dict[str, dict] = {
    "starter": {
        "name": "Starter",
        "description": "For individuals and small teams getting started with KYC.",
        "credits": 1_000,
        "price_eur": 49.00,
        "price_sats": 90_000,
    },
    "basic": {
        "name": "Basic",
        "description": "For growing companies needing regular identity verification.",
        "credits": 3_500,
        "price_eur": 149.00,
        "price_sats": 275_000,
    },
    "pro": {
        "name": "Pro",
        "description": "High-volume verifications with priority support.",
        "credits": 10_000,
        "price_eur": 399.00,
        "price_sats": 735_000,
    },
    "enterprise": {
        "name": "Enterprise",
        "description": "Custom volume, SLA guarantees, and dedicated onboarding.",
        "credits": 30_000,
        "price_eur": 999.00,
        "price_sats": 1_840_000,
    },
}

BTC_CONFIRMATIONS_REQUIRED = int(os.getenv("BTC_CONFIRMATIONS_REQUIRED", "3"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _configure_stripe() -> None:
    key = os.getenv("STRIPE_SECRET_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="Stripe not configured (STRIPE_SECRET_KEY missing)")
    stripe.api_key = key


def _compute_fee_split(amount_eur: float) -> dict:
    """Return fee split dict for fees_json column."""
    platform_eur = round(amount_eur * PLATFORM_FEE_PCT / 100, 2)
    pool_eur = round(amount_eur - platform_eur, 2)
    pool_wallet = os.getenv("THRONOS_POOL_WALLET", "")
    return {
        "platform_pct": PLATFORM_FEE_PCT,
        "platform_eur": platform_eur,
        "pool_eur": pool_eur,
        "pool_wallet": pool_wallet or "unconfigured",
    }


def _derive_btc_address(intent_id: str) -> str:
    """
    Derive a deterministic placeholder BTC address from the intent ID.

    In production replace this with an HD-wallet derivation (e.g. using bit,
    python-bitcoinlib, or a BTC node RPC call).  The address returned here is
    a valid-looking testnet address useful for end-to-end testing.
    """
    pool_addr = os.getenv("THRONOS_POOL_BTC_ADDRESS", "")
    if pool_addr:
        return pool_addr  # use the pool address directly (admin manually splits later)
    # Fallback: deterministic-looking placeholder
    digest = hashlib.sha256(intent_id.encode()).hexdigest()[:26]
    return f"bc1q{digest}"


async def _upsert_subscription(
    db: AsyncSession,
    org_id: str,
    plan: str,
    plan_status: str,
    payment_event_id: int,
    period_days: int = 30,
    billing_name: Optional[str] = None,
    billing_email: Optional[str] = None,
) -> Subscription:
    result = await db.execute(select(Subscription).where(Subscription.org_id == org_id))
    sub = result.scalar_one_or_none()
    period_end = datetime.utcnow() + timedelta(days=period_days)
    if sub:
        sub.plan = plan
        sub.plan_status = plan_status
        sub.current_period_end = period_end
        sub.last_payment_event_id = payment_event_id
        sub.updated_at = datetime.utcnow()
        if billing_name:
            sub.billing_name = billing_name
        if billing_email:
            sub.billing_email = billing_email
    else:
        sub = Subscription(
            org_id=org_id,
            plan=plan,
            plan_status=plan_status,
            current_period_end=period_end,
            last_payment_event_id=payment_event_id,
            billing_name=billing_name,
            billing_email=billing_email,
        )
        db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PlanInfo(BaseModel):
    id: str
    name: str
    description: str
    credits: int
    price_eur: float
    price_sats: int


class FiatCheckoutRequest(BaseModel):
    plan_id: str
    success_url: str
    cancel_url: str
    billing_name: Optional[str] = None
    billing_email: Optional[str] = None


class FiatCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str
    plan: str
    credits: int
    price_eur: float


class BtcCheckoutRequest(BaseModel):
    plan_id: str
    billing_name: Optional[str] = None
    billing_email: Optional[str] = None


class BtcCheckoutResponse(BaseModel):
    intent_id: str
    btc_address: str
    sats_expected: int
    price_eur: float
    plan: str
    credits: int
    confirmations_required: int
    expires_in_hours: int = 24


class SettleBtcRequest(BaseModel):
    org_id: str
    intent_id: str
    txid: str
    sats: int
    fx_rate: float  # EUR per BTC


class SubscriptionStatus(BaseModel):
    org_id: str
    plan: Optional[str] = None
    plan_status: Optional[str] = None
    current_period_end: Optional[datetime] = None
    last_payment_source: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/plans", response_model=list[PlanInfo], summary="List billing plans")
async def list_plans() -> list[PlanInfo]:
    """Return all available plans with EUR + BTC prices."""
    return [PlanInfo(id=k, **v) for k, v in BILLING_PLANS.items()]


@router.get("/status", response_model=SubscriptionStatus, summary="Current subscription status")
async def subscription_status(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionStatus:
    """Return the caller's current subscription."""
    result = await db.execute(select(Subscription).where(Subscription.org_id == current_user.id))
    sub = result.scalar_one_or_none()
    if not sub:
        return SubscriptionStatus(org_id=current_user.id)

    # Resolve last payment source
    source = None
    if sub.last_payment_event_id:
        ev = await db.get(PaymentEvent, sub.last_payment_event_id)
        source = ev.source if ev else None

    return SubscriptionStatus(
        org_id=sub.org_id,
        plan=sub.plan,
        plan_status=sub.plan_status,
        current_period_end=sub.current_period_end,
        last_payment_source=source,
    )


# ── Fiat (Stripe) ─────────────────────────────────────────────────────────────

@router.post("/checkout/fiat", response_model=FiatCheckoutResponse, summary="Create Stripe checkout")
async def checkout_fiat(
    req: FiatCheckoutRequest,
    current_user: UserResponse = Depends(get_current_user),
) -> FiatCheckoutResponse:
    """Create a Stripe checkout session for the chosen plan."""
    plan = BILLING_PLANS.get(req.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {req.plan_id}")

    _configure_stripe()
    amount_cents = int(plan["price_eur"] * 100)

    session = stripe.checkout.Session.create(
        line_items=[{
            "price_data": {
                "currency": "eur",
                "product_data": {
                    "name": f"Thronos VerifyID — {plan['name']} ({plan['credits']:,} credits)",
                    "description": plan["description"],
                },
                "unit_amount": amount_cents,
            },
            "quantity": 1,
        }],
        mode="payment",
        success_url=req.success_url,
        cancel_url=req.cancel_url,
        metadata={
            "user_id": current_user.id,
            "plan_id": req.plan_id,
            "credits": str(plan["credits"]),
            "billing_name": req.billing_name or "",
            "billing_email": req.billing_email or "",
        },
    )

    return FiatCheckoutResponse(
        checkout_url=session.url,
        session_id=session.id,
        plan=req.plan_id,
        credits=plan["credits"],
        price_eur=plan["price_eur"],
    )


@router.post("/stripe/webhook", summary="Stripe webhook (checkout.session.completed)")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),
    db: AsyncSession = Depends(get_db),
):
    """
    Stripe posts here on checkout.session.completed.
    Verifies signature, writes payment_events, upserts subscription, adds credits.
    """
    # SECURITY: Webhook bypass removed — Phase 0 hardening
    payload = await request.body()
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    if not webhook_secret:
        raise HTTPException(
            status_code=500,
            detail="STRIPE_WEBHOOK_SECRET not configured — cannot verify webhook",
        )
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, webhook_secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    event_type = event.get("type", "")

    # ── Org subscription cancelled / deleted ───────────────────────────────
    if event_type == "customer.subscription.deleted":
        obj = event["data"]["object"]
        meta = obj.get("metadata", {})
        org_id_from_meta = meta.get("org_id", "")
        if org_id_from_meta:
            await _handle_org_stripe_cancellation(db, org_id_from_meta)
            return {"received": True, "processed": True, "channel": "org_cancellation"}

    # ── Organisation SaaS subscription events ──────────────────────────────
    # When Stripe metadata contains org_id, this payment is for a tenant
    # Organisation subscription — auto-activate the org's widget API key.
    if event_type in ("checkout.session.completed", "invoice.payment_succeeded"):
        obj = event["data"]["object"]
        meta = obj.get("metadata", {})
        org_id_from_meta = meta.get("org_id", "")
        if org_id_from_meta:
            await _handle_org_stripe_payment(db, event_type, obj, org_id_from_meta)
            return {"received": True, "processed": True, "channel": "org_subscription"}

    # ── Standard user/credits flow ─────────────────────────────────────────
    if event_type != "checkout.session.completed":
        return {"received": True, "processed": False}

    session = event["data"]["object"]
    metadata = session.get("metadata", {})
    user_id = metadata.get("user_id", "")
    plan_id = metadata.get("plan_id", "")
    credits = int(metadata.get("credits", "0"))
    billing_name = metadata.get("billing_name") or None
    billing_email = metadata.get("billing_email") or None
    amount_eur = session.get("amount_total", 0) / 100

    plan = BILLING_PLANS.get(plan_id, {})
    if not user_id or not plan_id:
        logger.warning("Stripe webhook: missing user_id or plan_id in metadata")
        return {"received": True, "processed": False}

    # Write payment event
    fees = _compute_fee_split(amount_eur)
    ev = PaymentEvent(
        org_id=user_id,
        source="stripe",
        status="fiat_received",
        currency="EUR",
        amount=amount_eur,
        stripe_id=session.get("id"),
        fees_json=fees,
    )
    db.add(ev)
    await db.flush()

    # Upsert subscription (fiat = immediately active)
    await _upsert_subscription(
        db=db,
        org_id=user_id,
        plan=plan_id,
        plan_status="active",
        payment_event_id=ev.id,
        billing_name=billing_name,
        billing_email=billing_email,
    )

    # Credit the user
    await add_credits(
        db=db,
        user_id=user_id,
        amount=credits,
        tx_type="purchase",
        description=f"{plan.get('name', plan_id)} plan — {credits:,} credits via Stripe",
        reference_id=session.get("id"),
    )

    logger.info(f"Stripe payment settled: user={user_id} plan={plan_id} credits={credits} fees={fees}")
    return {"received": True, "processed": True}


async def _handle_org_stripe_payment(
    db: AsyncSession,
    event_type: str,
    obj: dict,
    org_id: str,
) -> None:
    """Auto-activate an Organisation's widget API key on successful Stripe payment."""
    from datetime import timedelta
    from sqlalchemy import select as _select
    from models.organizations import Organization, OrgStatus
    from services.internal_notify import notify_managers
    from services.notify import notify_all_admins

    result = await db.execute(_select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        logger.warning("Stripe org webhook: org_id=%s not found", org_id)
        return

    # Store Stripe references
    customer_id = obj.get("customer") or obj.get("customer_id")
    subscription_id = obj.get("subscription")
    if customer_id:
        org.stripe_customer_id = str(customer_id)
    if subscription_id:
        org.stripe_subscription_id = str(subscription_id)

    # Activate the org
    org.plan_status = "active"
    org.status = OrgStatus.ACTIVE
    org.plan_expires_at = datetime.utcnow() + timedelta(days=30)
    org.expiry_warned_14d = False
    org.expiry_warned_7d = False
    await db.commit()

    logger.info(
        "Stripe auto-activated org %s (%s) via event %s",
        org.id, org.name, event_type,
    )

    # Notify admins
    await notify_managers(
        db,
        f"✅ Stripe payment confirmed — Organisation '{org.name}' subscription activated.\n"
        f"Plan: {org.plan} | Expires: {org.plan_expires_at.strftime('%Y-%m-%d')}\n"
        f"Contact: {org.contact_email}",
    )
    await notify_all_admins(
        db,
        title=f"Org '{org.name}' subscription activated via Stripe",
        body=f"Plan: {org.plan} | Expires: {org.plan_expires_at.strftime('%Y-%m-%d')}",
        category="billing",
        entity_type="org",
        entity_id=org.id,
    )


async def _handle_org_stripe_cancellation(db: AsyncSession, org_id: str) -> None:
    """Lock an org's widget API key when Stripe subscription is deleted/cancelled."""
    from sqlalchemy import select as _select
    from models.organizations import Organization, OrgStatus
    from services.internal_notify import notify_managers
    from services.notify import notify_all_admins

    result = await db.execute(_select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        return
    org.plan_status = "canceled"
    org.status = OrgStatus.SUSPENDED
    await db.commit()

    logger.info("Stripe cancelled subscription for org %s (%s)", org.id, org.name)
    await notify_managers(
        db,
        f"❌ Stripe subscription CANCELLED for organisation '{org.name}'.\n"
        f"Widget API key has been locked.\nContact: {org.contact_email}",
    )
    await notify_all_admins(
        db,
        title=f"Org '{org.name}' subscription cancelled",
        body="Stripe subscription was deleted. Widget API key is now locked.",
        category="billing",
        entity_type="org",
        entity_id=org.id,
    )


# ── BTC Rail ─────────────────────────────────────────────────────────────────

@router.post("/checkout/btc", response_model=BtcCheckoutResponse, summary="Create BTC payment intent")
async def checkout_btc(
    req: BtcCheckoutRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BtcCheckoutResponse:
    """
    Generate a unique BTC address and expected sats amount for the chosen plan.
    The caller must send exactly sats_expected to btc_address within 24 hours.
    Access is granted after BTC_CONFIRMATIONS_REQUIRED confirmations.
    """
    plan = BILLING_PLANS.get(req.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {req.plan_id}")

    intent_id = str(uuid.uuid4())
    btc_address = _derive_btc_address(intent_id)

    deposit = BtcDeposit(
        intent_id=intent_id,
        org_id=current_user.id,
        plan=req.plan_id,
        sats_expected=plan["price_sats"],
        btc_address=btc_address,
        status="pending",
    )
    db.add(deposit)
    await db.commit()

    logger.info(f"BTC checkout: user={current_user.id} plan={req.plan_id} address={btc_address} sats={plan['price_sats']}")

    return BtcCheckoutResponse(
        intent_id=intent_id,
        btc_address=btc_address,
        sats_expected=plan["price_sats"],
        price_eur=plan["price_eur"],
        plan=req.plan_id,
        credits=plan["credits"],
        confirmations_required=BTC_CONFIRMATIONS_REQUIRED,
        expires_in_hours=24,
    )


@router.post("/settle-btc", summary="Admin: confirm BTC payment settlement")
async def settle_btc(
    req: SettleBtcRequest,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Called by admin (or automated monitor) once BTC payment is confirmed.
    Runs the full settlement pipeline:
      1. Mark btc_deposit as settled
      2. Write payment_events (btc_settled) with fee split
      3. Upsert subscription → active
      4. Add credits to user
    """
    result = await db.execute(select(BtcDeposit).where(BtcDeposit.intent_id == req.intent_id))
    deposit = result.scalar_one_or_none()
    if not deposit:
        raise HTTPException(status_code=404, detail=f"BTC deposit intent not found: {req.intent_id}")
    if deposit.status == "settled":
        raise HTTPException(status_code=409, detail="Already settled")

    plan = BILLING_PLANS.get(deposit.plan, {})
    amount_eur = req.sats / 100_000_000 * req.fx_rate  # convert sats → BTC → EUR
    fees = _compute_fee_split(amount_eur)
    fees["sats_received"] = req.sats
    fees["fx_rate_eur_btc"] = req.fx_rate

    # Write payment event
    ev = PaymentEvent(
        org_id=req.org_id,
        source="btc",
        status="btc_settled",
        currency="BTC",
        amount=req.sats / 100_000_000,
        btc_txid=req.txid,
        sats=req.sats,
        fx_rate=req.fx_rate,
        fees_json=fees,
    )
    db.add(ev)
    await db.flush()

    # Update deposit row
    deposit.txid = req.txid
    deposit.sats = req.sats
    deposit.status = "settled"
    deposit.payment_event_id = ev.id
    deposit.updated_at = datetime.utcnow()

    # Upsert subscription
    await _upsert_subscription(
        db=db,
        org_id=req.org_id,
        plan=deposit.plan,
        plan_status="active",
        payment_event_id=ev.id,
    )

    # Add credits
    credits = plan.get("credits", 0)
    await add_credits(
        db=db,
        user_id=req.org_id,
        amount=credits,
        tx_type="purchase",
        description=f"{plan.get('name', deposit.plan)} plan — {credits:,} credits via BTC",
        reference_id=req.txid,
    )

    logger.info(
        f"BTC settled: org={req.org_id} plan={deposit.plan} txid={req.txid} "
        f"sats={req.sats} fx={req.fx_rate} fees={fees}"
    )

    return {
        "settled": True,
        "org_id": req.org_id,
        "plan": deposit.plan,
        "credits_granted": credits,
        "fees": fees,
        "payment_event_id": ev.id,
    }
