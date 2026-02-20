"""
Credits router — manage AI usage credits for Thronos VerifyID.
Credits are used to pay for AI assistant requests.
Packages can be purchased via Stripe.
"""

import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from core.database import get_db
from core.config import settings
from dependencies.auth import get_current_user, require_admin
from schemas.auth import UserResponse
from models.credits import UserCredits, CreditTransaction

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/credits", tags=["credits"])

# ---------------------------------------------------------------------------
# Credit packages available for purchase
# ---------------------------------------------------------------------------
CREDIT_PACKAGES = [
    {
        "id": "starter",
        "name": "Starter",
        "credits": 100,
        "price_eur": 1.00,
        "description": "100 AI requests — great for getting started",
    },
    {
        "id": "basic",
        "name": "Basic",
        "credits": 500,
        "price_eur": 4.00,
        "description": "500 AI requests — 20% savings",
    },
    {
        "id": "pro",
        "name": "Pro",
        "credits": 1500,
        "price_eur": 10.00,
        "description": "1,500 AI requests — 33% savings",
    },
    {
        "id": "enterprise",
        "name": "Enterprise",
        "credits": 5000,
        "price_eur": 30.00,
        "description": "5,000 AI requests — 40% savings",
    },
]

# Cost in credits per AI assistant request
AI_REQUEST_COST = 10


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def get_or_create_credits(db: AsyncSession, user_id: str) -> UserCredits:
    """Fetch the user's credit ledger, creating it with 50 bonus credits if new."""
    result = await db.execute(select(UserCredits).where(UserCredits.user_id == user_id))
    ledger = result.scalar_one_or_none()
    if not ledger:
        ledger = UserCredits(user_id=user_id, balance=50, total_purchased=0, total_used=0)
        db.add(ledger)
        bonus_tx = CreditTransaction(
            user_id=user_id,
            amount=50,
            type="bonus",
            description="Welcome bonus — 50 free credits",
        )
        db.add(bonus_tx)
        await db.commit()
        await db.refresh(ledger)
    return ledger


async def deduct_credits(db: AsyncSession, user_id: str, amount: int, description: str, reference_id: Optional[str] = None) -> int:
    """Deduct credits from the user's balance. Returns new balance. Raises 402 if insufficient."""
    ledger = await get_or_create_credits(db, user_id)
    if ledger.balance < amount:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. You have {ledger.balance} credits but this action costs {amount}.",
        )
    ledger.balance -= amount
    ledger.total_used += amount
    ledger.updated_at = datetime.now()
    tx = CreditTransaction(
        user_id=user_id,
        amount=-amount,
        type="ai_usage",
        description=description,
        reference_id=reference_id,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(ledger)
    return ledger.balance


async def add_credits(db: AsyncSession, user_id: str, amount: int, tx_type: str, description: str, reference_id: Optional[str] = None) -> int:
    """Add credits to the user's balance. Returns new balance."""
    ledger = await get_or_create_credits(db, user_id)
    ledger.balance += amount
    if tx_type == "purchase":
        ledger.total_purchased += amount
    ledger.updated_at = datetime.now()
    tx = CreditTransaction(
        user_id=user_id,
        amount=amount,
        type=tx_type,
        description=description,
        reference_id=reference_id,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(ledger)
    return ledger.balance


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CreditBalanceResponse(BaseModel):
    user_id: str
    balance: int
    total_purchased: int
    total_used: int
    ai_request_cost: int = AI_REQUEST_COST


class CreditTransactionResponse(BaseModel):
    id: int
    amount: int
    type: str
    description: Optional[str]
    reference_id: Optional[str]
    created_at: datetime


class CreditPackageResponse(BaseModel):
    id: str
    name: str
    credits: int
    price_eur: float
    description: str


class PurchaseRequest(BaseModel):
    package_id: str
    success_url: str
    cancel_url: str


class PurchaseResponse(BaseModel):
    checkout_url: str
    session_id: str
    credits: int
    price_eur: float


class BonusRequest(BaseModel):
    user_id: str
    amount: int
    description: str = "Admin bonus credits"


class WebhookCreditRequest(BaseModel):
    session_id: str
    user_id: str
    credits: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/balance", response_model=CreditBalanceResponse)
async def get_credit_balance(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's credit balance."""
    ledger = await get_or_create_credits(db, current_user.id)
    return CreditBalanceResponse(
        user_id=ledger.user_id,
        balance=ledger.balance,
        total_purchased=ledger.total_purchased,
        total_used=ledger.total_used,
    )


@router.get("/transactions", response_model=list[CreditTransactionResponse])
async def get_transactions(
    limit: int = 20,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's recent credit transactions."""
    result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == current_user.id)
        .order_by(desc(CreditTransaction.created_at))
        .limit(min(limit, 100))
    )
    txs = result.scalars().all()
    return [
        CreditTransactionResponse(
            id=tx.id,
            amount=tx.amount,
            type=tx.type,
            description=tx.description,
            reference_id=tx.reference_id,
            created_at=tx.created_at,
        )
        for tx in txs
    ]


@router.get("/packages", response_model=list[CreditPackageResponse])
async def list_packages():
    """List available credit packages."""
    return [CreditPackageResponse(**pkg) for pkg in CREDIT_PACKAGES]


@router.post("/purchase", response_model=PurchaseResponse)
async def purchase_credits(
    request: PurchaseRequest,
    current_user: UserResponse = Depends(get_current_user),
):
    """Create a Stripe checkout session to purchase credits."""
    pkg = next((p for p in CREDIT_PACKAGES if p["id"] == request.package_id), None)
    if not pkg:
        raise HTTPException(status_code=400, detail=f"Unknown package: {request.package_id}")

    stripe_key = getattr(settings, "stripe_secret_key", None)
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Payment service not configured (STRIPE_SECRET_KEY missing)")

    try:
        import stripe
        stripe.api_key = stripe_key

        amount_cents = int(pkg["price_eur"] * 100)
        session = await stripe.checkout.Session.create_async(
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": f"Thronos VerifyID — {pkg['name']} Credits ({pkg['credits']} credits)",
                    },
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=request.success_url.replace("{CHECKOUT_SESSION_ID}", "{CHECKOUT_SESSION_ID}"),
            cancel_url=request.cancel_url,
            metadata={
                "user_id": current_user.id,
                "package_id": pkg["id"],
                "credits": str(pkg["credits"]),
            },
        )
        return PurchaseResponse(
            checkout_url=session.url,
            session_id=session.id,
            credits=pkg["credits"],
            price_eur=pkg["price_eur"],
        )
    except Exception as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create checkout session: {str(e)}")


@router.post("/webhook/stripe")
async def stripe_webhook(
    request: WebhookCreditRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Internal webhook called after a successful Stripe payment to credit the user.
    In production, this should be secured with Stripe webhook signature verification.
    """
    new_balance = await add_credits(
        db=db,
        user_id=request.user_id,
        amount=request.credits,
        tx_type="purchase",
        description=f"Credit purchase — {request.credits} credits",
        reference_id=request.session_id,
    )
    return {"status": "ok", "new_balance": new_balance}


@router.post("/bonus")
async def grant_bonus_credits(
    request: BonusRequest,
    current_user: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: grant bonus credits to a user."""
    new_balance = await add_credits(
        db=db,
        user_id=request.user_id,
        amount=request.amount,
        tx_type="bonus",
        description=request.description,
        reference_id=f"admin:{current_user.id}",
    )
    return {"status": "ok", "user_id": request.user_id, "new_balance": new_balance}
