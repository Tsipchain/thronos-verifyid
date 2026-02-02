import uuid
from typing import List

from dependencies.auth import require_admin
from dependencies.database import DbSession
from fastapi import APIRouter, Depends, HTTPException, status
from models.auth import User
from schemas.auth import AdminCreateUserRequest, AdminUserResponse, RoleUpdateRequest
from services.auth import AuthService
from sqlalchemy import select, func

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

ALLOWED_ROLES = {"admin", "manager", "agent", "client"}


@router.get("/setup/status")
async def get_setup_status(db: DbSession):
    """Get setup status - check if admin user exists. No auth required for initial setup."""
    try:
        # Count total users
        total_result = await db.execute(select(func.count()).select_from(User))
        total_users = total_result.scalar() or 0

        # Count admin users
        admin_result = await db.execute(
            select(func.count()).select_from(User).where(User.role == "admin")
        )
        admin_count = admin_result.scalar() or 0

        return {
            "total_users": total_users,
            "admin_exists": admin_count > 0,
            "admin_count": admin_count,
            "setup_complete": admin_count > 0,
        }
    except Exception as e:
        return {
            "error": str(e),
            "total_users": 0,
            "admin_exists": False,
            "admin_count": 0,
            "setup_complete": False,
        }


@router.post("/setup/init")
async def initialize_admin(
    payload: AdminCreateUserRequest,
    db: DbSession,
):
    """Initialize the first admin user. Only works if no admin exists yet."""
    # Check if any admin already exists
    admin_result = await db.execute(
        select(func.count()).select_from(User).where(User.role == "admin")
    )
    admin_count = admin_result.scalar() or 0

    if admin_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin user already exists. Use login instead.",
        )

    # Validate password
    if not payload.password or len(payload.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters",
        )

    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create admin user
    salt, password_hash = AuthService.generate_password_hash(payload.password)
    user = User(
        id=str(uuid.uuid4()),
        email=payload.email,
        name=payload.name,
        role="admin",  # Force admin role for initial setup
        is_active=True,
        password_salt=salt,
        password_hash=password_hash,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "success": True,
        "message": "Admin user created successfully",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        }
    }


@router.get("/users", response_model=List[AdminUserResponse])
async def list_users(
    db: DbSession,
    _current_user=Depends(require_admin),
):
    result = await db.execute(select(User))
    return list(result.scalars().all())


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: AdminCreateUserRequest,
    db: DbSession,
    _current_user=Depends(require_admin),
):
    """Create a new user with a specific role. Admin only."""
    if payload.role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Allowed roles: {', '.join(ALLOWED_ROLES)}",
        )

    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user with specified role
    salt, password_hash = AuthService.generate_password_hash(payload.password)
    user = User(
        id=str(uuid.uuid4()),
        email=payload.email,
        name=payload.name,
        role=payload.role,
        is_active=True,
        password_salt=salt,
        password_hash=password_hash,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}/role", response_model=AdminUserResponse)
async def update_user_role(
    user_id: str,
    payload: RoleUpdateRequest,
    db: DbSession,
    _current_user=Depends(require_admin),
):
    if payload.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.role = payload.role
    await db.commit()
    await db.refresh(user)
    return user
