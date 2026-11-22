"""认证 API：会话查询、注册、登录与登出（仅 server 模式生效）。"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import User, UserSetting
from app.schemas import AuthCredentials
from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_dto(user: User) -> dict:
    """账号转前端需要的字段（不含密码哈希）。"""
    return {"id": user.id, "username": user.username}


@router.get("/session")
def read_session(request: Request, db: Session = Depends(get_db)) -> dict:
    """当前运行模式与登录用户；未登录时 user 为 null（不报 401）。"""
    user = auth.get_session_user(request, db)
    return {"mode": config.APP_MODE, "user": _user_dto(user) if user else None}


@router.get("/check-username")
def check_username(username: str = "", db: Session = Depends(get_db)) -> dict:
    """注册前检查用户名：格式合法且未被占用时 available 为 true。"""
    if not auth.is_server_mode():
        return {"available": False, "reason": "当前为本地模式，无需注册"}
    name = auth.normalize_username(username)
    error = auth.username_error(name)
    if error:
        return {"available": False, "reason": error}
    exists = db.scalar(select(User.id).where(User.username == name)) is not None
    return {
        "available": not exists,
        "reason": "该用户名已被注册" if exists else None,
    }


@router.post("/register")
def register(
    payload: AuthCredentials,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """注册账号并直接登录；用户名重复返回 400。"""
    if not auth.is_server_mode():
        raise HTTPException(status_code=400, detail="当前为本地模式，无需注册")
    auth.validate_credentials(payload.username, payload.password)
    username = auth.normalize_username(payload.username)
    if db.scalar(select(User).where(User.username == username)) is not None:
        raise HTTPException(status_code=400, detail="该用户名已被注册")

    user = User(
        username=username,
        password_hash=auth.hash_password(payload.password),
    )
    db.add(user)
    # 先 flush 取得用户主键，再初始化该用户自己的设置行
    db.flush()
    # 新账号立即初始化自己的设置行：全部字段为空，读取时使用默认值，绝不继承服务端 .env 密钥
    db.add(UserSetting(user_id=user.id))
    db.commit()
    db.refresh(user)
    auth.set_session_cookie(response, user.id)
    return {"user": _user_dto(user)}


@router.post("/login")
def login(
    payload: AuthCredentials,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """登录：用户名不存在或密码错误统一返回同一条提示。"""
    if not auth.is_server_mode():
        raise HTTPException(status_code=400, detail="当前为本地模式，无需登录")
    username = auth.normalize_username(payload.username)
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="用户名或密码错误")

    auth.set_session_cookie(response, user.id)
    return {"user": _user_dto(user)}


@router.post("/logout")
def logout(response: Response) -> dict:
    """登出：清除会话 Cookie。"""
    auth.clear_session_cookie(response)
    return {"ok": True}
