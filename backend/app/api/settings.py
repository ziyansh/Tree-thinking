"""设置 API：读取与更新模型服务配置；保存后立即生效，无需重启服务。"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import SettingsPatch
from app.services import settings as settings_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def read_settings(db: Session = Depends(get_db)) -> dict:
    """返回脱敏后的当前设置（不包含明文 Key）。"""
    return settings_service.dto(db)


@router.put("")
def write_settings(payload: SettingsPatch, db: Session = Depends(get_db)) -> dict:
    """更新设置；未提交的字段保持原值，apiKey 留空表示不修改。"""
    return settings_service.update(db, payload.model_dump(exclude_none=True))
