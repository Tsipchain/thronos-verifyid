import uuid
from typing import List

from dependencies.auth import require_admin
from dependencies.database import DbSession
from fastapi import APIRouter, Depends, HTTPException, status
from models.auth import User
from schemas.auth import AdminCreateUserRequest, AdminUserResponse, RoleUpdateRequest
from services.auth import AuthService
from sqlalchemy import select

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

ALLOWED_ROLES = {"admin", "manager", "agent", "client"}


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
