import hashlib
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from core.auth import create_access_token
from core.config import settings
from core.database import db_manager
from models.auth import OIDCState, User
from models.rbac import Roles, UserRoles
from services.rbac import RBACService
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_user(self, platform_sub: str, email: str, name: Optional[str] = None) -> User:
        """Get existing user or create new one."""
        start_time = time.time()
        logger.debug(f"[DB_OP] Starting get_or_create_user - platform_sub: {platform_sub}")
        # Try to find existing user
        result = await self.db.execute(select(User).where(User.id == platform_sub))
        user = result.scalar_one_or_none()
        logger.debug(f"[DB_OP] User lookup completed in {time.time() - start_time:.4f}s - found: {user is not None}")

        if user:
            # Update user info if needed
            user.email = email
            user.name = name
            user.last_login = datetime.now(timezone.utc)
        else:
            # Create new user
            user = User(id=platform_sub, email=email, name=name, last_login=datetime.now(timezone.utc))
            self.db.add(user)

        start_time_commit = time.time()
        logger.debug("[DB_OP] Starting user commit/refresh")
        await self.db.commit()
        await self.db.refresh(user)
        logger.debug(f"[DB_OP] User commit/refresh completed in {time.time() - start_time_commit:.4f}s")
        return user

    async def issue_app_token(
        self,
        user: User,
    ) -> Tuple[str, datetime, Dict[str, Any]]:
        """Generate application JWT token for the authenticated user."""
        try:
            expires_minutes = int(getattr(settings, "jwt_expire_minutes", 60))
        except (TypeError, ValueError):
            logger.warning("Invalid JWT_EXPIRE_MINUTES value; fallback to 60 minutes")
            expires_minutes = 60
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)

        claims: Dict[str, Any] = {
            "sub": user.id,
            "email": user.email,
            "role": user.role,
        }

        if user.name:
            claims["name"] = user.name
        if user.last_login:
            claims["last_login"] = user.last_login.isoformat()
        token = create_access_token(claims, expires_minutes=expires_minutes)

        return token, expires_at, claims

    @staticmethod
    def _hash_password(password: str, salt: str) -> str:
        return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000).hex()

    @staticmethod
    def generate_password_hash(password: str) -> Tuple[str, str]:
        salt = secrets.token_hex(16)
        return salt, AuthService._hash_password(password, salt)

    @staticmethod
    def verify_password(password: str, salt: str, expected_hash: str) -> bool:
        return AuthService._hash_password(password, salt) == expected_hash

    async def get_user_by_email(self, email: str) -> Optional[User]:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def register_local_user(self, email: str, password: str, name: Optional[str] = None) -> User:
        existing = await self.get_user_by_email(email)
        if existing:
            raise ValueError("Email already registered")

        salt, password_hash = self.generate_password_hash(password)
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            name=name,
            role="client",
            password_salt=salt,
            password_hash=password_hash,
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def authenticate_local_user(self, email: str, password: str) -> Optional[User]:
        user = await self.get_user_by_email(email)
        if not user or not user.password_hash or not user.password_salt:
            return None
        if not user.is_active:
            return None
        if not self.verify_password(password, user.password_salt, user.password_hash):
            return None
        user.last_login = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def store_oidc_state(self, state: str, nonce: str, code_verifier: str):
        """Store OIDC state in database."""
        # Clean up expired states first
        await self.db.execute(delete(OIDCState).where(OIDCState.expires_at < datetime.now(timezone.utc)))

        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)  # 10 minute expiry

        oidc_state = OIDCState(state=state, nonce=nonce, code_verifier=code_verifier, expires_at=expires_at)

        self.db.add(oidc_state)
        await self.db.commit()

    async def get_and_delete_oidc_state(self, state: str) -> Optional[dict]:
        """Get and delete OIDC state from database."""
        # Clean up expired states first
        await self.db.execute(delete(OIDCState).where(OIDCState.expires_at < datetime.now(timezone.utc)))

        # Find and validate state
        result = await self.db.execute(select(OIDCState).where(OIDCState.state == state))
        oidc_state = result.scalar_one_or_none()

        if not oidc_state:
            return None

        # Extract data before deleting
        state_data = {"nonce": oidc_state.nonce, "code_verifier": oidc_state.code_verifier}

        # Delete the used state (one-time use)
        await self.db.delete(oidc_state)
        await self.db.commit()

        return state_data


async def initialize_admin_user():
    """Initialize admin user if not exists."""

    # Check if database is ready
    if not db_manager.async_session_maker:
        logger.warning("Database not initialized, skipping admin user initialization")
        return

    admin_user_email = getattr(settings, "admin_user_email", "") or ""
    admin_user_password = getattr(settings, "admin_user_password", "") or ""
    admin_user_id = getattr(settings, "admin_user_id", "") or admin_user_email

    if not admin_user_email or not admin_user_password:
        logger.warning("Admin user email/password not configured, skipping admin initialization")
        return

    async with db_manager.async_session_maker() as db:
        await RBACService.initialize_default_roles(db)

        result = await db.execute(select(User).where(User.id == admin_user_id))
        user = result.scalar_one_or_none()

        if user:
            user.role = "admin"
            user.email = admin_user_email
            user.is_active = True
            if not user.password_hash or not user.password_salt:
                salt, password_hash = AuthService.generate_password_hash(admin_user_password)
                user.password_salt = salt
                user.password_hash = password_hash
            await db.commit()
            await db.refresh(user)
            logger.info("✅ Updated admin user %s", admin_user_id)
        else:
            salt, password_hash = AuthService.generate_password_hash(admin_user_password)
            admin_user = User(
                id=admin_user_id,
                email=admin_user_email,
                role="admin",
                is_active=True,
                password_salt=salt,
                password_hash=password_hash,
            )
            db.add(admin_user)
            await db.commit()
            await db.refresh(admin_user)
            user = admin_user
            logger.info("✅ Created admin user: %s", admin_user_id)

        role_result = await db.execute(select(Roles).where(Roles.name == "admin"))
        admin_role = role_result.scalar_one_or_none()
        if admin_role:
            existing = await db.execute(
                select(UserRoles).where(UserRoles.user_id == user.id, UserRoles.role_id == admin_role.id)
            )
            if not existing.scalar_one_or_none():
                db.add(UserRoles(user_id=user.id, role_id=admin_role.id, assigned_by=user.id))
                await db.commit()
