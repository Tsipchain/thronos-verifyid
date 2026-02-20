from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from .base import Base


class UserCredits(Base):
    __tablename__ = "user_credits"

    user_id = Column(String, primary_key=True, nullable=False)
    balance = Column(Integer, default=0, nullable=False)
    total_purchased = Column(Integer, default=0, nullable=False)
    total_used = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)

    transactions = relationship("CreditTransaction", back_populates="user_credits_ref", cascade="all, delete-orphan")


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    # Positive = credit added (purchase/bonus), negative = credit used
    amount = Column(Integer, nullable=False)
    type = Column(String, nullable=False)  # purchase | ai_usage | bonus
    description = Column(String, nullable=True)
    # stripe session id for purchases, request id for usage
    reference_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    user_credits_ref = relationship("UserCredits", back_populates="transactions", foreign_keys=[user_id],
                                     primaryjoin="CreditTransaction.user_id == UserCredits.user_id")
