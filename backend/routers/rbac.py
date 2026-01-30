from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from dependencies.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from schemas.rbac import (
    RoleResponse,
    PermissionResponse,
    UserRoleAssign,
    UserPermissionsResponse
)
from services.rbac import RBACService
from typing import List

router = APIRouter(prefix="/api/v1/rbac", tags=["rbac"])


@router.get("/roles", response_model=List[RoleResponse])
async def get_all_roles(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all available roles"""
    roles = await RBACService.get_all_roles(db)
    return roles


@router.post("/users/assign-role")
async def assign_role(
    data: UserRoleAssign,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Assign a role to a user (admin only)"""
    # Check if current user has permission
    has_permission = await RBACService.check_permission(
        db, current_user.id, "users", "manage"
    )
    if not has_permission:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    user_role = await RBACService.assign_role_to_user(
        db, data.user_id, data.role_id, current_user.id
    )
    return {"success": True, "user_role_id": user_role.id}


@router.get("/users/{user_id}/permissions", response_model=UserPermissionsResponse)
async def get_user_permissions(
    user_id: str,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's roles and permissions"""
    # Users can only view their own permissions unless they're admin
    if user_id != current_user.id:
        has_permission = await RBACService.check_permission(
            db, current_user.id, "users", "read"
        )
        if not has_permission:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    roles = await RBACService.get_user_roles(db, user_id)
    permissions = await RBACService.get_user_permissions(db, user_id)
    
    return UserPermissionsResponse(
        user_id=user_id,
        roles=roles,
        permissions=permissions
    )


@router.get("/me/permissions", response_model=UserPermissionsResponse)
async def get_my_permissions(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current user's roles and permissions"""
    roles = await RBACService.get_user_roles(db, current_user.id)
    permissions = await RBACService.get_user_permissions(db, current_user.id)
    
    return UserPermissionsResponse(
        user_id=current_user.id,
        roles=roles,
        permissions=permissions
    )


@router.get("/check-permission/{resource}/{action}")
async def check_permission(
    resource: str,
    action: str,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Check if current user has specific permission"""
    has_permission = await RBACService.check_permission(
        db, current_user.id, resource, action
    )
    return {"has_permission": has_permission}