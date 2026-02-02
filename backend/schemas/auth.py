from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: str  # Now a string UUID (platform sub)
    email: str
    name: Optional[str] = None
    role: str = "client"  # client/agent/manager/admin
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class AdminUserResponse(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    role: str
    is_active: bool
    productivity_points: int
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class LocalRegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class LocalLoginRequest(BaseModel):
    email: str
    password: str


class AuthTokenResponse(BaseModel):
    token: str
    token_type: str = "Bearer"


class RoleUpdateRequest(BaseModel):
    role: str


class AdminCreateUserRequest(BaseModel):
    """Request body for admin to create a new user with a specific role."""

    email: str
    password: str
    name: Optional[str] = None
    role: str = "client"  # admin, manager, agent, client


class PlatformTokenExchangeRequest(BaseModel):
    """Request body for exchanging Platform token for app token."""

    platform_token: str


class TokenExchangeResponse(BaseModel):
    """Response body for issued application token."""

    token: str
