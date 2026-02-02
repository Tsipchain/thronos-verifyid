from dependencies.auth import require_manager_or_admin
from dependencies.database import DbSession
from fastapi import APIRouter, Depends, HTTPException, status
from models.auth import User
from sqlalchemy import select

router = APIRouter(prefix="/api/v1/manager", tags=["manager"])


async def _get_agent(db: DbSession, user_id: str) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role != "agent":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not an agent")
    return user


@router.patch("/agents/{user_id}/approve")
async def approve_agent(
    user_id: str,
    db: DbSession,
    _current_user=Depends(require_manager_or_admin),
):
    user = await _get_agent(db, user_id)
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    return {"success": True, "user_id": user.id, "is_active": user.is_active}


@router.patch("/agents/{user_id}/disable")
async def disable_agent(
    user_id: str,
    db: DbSession,
    _current_user=Depends(require_manager_or_admin),
):
    user = await _get_agent(db, user_id)
    user.is_active = False
    await db.commit()
    await db.refresh(user)
    return {"success": True, "user_id": user.id, "is_active": user.is_active}
