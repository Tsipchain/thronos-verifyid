"""Billing models for multi-rail payment processing.

Four tables:
  payment_events          — immutable ledger of every payment attempt across all rails
  subscriptions           — current plan + status per org/user
  btc_deposits            — per-intent BTC address tracking
  fee_gateway_transactions — fiat-to-THRONOS conversion tracking
"""

from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Float, Integer, JSON, String
from sqlalchemy.orm import relationship

from .base import Base


class PaymentEvent(Base):
    __tablename__ = "payment_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(String, nullable=False, index=True)  # user_id or org_id

    # Rail
    source = Column(String, nullable=False)   # stripe | btc
    status = Column(String, nullable=False)   # fiat_received | btc_settled | failed | refunded

    # Amounts
    currency = Column(String, nullable=False)  # EUR | USD | BTC
    amount = Column(Float, nullable=False)     # in currency units (e.g. 49.00 EUR or 0.00145 BTC)

    # Rail-specific references
    stripe_id = Column(String, nullable=True, index=True)    # Stripe session / payment-intent id
    btc_txid = Column(String, nullable=True, index=True)     # Bitcoin transaction id
    sats = Column(BigInteger, nullable=True)                 # satoshis received
    fx_rate = Column(Float, nullable=True)                   # EUR/BTC rate at settlement time

    # Fee split recorded at settlement
    fees_json = Column(JSON, nullable=True)
    # e.g. {"platform_pct": 10, "platform_eur": 4.90, "pool_eur": 44.10, "pool_wallet": "thr1…"}

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Subscription(Base):
    __tablename__ = "subscriptions"

    org_id = Column(String, primary_key=True, nullable=False)
    plan = Column(String, nullable=False)         # starter | basic | pro | enterprise
    plan_status = Column(String, nullable=False)  # trialing | active | past_due | canceled | pending_settlement

    current_period_end = Column(DateTime, nullable=True)
    last_payment_event_id = Column(Integer, nullable=True)

    # Billing contact (name + email only — VAT/AFM comes later)
    billing_name = Column(String, nullable=True)
    billing_email = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class BtcDeposit(Base):
    """One row per BTC payment intent — links address → txid → settlement."""
    __tablename__ = "btc_deposits"

    intent_id = Column(String, primary_key=True, nullable=False)  # UUID generated at checkout
    org_id = Column(String, nullable=False, index=True)
    plan = Column(String, nullable=False)
    sats_expected = Column(BigInteger, nullable=False)  # how many sats to expect

    btc_address = Column(String, nullable=False, unique=True)  # unique per intent
    txid = Column(String, nullable=True)
    sats = Column(BigInteger, nullable=True)       # actual sats received
    confirmations = Column(Integer, default=0)
    status = Column(String, nullable=False, default="pending")
    # pending | received | confirmed | settled | expired

    payment_event_id = Column(Integer, nullable=True)  # FK to payment_events once settled

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class FeeGatewayTransaction(Base):
    """Tracks automatic fiat-to-THRONOS conversion from fee pool.
    
    When users pay with fiat (Stripe), 90% of fees accumulate in a buffer.
    When buffer > threshold, we automatically:
    1. Buy THRONOS tokens from market
    2. Send to pool wallet
    3. Record on Thronos Chain
    """
    __tablename__ = "fee_gateway_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Amounts
    eur_amount = Column(Float, nullable=False)              # EUR to convert
    thronos_amount = Column(Float, nullable=False)          # THRONOS purchased
    thronos_price_eur = Column(Float, nullable=False)       # EUR per THRONOS at conversion time
    
    # Destination
    pool_wallet = Column(String, nullable=False)            # Thronos pool wallet address
    
    # Status tracking
    status = Column(String, nullable=False, default="pending")  # pending | processing | completed | failed
    triggered_by = Column(String, nullable=False)           # auto | manual | admin:user_id
    blockchain_tx_hash = Column(String, nullable=True)      # Thronos Chain TX hash
    error_message = Column(String, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
