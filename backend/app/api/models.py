"""火山方舟模型列表 API：代理方舟 Models 接口，供前端展示模型与能力。"""

import hashlib
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.services import settings as runtime_settings
from app.services.auth import require_user

router = APIRouter(prefix="/api/ark", tags=["models"])

# 缓存有效期：5 分钟
CACHE_TTL_SECONDS = 300
# 上游错误响应文本的截断长度，避免把整页 HTML 回传给前端
ERROR_TEXT_LIMIT = 200
# 内存缓存：键 -> (过期时间, 响应体)
_cache: dict[str, tuple[float, dict]] = {}


def _cache_key(base_url: str, api_key: str) -> str:
    """缓存键只保留 Key 的摘要，避免明文 Key 留在内存索引中。"""
    digest = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
    return f"{base_url}|{digest}"


def _normalize_model(item: dict) -> dict | None:
    """把方舟模型对象映射为前端结构；没有 id 的项直接丢弃。"""
    model_id = item.get("id")
    if not model_id:
        return None
    modalities = item.get("modalities") or {}
    return {
        "id": model_id,
        "name": item.get("name") or model_id,
        "inputModalities": list(modalities.get("input_modalities") or []),
        "outputModalities": list(modalities.get("output_modalities") or []),
        "features": item.get("features") or {},
    }


@router.get("/models")
async def list_ark_models(
    db: Session = Depends(get_db), user: User | None = Depends(require_user)
) -> dict:
    """返回当前生效配置下可用的火山方舟模型列表（结果缓存 5 分钟）。"""
    runtime = runtime_settings.effective(db, user)
    if runtime["provider"] != "ark" or not runtime["api_key"]:
        raise HTTPException(status_code=400, detail="请先配置火山方舟 API Key")

    base_url = (runtime["base_url"] or "").rstrip("/")
    key = _cache_key(base_url, runtime["api_key"])
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {runtime['api_key']}"},
        )

    if response.status_code >= 400:
        text = (response.text or "").strip()[:ERROR_TEXT_LIMIT]
        raise HTTPException(
            status_code=502,
            detail=f"火山方舟模型列表请求失败（{response.status_code}）：{text}",
        )

    payload = response.json()
    models = [
        model
        for model in (_normalize_model(item) for item in payload.get("data") or [])
        if model is not None
    ]
    result = {"models": models}
    _cache[key] = (now + CACHE_TTL_SECONDS, result)
    return result
