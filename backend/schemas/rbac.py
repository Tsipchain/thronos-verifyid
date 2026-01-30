from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class RoleCreate(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = None


class RoleResponse(BaseModel):
    id: int
    name: str
    display_name: str
    description: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class PermissionResponse(BaseModel):
    id: int
    name: str
    resource: str
    action: str
    description: Optional[str] = None

    class Config:
        from_attributes = True


class UserRoleAssign(BaseModel):
    user_id: str
    role_id: int


class UserPermissionsResponse(BaseModel):
    user_id: str
    roles: List[RoleResponse]
    permissions: List[PermissionResponse]