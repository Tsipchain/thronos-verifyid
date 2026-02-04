from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from models.auth import User
from models.rbac import Roles, Permissions, RolePermissions, UserRoles
from typing import List, Optional


class RBACService:
    
    @staticmethod
    async def initialize_default_roles(db: AsyncSession):
        """Initialize default roles and permissions"""
        # Define roles
        roles_data = [
            {
                "name": "kyc_agent",
                "display_name": "KYC Agent",
                "description": "Call center staff for identity verification"
            },
            {
                "name": "agent",
                "display_name": "Agent",
                "description": "Call center staff for identity verification"
            },
            {
                "name": "it_staff",
                "display_name": "IT Staff",
                "description": "Technical staff with full system access"
            },
            {
                "name": "management",
                "display_name": "Management",
                "description": "Management with oversight and reporting access"
            },
            {
                "name": "manager",
                "display_name": "Manager",
                "description": "Management with oversight and reporting access"
            },
            {
                "name": "admin",
                "display_name": "Administrator",
                "description": "System administrator with all permissions"
            }
        ]

        role_objects = {}
        existing_roles_result = await db.execute(select(Roles))
        for role in existing_roles_result.scalars().all():
            role_objects[role.name] = role

        for role_data in roles_data:
            if role_data["name"] in role_objects:
                continue
            role = Roles(**role_data)
            db.add(role)
            await db.flush()
            role_objects[role_data["name"]] = role
        
        # Define permissions
        permissions_data = [
            # Verification permissions
            {"name": "verifications.read", "resource": "verifications", "action": "read", "description": "View verifications"},
            {"name": "verifications.create", "resource": "verifications", "action": "create", "description": "Create verifications"},
            {"name": "verifications.update", "resource": "verifications", "action": "update", "description": "Update verifications"},
            {"name": "verifications.delete", "resource": "verifications", "action": "delete", "description": "Delete verifications"},
            
            # Chat permissions
            {"name": "chat.read", "resource": "chat", "action": "read", "description": "View chat messages"},
            {"name": "chat.send", "resource": "chat", "action": "create", "description": "Send chat messages"},
            {"name": "chat.manage", "resource": "chat", "action": "manage", "description": "Manage chat rooms"},
            
            # User permissions
            {"name": "users.read", "resource": "users", "action": "read", "description": "View users"},
            {"name": "users.manage", "resource": "users", "action": "manage", "description": "Manage users"},
            
            # Settings permissions
            {"name": "settings.read", "resource": "settings", "action": "read", "description": "View settings"},
            {"name": "settings.manage", "resource": "settings", "action": "manage", "description": "Manage settings"},
            
            # Reports permissions
            {"name": "reports.read", "resource": "reports", "action": "read", "description": "View reports"},
            {"name": "reports.create", "resource": "reports", "action": "create", "description": "Create reports"},
        ]

        permission_objects = {}
        existing_permissions_result = await db.execute(select(Permissions))
        for permission in existing_permissions_result.scalars().all():
            permission_objects[permission.name] = permission

        for perm_data in permissions_data:
            if perm_data["name"] in permission_objects:
                continue
            permission = Permissions(**perm_data)
            db.add(permission)
            await db.flush()
            permission_objects[perm_data["name"]] = permission
        
        # Assign permissions to roles
        role_permission_mapping = {
            "kyc_agent": [
                "verifications.read",
                "verifications.create",
                "verifications.update",
                "chat.read",
                "chat.send"
            ],
            "agent": [
                "verifications.read",
                "verifications.create",
                "verifications.update",
                "chat.read",
                "chat.send"
            ],
            "it_staff": [
                "verifications.read",
                "verifications.create",
                "verifications.update",
                "verifications.delete",
                "chat.read",
                "chat.send",
                "chat.manage",
                "users.read",
                "settings.read",
                "settings.manage"
            ],
            "management": [
                "verifications.read",
                "chat.read",
                "chat.manage",
                "users.read",
                "reports.read",
                "reports.create",
                "settings.read"
            ],
            "manager": [
                "verifications.read",
                "chat.read",
                "chat.manage",
                "users.read",
                "reports.read",
                "reports.create",
                "settings.read"
            ],
            "admin": list(permission_objects.keys())  # All permissions
        }
        
        for role_name, permission_names in role_permission_mapping.items():
            role = role_objects[role_name]
            for perm_name in permission_names:
                permission = permission_objects[perm_name]
                existing_role_perm = await db.execute(
                    select(RolePermissions).where(
                        RolePermissions.role_id == role.id,
                        RolePermissions.permission_id == permission.id,
                    )
                )
                if existing_role_perm.scalars().first():
                    continue
                role_perm = RolePermissions(role_id=role.id, permission_id=permission.id)
                db.add(role_perm)
        
        await db.commit()

    @staticmethod
    async def _ensure_user_role_link(db: AsyncSession, user_id: str) -> None:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.role:
            return

        role_result = await db.execute(select(Roles).where(Roles.name == user.role))
        role = role_result.scalar_one_or_none()
        if not role:
            return

        existing_role = await db.execute(
            select(UserRoles).where(
                UserRoles.user_id == user_id,
                UserRoles.role_id == role.id,
            )
        )
        if existing_role.scalar_one_or_none():
            return

        db.add(UserRoles(user_id=user_id, role_id=role.id, assigned_by="system"))
        await db.commit()
    
    @staticmethod
    async def assign_role_to_user(
        db: AsyncSession,
        user_id: str,
        role_id: int,
        assigned_by: str
    ) -> UserRoles:
        """Assign a role to a user"""
        user_role = UserRoles(
            user_id=user_id,
            role_id=role_id,
            assigned_by=assigned_by
        )
        db.add(user_role)
        await db.commit()
        await db.refresh(user_role)
        return user_role
    
    @staticmethod
    async def get_user_roles(db: AsyncSession, user_id: str) -> List[Roles]:
        """Get all roles assigned to a user"""
        result = await db.execute(
            select(Roles)
            .join(UserRoles, Roles.id == UserRoles.role_id)
            .where(UserRoles.user_id == user_id)
        )
        roles = result.scalars().all()
        if roles:
            return roles

        await RBACService._ensure_user_role_link(db, user_id)

        result = await db.execute(
            select(Roles)
            .join(UserRoles, Roles.id == UserRoles.role_id)
            .where(UserRoles.user_id == user_id)
        )
        return result.scalars().all()
    
    @staticmethod
    async def get_user_permissions(db: AsyncSession, user_id: str) -> List[Permissions]:
        """Get all permissions for a user based on their roles"""
        await RBACService.get_user_roles(db, user_id)
        result = await db.execute(
            select(Permissions)
            .join(RolePermissions, Permissions.id == RolePermissions.permission_id)
            .join(UserRoles, RolePermissions.role_id == UserRoles.role_id)
            .where(UserRoles.user_id == user_id)
            .distinct()
        )
        return result.scalars().all()
    
    @staticmethod
    async def check_permission(
        db: AsyncSession,
        user_id: str,
        resource: str,
        action: str
    ) -> bool:
        """Check if user has specific permission"""
        await RBACService.get_user_roles(db, user_id)
        result = await db.execute(
            select(Permissions)
            .join(RolePermissions, Permissions.id == RolePermissions.permission_id)
            .join(UserRoles, RolePermissions.role_id == UserRoles.role_id)
            .where(
                and_(
                    UserRoles.user_id == user_id,
                    Permissions.resource == resource,
                    Permissions.action == action
                )
            )
        )
        return result.scalars().first() is not None
    
    @staticmethod
    async def get_all_roles(db: AsyncSession) -> List[Roles]:
        """Get all available roles"""
        result = await db.execute(
            select(Roles).where(Roles.is_active == True)
        )
        return result.scalars().all()
