"""附件：保存上传文件、读取元数据，并把附件内容组装进模型消息。

存储结构：UPLOAD_DIR/{id}{ext} 为文件本体，
UPLOAD_DIR/{id}.json 为旁挂元数据（名称、MIME、大小、类型等）。
"""

import base64
import json
import logging
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app import config

# 单文件最大 20MB
MAX_FILE_BYTES = 20 * 1024 * 1024
# 单个节点最多 10 个附件
MAX_FILES_PER_NODE = 10
# 单个文本附件最多注入 20000 字符
MAX_TEXT_CHARS_PER_FILE = 20000
# 单次请求所有文本附件合计最多 60000 字符
MAX_TEXT_CHARS_TOTAL = 60000

# 可作为图片内容块传给模型的 MIME
IMAGE_MIME_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp")

# 作为纯文本读取的扩展名白名单
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".json", ".csv", ".log",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".xml",
    ".yaml", ".yml", ".toml", ".ini", ".sql", ".java", ".c", ".cpp",
    ".h", ".go", ".rs", ".sh", ".bat", ".ps1",
}

# 附件 id 必须是 32 位十六进制，避免路径穿越
_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _kind_of(name: str, mime: str) -> str:
    """按 MIME 与扩展名判定附件类型：image / text / other。"""
    if mime in IMAGE_MIME_TYPES:
        return "image"
    if mime.startswith("text/") or Path(name).suffix.lower() in TEXT_EXTENSIONS:
        return "text"
    return "other"


async def save_upload(file: UploadFile) -> dict:
    """分块读取并保存上传文件，返回元数据（含访问地址）。"""
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        # 超过上限直接拒绝，避免把超大文件写进磁盘
        if size > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail="附件大小不能超过 20MB")
        chunks.append(chunk)

    attachment_id = uuid.uuid4().hex
    name = file.filename or ""
    ext = re.sub(r"[^0-9A-Za-z.]", "", Path(name).suffix)[:10]
    mime = file.content_type or ""
    kind = _kind_of(name, mime)

    meta = {
        "id": attachment_id,
        "name": name or attachment_id,
        "mime": mime,
        "size": size,
        "kind": kind,
        "ext": ext,
    }

    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (config.UPLOAD_DIR / f"{attachment_id}{ext}").write_bytes(b"".join(chunks))
    (config.UPLOAD_DIR / f"{attachment_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )
    return {**meta, "url": f"/api/attachments/{attachment_id}"}


def load_meta(attachment_id: str) -> dict | None:
    """读取旁挂元数据；id 非法或文件缺失时返回 None。"""
    if not _ID_PATTERN.match(attachment_id or ""):
        return None
    sidecar = config.UPLOAD_DIR / f"{attachment_id}.json"
    try:
        meta = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return meta if isinstance(meta, dict) else None


def resolve_ids(ids: list[str]) -> list[dict]:
    """校验附件 id 列表：去重、最多 10 个；任一不存在则整单拒绝。"""
    unique: list[str] = []
    for attachment_id in ids or []:
        if attachment_id not in unique:
            unique.append(attachment_id)
    unique = unique[:MAX_FILES_PER_NODE]

    metas: list[dict] = []
    for attachment_id in unique:
        meta = load_meta(attachment_id)
        if meta is None:
            raise HTTPException(status_code=400, detail="附件不存在或已失效")
        metas.append({**meta, "url": f"/api/attachments/{attachment_id}"})
    return metas


def file_path(meta: dict) -> Path | None:
    """由元数据得到磁盘路径；ext 含路径分隔符或文件不存在时返回 None。"""
    ext = str(meta.get("ext") or "")
    if "/" in ext or "\\" in ext:
        return None
    path = config.UPLOAD_DIR / f"{meta.get('id')}{ext}"
    return path if path.is_file() else None


def _attachment_items(node) -> list[dict]:
    """解析节点的 attachments JSON 字段，非法内容按空数组处理。"""
    try:
        items = json.loads(getattr(node, "attachments", "") or "[]")
    except ValueError:
        return []
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def build_message_parts(node) -> tuple[str, list[dict]]:
    """把节点附件转成（追加文本, 图片内容块列表）。

    文本附件按「【附件：名称】内容」拼接到问题后面；
    图片附件转 data URL 内容块；缺失文件或其它类型直接跳过并记日志。
    """
    text_parts: list[str] = []
    images: list[dict] = []
    total_chars = 0

    for meta in _attachment_items(node):
        path = file_path(meta)
        if path is None:
            logging.warning("附件文件缺失，跳过：%s", meta.get("id"))
            continue

        kind = meta.get("kind")
        name = meta.get("name") or meta.get("id")

        if kind == "image":
            mime = meta.get("mime") or "application/octet-stream"
            try:
                encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            except OSError:
                logging.warning("读取图片附件失败，跳过：%s", meta.get("id"))
                continue
            images.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime};base64,{encoded}",
                        "detail": "low",
                    },
                }
            )
        elif kind == "text":
            # 累计已到上限时停止收集，避免提示词无限膨胀
            if total_chars >= MAX_TEXT_CHARS_TOTAL:
                break
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                logging.warning("读取文本附件失败，跳过：%s", meta.get("id"))
                continue
            remaining = MAX_TEXT_CHARS_TOTAL - total_chars
            content = content[: min(MAX_TEXT_CHARS_PER_FILE, remaining)]
            text_parts.append(f"\n\n【附件：{name}】\n{content}")
            total_chars += len(content)
        else:
            logging.warning("不支持的附件类型，跳过：%s", meta.get("id"))

    return "".join(text_parts), images
