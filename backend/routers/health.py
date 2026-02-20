"""Health and service status endpoint.

GET /api/v1/health  →  shows which VerifyID services are enabled/reachable.
This is the single source of truth for ops — no more grepping logs.
"""

import logging
import os

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from core.config import settings
from services.database import check_database_health

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/health", tags=["health"])


class ServiceStatus(BaseModel):
    enabled: bool
    status: str  # "ok" | "degraded" | "disabled" | "unconfigured"
    detail: str | None = None


class HealthResponse(BaseModel):
    service: str
    version: str
    environment: str
    overall: str  # "healthy" | "degraded" | "unhealthy"
    services: dict[str, ServiceStatus]


async def _ping_url(url: str, headers: dict | None = None, timeout: float = 4.0) -> tuple[bool, str]:
    """Return (reachable, detail) for a URL."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url, headers=headers or {})
            return r.status_code < 500, f"HTTP {r.status_code}"
    except Exception as exc:
        return False, str(exc)[:120]


@router.get("", response_model=HealthResponse, summary="Service health & config status")
async def health_check() -> HealthResponse:
    """
    Returns the live health of every VerifyID sub-service.

    Tells you instantly which services are configured, reachable, or missing
    env vars — no more log grepping.
    """
    statuses: dict[str, ServiceStatus] = {}

    # ── Database ──────────────────────────────────────────────────────────────
    db_ok = await check_database_health()
    statuses["database"] = ServiceStatus(
        enabled=True,
        status="ok" if db_ok else "unhealthy",
        detail="PostgreSQL reachable" if db_ok else "Connection failed",
    )

    # ── Thronos AI Core ───────────────────────────────────────────────────────
    ai_core_url = settings.thronos_ai_core_url
    ai_secret = settings.thronos_admin_secret
    if ai_core_url and ai_secret:
        ok, detail = await _ping_url(
            f"{ai_core_url.rstrip('/')}/health",
            headers={"X-Admin-Secret": ai_secret},
        )
        statuses["ai_core"] = ServiceStatus(
            enabled=True,
            status="ok" if ok else "degraded",
            detail=detail,
        )
    else:
        statuses["ai_core"] = ServiceStatus(
            enabled=False,
            status="unconfigured",
            detail="THRONOS_AI_CORE_URL or THRONOS_ADMIN_SECRET missing",
        )

    # ── AI Hub (OpenAI-compatible fallback) ───────────────────────────────────
    app_ai_key = os.getenv("APP_AI_KEY", "")
    app_ai_url = os.getenv("APP_AI_BASE_URL", "")
    statuses["ai_hub_fallback"] = ServiceStatus(
        enabled=bool(app_ai_key and app_ai_url),
        status="ok" if (app_ai_key and app_ai_url) else "unconfigured",
        detail=app_ai_url or "APP_AI_BASE_URL / APP_AI_KEY not set",
    )

    # ── Stripe (fiat payments) ────────────────────────────────────────────────
    stripe_key = os.getenv("STRIPE_SECRET_KEY", "")
    stripe_webhook = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if stripe_key:
        statuses["stripe"] = ServiceStatus(
            enabled=True,
            status="ok" if stripe_webhook else "degraded",
            detail="ready" if stripe_webhook else "STRIPE_WEBHOOK_SECRET missing — webhooks disabled",
        )
    else:
        statuses["stripe"] = ServiceStatus(
            enabled=False,
            status="unconfigured",
            detail="STRIPE_SECRET_KEY not set",
        )

    # ── BTC Payment Rail ──────────────────────────────────────────────────────
    btc_pool_addr = os.getenv("THRONOS_POOL_BTC_ADDRESS", "")
    statuses["btc_rail"] = ServiceStatus(
        enabled=bool(btc_pool_addr),
        status="ok" if btc_pool_addr else "unconfigured",
        detail=f"pool: {btc_pool_addr[:12]}…" if btc_pool_addr else "THRONOS_POOL_BTC_ADDRESS not set",
    )

    # ── Thronos Chain Pool Wallet ─────────────────────────────────────────────
    pool_wallet = os.getenv("THRONOS_POOL_WALLET", "")
    statuses["thronos_pool"] = ServiceStatus(
        enabled=bool(pool_wallet),
        status="ok" if pool_wallet else "unconfigured",
        detail=f"wallet: {pool_wallet[:16]}…" if pool_wallet else "THRONOS_POOL_WALLET not set",
    )

    # ── Email ─────────────────────────────────────────────────────────────────
    statuses["email"] = ServiceStatus(
        enabled=settings.email_enabled,
        status="ok" if settings.email_enabled else "disabled",
        detail=settings.email_provider if settings.email_enabled else "EMAIL_ENABLED=false",
    )

    # ── Thronos Blockchain Node ───────────────────────────────────────────────
    node_ok, node_detail = await _ping_url(settings.thronos_node1_url)
    statuses["thronos_node"] = ServiceStatus(
        enabled=True,
        status="ok" if node_ok else "degraded",
        detail=node_detail,
    )

    # ── Overall ───────────────────────────────────────────────────────────────
    if not db_ok:
        overall = "unhealthy"
    elif any(s.status == "unhealthy" for s in statuses.values()):
        overall = "unhealthy"
    elif any(s.status == "degraded" for s in statuses.values() if s.enabled):
        overall = "degraded"
    else:
        overall = "healthy"

    return HealthResponse(
        service="VerifyID",
        version=settings.version,
        environment=settings.environment,
        overall=overall,
        services=statuses,
    )
