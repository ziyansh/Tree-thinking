"""认证与会话：密码哈希、签名 Cookie 会话，以及 API Key 加解密辅助。

local 模式完全跳过认证（require_user 恒为 None）；
server 模式用 itsdangerous 签名 Cookie 保存会话，用 bcrypt 保存密码哈希。
"""

import base64
import hashlib
import re

import bcrypt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import User

# 会话 Cookie 名称与有效期（24 小时）
COOKIE_NAME = "tt_session"
SESSION_MAX_AGE = 24 * 60 * 60

# local 模式下派生加密密钥的固定默认值，保证本地无需额外配置
_DEFAULT_SECRET = "tree-thinking-local-secret"
# 加密值前缀：带该前缀表示已加密，其余视为旧明文
ENC_PREFIX = "enc:"

# 用户名 3–32 位字母数字下划线；密码 8–72 位
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,32}$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 72


def is_server_mode() -> bool:
    """当前是否服务器模式；每次读取 config，便于测试切换。"""
    return getattr(config, "APP_MODE", "local") == "server"


def normalize_username(username: str) -> str:
    """用户名统一小写，保证查询与唯一性大小写不敏感。"""
    return (username or "").strip().lower()


def validate_credentials(username: str, password: str) -> None:
    """校验注册/登录的格式；不合法时抛 400 可读错误。"""
    if not USERNAME_PATTERN.match((username or "").strip()):
        raise HTTPException(status_code=400, detail="用户名需为 3–32 位字母、数字或下划线")
    password = password or ""
    # bcrypt 只处理前 72 字节，超长密码直接拒绝
    if len(password) < MIN_PASSWORD_LENGTH or len(password.encode("utf-8")) > MAX_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail="密码长度需在 8–72 位之间")


def hash_password(password: str) -> str:
    """生成 bcrypt 哈希（字符串形式，便于直接入库）。"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    """校验密码；哈希损坏等异常按校验失败处理。"""
    try:
        return bcrypt.checkpw(
            (password or "").encode("utf-8"), (password_hash or "").encode("ascii")
        )
    except ValueError:
        return False


def _serializer() -> URLSafeTimedSerializer:
    """会话签名器；密钥取自 AUTH_SECRET（server 模式启动时已校验非空）。"""
    return URLSafeTimedSerializer(
        config.AUTH_SECRET or _DEFAULT_SECRET, salt="tt-session"
    )


def create_session_token(user_id: str) -> str:
    """把用户 id 签名为 Cookie 值。"""
    return _serializer().dumps({"uid": user_id})


def read_session_token(token: str | None) -> str | None:
    """解析会话 Cookie，返回用户 id；签名无效或过期返回 None。"""
    if not token:
        return None
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    uid = data.get("uid") if isinstance(data, dict) else None
    return uid if isinstance(uid, str) else None


def get_session_user(request: Request, db: Session) -> User | None:
    """按 Cookie 取当前用户；local 模式或未登录返回 None。"""
    if not is_server_mode():
        return None
    uid = read_session_token(request.cookies.get(COOKIE_NAME))
    return db.get(User, uid) if uid else None


def require_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    """依赖函数：local 模式返回 None 且不校验；server 模式无效会话返回 401。"""
    if not is_server_mode():
        return None
    user = get_session_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


def set_session_cookie(response: Response, user_id: str) -> None:
    """写入会话 Cookie：HttpOnly + SameSite=Lax。"""
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_session_token(user_id),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=bool(config.AUTH_COOKIE_SECURE),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """清除会话 Cookie。"""
    response.delete_cookie(COOKIE_NAME, path="/")


def _fernet() -> Fernet:
    """由 AUTH_SECRET 派生 Fernet 密钥；local 模式无密钥时用固定默认值。"""
    secret = (config.AUTH_SECRET or _DEFAULT_SECRET).encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_secret(value: str | None) -> str | None:
    """加密 API Key；空值原样返回，非空值加 enc: 前缀。"""
    if not value:
        return value
    return ENC_PREFIX + _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str | None) -> str:
    """解密 API Key；无前缀视为旧明文直接返回，解密失败按空串处理。"""
    if not value:
        return ""
    if not value.startswith(ENC_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(ENC_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""
