import hashlib
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

from core.database import db_manager
from models.auth import User
from models.rbac import Roles, UserRoles, Permissions, RolePermissions
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_user(self, platform_sub: str, email: str, name: Optional[str] = None) -> User:
        """Get existing user or create new one."""
        start_time = time.time()
        logger.debug(f"[DB_OP] Starting get_or_create_user - platform_sub: {platform_sub}")
        
        # Check by ID (platform_sub) OR Email to prevent duplicates
        stmt = select(User).where(
            or_(
                User.id == str(platform_sub), 
                User.email == email
            )
        )
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            user.email = email
            if name:
                user.name = name
            user.last_login = datetime.now(timezone.utc)
        else:
            user = User(
                id=str(platform_sub), 
                email=email,
                name=name,
                role="user",
                is_active=True,
                last_login=datetime.now(timezone.utc),
            )
            self.db.add(user)

        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def authenticate_local_user(self, email: str, password: str) -> Optional[User]:
        """Authenticate a user using local credentials."""
        # Use scalar_one_or_none to avoid MultipleResultsFound crashes
        result = await self.db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if not user or not user.password_salt or not user.password_hash:
            return None

        input_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), user.password_salt, 100000
        )

        if input_hash != user.password_hash:
            return None

        user.last_login = datetime.now(timezone.utc)
        await self.db.commit()
        return user

    @staticmethod
    def generate_password_hash(password: str) -> Tuple[bytes, bytes]:
        salt = secrets.token_bytes(32)
        password_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, 100000
        )
        return salt, password_hash


async def initialize_admin_user():
    """Initialize the admin user and permissions safely without crashing."""
    admin_email = "admin@thonos.com"
    # Χρησιμοποιούμε το ID 1 (Integer) για συνέπεια με τη βάση σου
    admin_target_id = 1 
    admin_password = "admin" 

    logger.info("Initializing admin user...")

    async with db_manager.session() as db:
        try:
            # 1. SMART CHECK: Find admin by Email OR ID=1
            # This prevents the MultipleResultsFound error seen in logs
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
                logger.info(f"✅ Admin found (ID: {existing_user.id}). Updating profile...")
                existing_user.email = admin_email
                existing_user.role = "admin"
                existing_user.name = "Super Admin"
                existing_user.is_active = True
                # Optional: Reset password on deploy if needed
                # existing_user.password_salt = salt
                # existing_user.password_hash = password_hash
            else:
                logger.info("Creating NEW admin user with ID 1...")
                existing_user = User(
                    id=admin_target_id,  # Force ID 1
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
            role_res = await db.execute(select(Roles).where(Roles.name == "admin"))
            admin_role = role_res.scalar_one_or_none()
            
            if not admin_role:
                admin_role = Roles(name="admin", description="Administrator with full access")
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            # 3. Link User -> Role (Safe Insert)
            ur_res = await db.execute(
                select(UserRoles).where(
                    UserRoles.user_id == existing_user.id, 
                    UserRoles.role_id == admin_role.id
                )
            )
            if not ur_res.scalar_one_or_none():
                # Note: assigned_by needs to be string if your DB expects string
                db.add(UserRoles(user_id=existing_user.id, role_id=admin_role.id, assigned_by=str(existing_user.id)))
                await db.commit()

            # 4. Auto-Generate & Link Permissions (So Modals always work)
            all_perms = [
                "view_users", "edit_users", "delete_users",
                "view_logs", "manage_system", 
                "view_dashboard", "manage_agents", 
                "view_settings", "edit_settings"
            ]

            for perm_name in all_perms:
                # Find or Create Permission
                p_res = await db.execute(select(Permissions).where(Permissions.name == perm_name))
                perm = p_res.scalar_one_or_none()
                
                if not perm:
                    perm = Permissions(name=perm_name, description=f"Auto {perm_name}")
                    db.add(perm)
                    await db.commit()
                    await db.refresh(perm)
                
                # Link Permission -> Role
                rp_res = await db.execute(
                    select(RolePermissions).where(
                        RolePermissions.role_id == admin_role.id,
                        RolePermissions.permission_id == perm.id
                    )
                )
                if not rp_res.scalar_one_or_none():
                    db.add(RolePermissions(role_id=admin_role.id, permission_id=perm.id))
            
            await db.commit()
            logger.info("✅ Admin setup complete. Dashboard ready.")

        except Exception as e:
            logger.error(f"⚠️ Admin Init Warning: {e}")
            await db.rollback()
            # We catch the error so the app doesn't crash on deploy
