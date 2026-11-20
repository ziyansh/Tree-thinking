"""附件 API：上传文件与按 id 读取（用于前端预览）。"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.services import attachments
from app.services import settings as runtime_settings
from app.services.auth import require_user

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


@router.post("")
async def upload_attachment(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """上传单个附件，返回元数据与访问地址。

    PDF 会解析页数；ark 服务商上传图片 / 视频 / 音频 / PDF 到 Files API，
    DeepSeek 则对文档走 OCR 解析；任何解析失败都只记日志，不影响附件保存。
    """
    runtime = runtime_settings.effective(db, user)
    return await attachments.save_upload(file, user, runtime)


@router.get("/{attachment_id}")
def read_attachment(
    attachment_id: str, user: User | None = Depends(require_user)
):
    """按 id 回读附件本体；server 模式校验归属，非本人按不存在处理。"""
    meta = attachments.load_meta(attachment_id)
    if meta is None or not attachments.is_owned(meta, user):
        raise HTTPException(status_code=404, detail="附件不存在")
    path = attachments.file_path(meta)
    if path is None:
        raise HTTPException(status_code=404, detail="附件不存在")
    return FileResponse(path, media_type=meta.get("mime") or "application/octet-stream")
