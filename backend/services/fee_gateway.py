"""Fee Gateway — Automatic fiat-to-THRONOS conversion service.

When users pay with fiat (Stripe), 90% of fees go to the Thronos Pool.
This service automates:
1. Accumulating EUR fees in a buffer account
2. Triggering automated buy orders for THRONOS tokens
3. Distributing THRONOS to the pool wallet
4. Recording all transactions on-chain

Flow:
  Stripe payment received (EUR)
    → Platform fee (10%) retained
    → Pool portion (90%) → Fee Buffer
    → When buffer > threshold → Execute buy order
    → Send THRONOS to pool wallet
    → Record on Thronos Chain
"""

import logging
import os
from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from models.billing import FeeGatewayTransaction
from services.thronos_blockchain import thronos_service

logger = logging.getLogger(__name__)

# Configuration
FEE_BUFFER_THRESHOLD_EUR = float(os.getenv("FEE_BUFFER_THRESHOLD_EUR", "1000"))  # Min EUR to trigger buy
THRONOS_POOL_WALLET = os.getenv("THRONOS_POOL_WALLET", "")  # Destination wallet for THRONOS
THRONOS_PRICE_EUR = float(os.getenv("THRONOS_PRICE_EUR", "0.10"))  # Price per THRONOS token


class FeeGatewayResult(BaseModel):
    success: bool
    eur_converted: float
    thronos_purchased: float
    tx_hash: Optional[str] = None
    error: Optional[str] = None


class FeeGatewayService:
    """Service for automated fiat-to-THRONOS conversion."""

    @staticmethod
    async def get_buffer_balance(db: AsyncSession) -> float:
        """
        Calculate current EUR buffer balance.
        
        Returns:
            Total unconverted EUR in the fee buffer.
        """
        result = await db.execute(
            select(FeeGatewayTransaction)
            .where(FeeGatewayTransaction.status == "pending")
        )
        transactions = result.scalars().all()
        return sum(tx.eur_amount for tx in transactions)

    @staticmethod
    async def execute_conversion(
        db: AsyncSession,
        eur_amount: float,
        triggered_by: str = "auto",
    ) -> FeeGatewayResult:
        """
        Execute fiat-to-THRONOS conversion.
        
        Args:
            db: Database session
            eur_amount: Amount of EUR to convert
            triggered_by: "auto" | "manual" | "admin:user_id"
            
        Returns:
            FeeGatewayResult with transaction details
        """
        if not THRONOS_POOL_WALLET:
            logger.error("THRONOS_POOL_WALLET not configured")
            return FeeGatewayResult(
                success=False,
                eur_converted=0,
                thronos_purchased=0,
                error="Pool wallet not configured",
            )

        # Calculate THRONOS amount
        thronos_amount = eur_amount / THRONOS_PRICE_EUR

        # Create transaction record
        tx = FeeGatewayTransaction(
            eur_amount=eur_amount,
            thronos_amount=thronos_amount,
            thronos_price_eur=THRONOS_PRICE_EUR,
            pool_wallet=THRONOS_POOL_WALLET,
            status="processing",
            triggered_by=triggered_by,
        )
        db.add(tx)
        await db.flush()

        try:
            # Execute buy order (placeholder - integrate with your DEX/CEX)
            # In production, this would call:
            # - Uniswap/PancakeSwap for DEX swap
            # - Or internal treasury management system
            # For now, we simulate the purchase
            
            logger.info(
                f"Fee Gateway: Purchasing {thronos_amount:.2f} THRONOS "
                f"with {eur_amount:.2f} EUR at {THRONOS_PRICE_EUR} EUR/THRONOS"
            )

            # Send THRONOS to pool wallet via blockchain
            result = thronos_service.transfer_tokens(
                to_address=THRONOS_POOL_WALLET,
                amount=thronos_amount,
                memo=f"Fee gateway conversion: {eur_amount:.2f} EUR",
            )

            if result["success"]:
                tx.status = "completed"
                tx.blockchain_tx_hash = result["tx_hash"]
                tx.completed_at = datetime.now()
                await db.commit()

                logger.info(
                    f"Fee Gateway: Conversion complete. "
                    f"TX: {result['tx_hash']}"
                )

                return FeeGatewayResult(
                    success=True,
                    eur_converted=eur_amount,
                    thronos_purchased=thronos_amount,
                    tx_hash=result["tx_hash"],
                )
            else:
                tx.status = "failed"
                tx.error_message = result.get("error", "Unknown error")
                await db.commit()

                return FeeGatewayResult(
                    success=False,
                    eur_converted=0,
                    thronos_purchased=0,
                    error=result.get("error", "Blockchain transfer failed"),
                )

        except Exception as e:
            logger.error(f"Fee Gateway conversion failed: {e}")
            tx.status = "failed"
            tx.error_message = str(e)
            await db.commit()

            return FeeGatewayResult(
                success=False,
                eur_converted=0,
                thronos_purchased=0,
                error=str(e),
            )

    @staticmethod
    async def check_and_trigger_conversion(db: AsyncSession) -> Optional[FeeGatewayResult]:
        """
        Check if buffer exceeds threshold and trigger conversion.
        
        This should be called:
        - After each Stripe webhook (opportunistic)
        - Via scheduled cron job (every 24h)
        
        Returns:
            FeeGatewayResult if conversion was triggered, None otherwise
        """
        buffer_balance = await FeeGatewayService.get_buffer_balance(db)

        if buffer_balance >= FEE_BUFFER_THRESHOLD_EUR:
            logger.info(
                f"Fee Gateway: Buffer threshold reached "
                f"({buffer_balance:.2f} EUR >= {FEE_BUFFER_THRESHOLD_EUR} EUR). "
                "Triggering conversion."
            )
            return await FeeGatewayService.execute_conversion(
                db=db,
                eur_amount=buffer_balance,
                triggered_by="auto",
            )
        else:
            logger.debug(
                f"Fee Gateway: Buffer below threshold "
                f"({buffer_balance:.2f} EUR < {FEE_BUFFER_THRESHOLD_EUR} EUR). "
                "No action taken."
            )
            return None
