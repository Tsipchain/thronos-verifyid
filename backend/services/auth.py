import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.auth import create_access_token
from core.config import settings
from core.database import get_db
from models.auth import OIDCState, User
from models.rbac import Roles, UserRoles
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((password + salt).encode()).hexdigest()

class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def generate_password_hash(password: str) -> tuple[str, str]:
        salt = secrets.token_hex(16)
        password_hash = hash_password(password, salt)
        return salt, password_hash

    async def store_oidc_state(self, state: str, nonce: str, code_verifier: str) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        self.db.add(
            OIDCState(
                state=state,
                nonce=nonce,
                code_verifier=code_verifier,
                expires_at=expires_at,
            )
        )
        await self.db.commit()

    async def get_and_delete_oidc_state(self, state: str) -> Optional[dict]:
        result = await self.db.execute(select(OIDCState).where(OIDCState.state == state))
        record = result.scalar_one_or_none()
        if not record:
            return None

        if record.expires_at < datetime.now(timezone.utc):
            await self.db.execute(delete(OIDCState).where(OIDCState.id == record.id))
            await self.db.commit()
            return None

        payload = {"nonce": record.nonce, "code_verifier": record.code_verifier}
        await self.db.execute(delete(OIDCState).where(OIDCState.id == record.id))
        await self.db.commit()
        return payload

    async def register_local_user(self, email: str, password: str, name: Optional[str] = None) -> User:
        result = await self.db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError("Email already registered")

        salt = secrets.token_hex(16)
        user = User(
            id=email,
            email=email,
            name=name,
            role="client",
            password_hash=hash_password(password, salt),
            password_salt=salt,
            is_active=True,
            productivity_points=0,
            created_at=datetime.now(timezone.utc),
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def authenticate_local_user(self, email: str, password: str) -> Optional[User]:
        result = await self.db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if not user or not user.password_salt or not user.password_hash:
            return None

        if user.password_hash != hash_password(password, user.password_salt):
            return None

        user.last_login = datetime.now(timezone.utc)
        if not user.is_active:
            user.is_active = True
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def issue_app_token(self, user: User) -> tuple[str, datetime, dict]:
        now = datetime.now(timezone.utc)
        expires_minutes = int(settings.jwt_expire_minutes)
        expires_at = now + timedelta(minutes=expires_minutes)

        claims = {
            "sub": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "last_login": now.isoformat(),
        }
        token = create_access_token(claims, expires_minutes=expires_minutes)
        return token, expires_at, claims

    async def get_or_create_user(self, platform_sub: str, email: str, name: Optional[str] = None) -> User:
        stmt = select(User).where(or_(User.id == str(platform_sub), User.email == email))
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            user.email = email
            if name: user.name = name
            user.last_login = datetime.now(timezone.utc)
            if not user.is_active: user.is_active = True
        else:
            user = User(
                id=str(platform_sub), 
                email=email,
                name=name,
                role="user",
                is_active=True,
                productivity_points=0,
                created_at=datetime.now(timezone.utc)
            )
            self.db.add(user)
        
        try:
            await self.db.commit()
            await self.db.refresh(user)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error saving user: {e}")
            raise e
        return user

async def initialize_admin_user():
    """
    Initialize system admin user and roles safely.
    Uses async for to iterate over the generator from get_db().
    """
    logger.info("🎬 Initializing Admin & Roles...")
    
    # Χρησιμοποιούμε async for γιατί το get_db είναι generator
    async for db in get_db():
        try:
            # --- 1. Admin User ---
            admin_email = os.getenv("ADMIN_EMAIL", "admin@thonos.com").strip()
            admin_pass = os.getenv("ADMIN_PASSWORD", "admin123")
            admin_id = os.getenv("ADMIN_USER_ID", "1").strip()
            admin_reset_password = os.getenv("ADMIN_RESET_PASSWORD", "").lower() in ("1", "true", "yes")

            admin = None
            if admin_id:
                stmt = select(User).where(User.id == admin_id)
                result = await db.execute(stmt)
                admin = result.scalar_one_or_none()

            # --- 2. Admin Role ---
            role_stmt = select(Roles).where(Roles.name == "admin")
            role_res = await db.execute(role_stmt)
            admin_role = role_res.scalar_one_or_none()
            
            if not admin_role:
                logger.info("Creating 'admin' Role...")
                admin_role = Roles(
                    name="admin",
                    display_name="Administrator",
                    description="Super User Access",
                )
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            if not admin:
                role_user_stmt = (
                    select(User)
                    .join(UserRoles, User.id == UserRoles.user_id)
                    .where(UserRoles.role_id == admin_role.id)
                )
                role_user_res = await db.execute(role_user_stmt)
                admin = role_user_res.scalars().first()

            if not admin and admin_email:
                stmt = select(User).where(User.email == admin_email)
                result = await db.execute(stmt)
                admin = result.scalar_one_or_none()

            if not admin:
                logger.info("Creating Admin User...")
                salt = secrets.token_hex(16)
                admin = User(
                    id=admin_id or admin_email,
                    email=admin_email,
                    name="System Admin",
                    role="admin",
                    password_hash=hash_password(admin_pass, salt),
                    password_salt=salt,
                    is_active=True,
                    productivity_points=0,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(admin)
            else:
                logger.info("Admin User already exists.")
                if admin.role != "admin":
                    admin.role = "admin"
                if not admin.is_active:
                    admin.is_active = True
                if admin_email and admin.email != admin_email:
                    admin.email = admin_email
                if admin_pass and (admin_reset_password or not admin.password_hash or not admin.password_salt):
                    salt = secrets.token_hex(16)
                    admin.password_salt = salt
                    admin.password_hash = hash_password(admin_pass, salt)

            await db.commit()
            await db.refresh(admin)

            # --- 3. Link User-Role ---
            ur_stmt = select(UserRoles).where(
                UserRoles.user_id == admin.id, 
                UserRoles.role_id == admin_role.id
            )
            if not (await db.execute(ur_stmt)).scalar_one_or_none():
                logger.info("Linking Admin User to Role...")
                db.add(UserRoles(user_id=admin.id, role_id=admin_role.id, assigned_by="system"))
                await db.commit()

            logger.info("✅ Initialization Complete.")
            break # Βγαίνουμε από το loop αφού τελειώσαμε

        except Exception as e:
            await db.rollback()
            logger.error(f"❌ Initialization Failed: {e}")
            break
