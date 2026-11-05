"""附件 API：上传文件与按 id 读取（用于前端预览）。"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.services import attachments

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


@router.post("")
async def upload_attachment(file: UploadFile = File(...)) -> dict:
    """上传单个附件，返回元数据与访问地址。"""
    return await attachments.save_upload(file)


@router.get("/{attachment_id}")
def read_attachment(attachment_id: str):
    """按 id 回读附件本体；不传 filename，保持浏览器内联展示。"""
    meta = attachments.load_meta(attachment_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="附件不存在")
    path = attachments.file_path(meta)
    if path is None:
        raise HTTPException(status_code=404, detail="附件不存在")
    return FileResponse(path, media_type=meta.get("mime") or "application/octet-stream")
