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
from models.rbac import Roles, UserRoles, Permissions, RolePermissions
from services.rbac import RBACService
from sqlalchemy import delete, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_user(self, platform_sub: str, email: str, name: Optional[str] = None) -> User:
        """Get existing user or create new one."""
        start_time = time.time()
        logger.debug(f"[DB_OP] Starting get_or_create_user - platform_sub: {platform_sub}")
        
        # Try to find existing user by ID or Email (to avoid duplicates)
        # Note: platform_sub might be an int or string depending on the provider, 
        # but for safety we check if the ID matches OR the email matches.
        stmt = select(User).where(
            or_(
                User.id == str(platform_sub), 
                User.email == email
            )
        )
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        
        logger.debug(f"[DB_OP] User lookup completed in {time.time() - start_time:.4f}s - found: {user is not None}")

        if user:
            # Update user info if needed
            user.email = email
            if name:
                user.name = name
            user.last_login = datetime.now(timezone.utc)
        else:
            # Create new user
            # We use platform_sub as ID if possible, otherwise let DB handle it if it's auto-increment
            # Assuming ID is string based on previous logs, if Integer change accordingly.
            user = User(
                id=str(platform_sub), 
                email=email,
                name=name,
                role="user",  # Default role
                is_active=True,
                last_login=datetime.now(timezone.utc),
            )
            self.db.add(user)

        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def authenticate_local_user(self, email: str, password: str) -> Optional[User]:
        """Authenticate a user using local credentials."""
        result = await self.db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if not user or not user.password_salt or not user.password_hash:
            return None

        # Verify password
        input_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), user.password_salt, 100000
        )

        if input_hash != user.password_hash:
            return None

        # Update last login
        user.last_login = datetime.now(timezone.utc)
        await self.db.commit()
        
        return user

    @staticmethod
    def generate_password_hash(password: str) -> Tuple[bytes, bytes]:
        """Generate salt and hash for password."""
        salt = secrets.token_bytes(32)
        password_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, 100000
        )
        return salt, password_hash


async def initialize_admin_user():
    """Initialize the admin user and permissions safely."""
    admin_email = "admin@thonos.com"
    # Χρησιμοποιούμε το ID 1 ως Integer (ή string "1" ανάλογα με το μοντέλο σου)
    # για να αποφύγουμε τα conflicts με το email-as-id.
    admin_target_id = 1  
    admin_password = "admin" 

    logger.info("Initializing admin user...")

    async with db_manager.session() as db:
        try:
            # 1. Check if admin exists by Email OR by ID=1
            stmt = select(User).where(
                or_(
                    User.email == admin_email,
                    User.id == admin_target_id
                )
            )
            result = await db.execute(stmt)
            existing_user = result.scalar_one_or_none()

            salt, password_hash = AuthService.generate_password_hash(admin_password)

            if existing_user:
                logger.info(f"Admin user found (ID: {existing_user.id}). Updating credentials...")
                existing_user.email = admin_email
                existing_user.role = "admin"
                existing_user.is_active = True
                existing_user.name = "Super Admin"
                # Update password only if you want to reset it every time (optional)
                # existing_user.password_salt = salt
                # existing_user.password_hash = password_hash
            else:
                logger.info("Creating new admin user...")
                existing_user = User(
                    id=admin_target_id, # Force ID 1
                    email=admin_email,
                    name="Super Admin",
                    role="admin",
                    is_active=True,
                    password_salt=salt,
                    password_hash=password_hash,
                )
                db.add(existing_user)
            
            await db.commit()
            await db.refresh(existing_user)

            # 2. Ensure 'admin' Role Exists
            role_result = await db.execute(select(Roles).where(Roles.name == "admin"))
            admin_role = role_result.scalar_one_or_none()
            
            if not admin_role:
                admin_role = Roles(name="admin", description="Administrator with full access")
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            # 3. Assign Role to User
            user_role_res = await db.execute(
                select(UserRoles).where(
                    UserRoles.user_id == existing_user.id, 
                    UserRoles.role_id == admin_role.id
                )
            )
            if not user_role_res.scalar_one_or_none():
                db.add(UserRoles(user_id=existing_user.id, role_id=admin_role.id, assigned_by=str(existing_user.id)))
                await db.commit()

            # 4. Ensure Permissions Exist & Assign to Role
            # Λίστα με τα βασικά permissions που χρειάζεται το Dashboard
            required_perms = [
                "view_users", "edit_users", "delete_users",
                "view_logs", "manage_system", 
                "view_dashboard", "manage_agents"
            ]

            for perm_name in required_perms:
                # Check/Create Permission
                perm_res = await db.execute(select(Permissions).where(Permissions.name == perm_name))
                perm = perm_res.scalar_one_or_none()
                
                if not perm:
                    perm = Permissions(name=perm_name, description=f"Auto-generated {perm_name}")
                    db.add(perm)
                    await db.commit()
                    await db.refresh(perm)
                
                # Link Permission to Admin Role
                rp_res = await db.execute(
                    select(RolePermissions).where(
                        RolePermissions.role_id == admin_role.id,
                        RolePermissions.permission_id == perm.id
                    )
                )
                if not rp_res.scalar_one_or_none():
                    db.add(RolePermissions(role_id=admin_role.id, permission_id=perm.id))
            
            await db.commit()
            logger.info("✅ Admin user and permissions initialized successfully.")

        except Exception as e:
            logger.error(f"Failed to initialize admin user: {e}")
            await db.rollback()
            # Δεν κρασάρουμε το app, απλά καταγράφουμε το λάθος
