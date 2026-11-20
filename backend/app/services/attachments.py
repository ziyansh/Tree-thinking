"""附件：保存上传文件、读取元数据，并把附件内容组装进模型消息。

存储结构：UPLOAD_DIR/{id}{ext} 为文件本体，
UPLOAD_DIR/{id}.json 为旁挂元数据（名称、MIME、大小、类型等）。
"""

import asyncio
import base64
import io
import json
import logging
import re
import time
import uuid
from pathlib import Path

import httpx
from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

from app import config
from app.services import auth

# 单文件最大 20MB
MAX_FILE_BYTES = 20 * 1024 * 1024
# 单个节点最多 10 个附件
MAX_FILES_PER_NODE = 10
# 单个文本附件最多注入 20000 字符
MAX_TEXT_CHARS_PER_FILE = 20000
# 单次请求所有文本附件合计最多 60000 字符
MAX_TEXT_CHARS_TOTAL = 60000

# 需要走 DeepSeek Files API 解析的文档扩展名
PARSE_EXTENSIONS = {".pdf", ".doc", ".docx", ".ppt", ".pptx"}
# Files API 超时：上传 120 秒 + 解析 120 秒，取 180 秒留出余量
PARSE_TIMEOUT_SECONDS = 180.0

# 火山方舟 Files API：可直接上传的附件类型、文件用途与轮询参数
ARK_UPLOAD_KINDS = ("image", "video", "audio", "pdf")
ARK_FILES_PURPOSE = "user_data"
# 轮询文件详情直到 active：最长约 60 秒，间隔 1 秒
ARK_POLL_TIMEOUT_SECONDS = 60.0
ARK_POLL_INTERVAL_SECONDS = 1.0
# 火山方舟内容块类型：按附件 kind 决定
ARK_BLOCK_TYPES = {
    "image": "image_url",
    "video": "video_url",
    "audio": "input_audio",
    "pdf": "file",
}

# 可作为图片内容块传给模型的 MIME
IMAGE_MIME_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp")
# 按 MIME 前缀与扩展名识别的视频 / 音频附件
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".m4v"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}

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
    """按 MIME 与扩展名判定附件类型：image / text / pdf / video / audio / other。"""
    suffix = Path(name).suffix.lower()
    if mime in IMAGE_MIME_TYPES:
        return "image"
    if mime.startswith("video/") or suffix in VIDEO_EXTENSIONS:
        return "video"
    if mime.startswith("audio/") or suffix in AUDIO_EXTENSIONS:
        return "audio"
    if mime == "application/pdf" or suffix == ".pdf":
        return "pdf"
    if mime.startswith("text/") or suffix in TEXT_EXTENSIONS:
        return "text"
    return "other"


def pdf_page_count(content: bytes) -> int | None:
    """读取 PDF 页数；解析失败只记日志并返回 None，不影响附件保存。"""
    try:
        return len(PdfReader(io.BytesIO(content)).pages)
    except Exception as exc:
        logging.warning("PDF 页数解析失败：%s", exc)
        return None


def _owner_of(user) -> str:
    """附件归属：local 模式为空串，server 模式写入当前用户 id。"""
    if auth.is_server_mode() and user is not None:
        return user.id
    return ""


def is_owned(meta: dict, user) -> bool:
    """附件是否属于当前用户；local 模式不做校验。"""
    if not auth.is_server_mode() or user is None:
        return True
    return meta.get("owner_id") == user.id


async def parse_document(
    content: bytes, name: str, runtime: dict | None = None
) -> str | None:
    """把文档上传到 DeepSeek Files API 解析，成功返回 file_id。

    仅 DeepSeek 且有 Key 时尝试；任何失败只记日志并返回 None，不影响附件保存。
    """
    values = runtime or {}
    if values.get("provider") != "deepseek":
        return None
    api_key = (values.get("api_key") or "").strip()
    base_url = (values.get("base_url") or "").rstrip("/")
    if not api_key or not base_url:
        return None
    # Files API 的地址是 {base}/files；用户把接口地址填成带 /v1 时去掉，避免 404
    if base_url.endswith("/v1"):
        base_url = base_url[: -len("/v1")]

    try:
        async with httpx.AsyncClient(timeout=PARSE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{base_url}/files",
                headers={"Authorization": f"Bearer {api_key}"},
                # purpose 必须排在 file 之前，否则接口按 400 拒绝
                data={"purpose": "text_recognition"},
                files={"file": (name or "document", content)},
            )
        if response.status_code != 200:
            logging.warning("文档解析返回非 200 状态码：%s", response.status_code)
            return None
        file_id = response.json().get("id")
        return str(file_id) if file_id else None
    except Exception as exc:  # 网络异常、超时、响应非 JSON 等一律降级
        logging.warning("文档解析失败：%s", exc)
        return None


async def upload_ark_file(
    content: bytes, name: str, runtime: dict | None = None
) -> str | None:
    """把附件上传到火山方舟 Files API，轮询到 active 后返回 file_id。

    仅 ark 服务商且有 Key 时尝试；超时或任何失败只记日志并返回 None，
    附件仍正常保存，只是不注入上下文。
    """
    values = runtime or {}
    if values.get("provider") != "ark":
        return None
    api_key = (values.get("api_key") or "").strip()
    base_url = (values.get("base_url") or "").rstrip("/")
    if not api_key or not base_url:
        return None

    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=PARSE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{base_url}/files",
                headers=headers,
                data={"purpose": ARK_FILES_PURPOSE},
                files={"file": (name or "attachment", content)},
            )
            if response.status_code not in (200, 201):
                logging.warning(
                    "火山方舟文件上传返回非成功状态码：%s", response.status_code
                )
                return None
            file_id = response.json().get("id")
            if not file_id:
                return None
            file_id = str(file_id)

            # 轮询文件详情，直到 status 为 active 或超时
            deadline = time.monotonic() + ARK_POLL_TIMEOUT_SECONDS
            while True:
                detail = await client.get(f"{base_url}/files/{file_id}", headers=headers)
                if detail.status_code == 200 and detail.json().get("status") == "active":
                    return file_id
                if time.monotonic() >= deadline:
                    logging.warning("火山方舟文件解析超时：%s", file_id)
                    return None
                await asyncio.sleep(ARK_POLL_INTERVAL_SECONDS)
    except Exception as exc:  # 网络异常、超时、响应非 JSON 等一律降级
        logging.warning("火山方舟文件上传失败：%s", exc)
        return None


async def save_upload(
    file: UploadFile, user=None, runtime: dict | None = None
) -> dict:
    """分块读取并保存上传文件，返回元数据（含访问地址与归属）。"""
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
    payload = b"".join(chunks)

    meta = {
        "id": attachment_id,
        "name": name or attachment_id,
        "mime": mime,
        "size": size,
        "kind": kind,
        "ext": ext,
        # PDF 页数：非 PDF 为 None
        "pageCount": pdf_page_count(payload) if kind == "pdf" else None,
        # 解析该附件的服务商：ark / deepseek；未解析为 None
        "provider": None,
        # 归属用户 id：local 模式为空串
        "owner_id": _owner_of(user),
    }

    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (config.UPLOAD_DIR / f"{attachment_id}{ext}").write_bytes(payload)

    # 附件解析：ark 用 Files API；DeepSeek 走 OCR；其它服务商只保存
    provider = (runtime or {}).get("provider")
    file_id = None
    if provider == "ark" and kind in ARK_UPLOAD_KINDS:
        file_id = await upload_ark_file(payload, name, runtime)
        if file_id:
            meta["provider"] = "ark"
    elif ext.lower() in PARSE_EXTENSIONS:
        file_id = await parse_document(payload, name, runtime)
        if file_id:
            meta["provider"] = "deepseek"
    if file_id:
        meta["fileId"] = file_id
    meta["parsed"] = bool(file_id)

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


def resolve_ids(ids: list[str], user=None) -> list[dict]:
    """校验附件 id 列表：去重、最多 10 个；任一不存在或不属于本人则整单拒绝。"""
    unique: list[str] = []
    for attachment_id in ids or []:
        if attachment_id not in unique:
            unique.append(attachment_id)
    unique = unique[:MAX_FILES_PER_NODE]

    metas: list[dict] = []
    for attachment_id in unique:
        meta = load_meta(attachment_id)
        if meta is None or not is_owned(meta, user):
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


def _ark_block(meta: dict) -> dict | None:
    """ark 附件转内容块：只认 ark 上传的 fileId，缺失或类型不支持时返回 None。"""
    block_type = ARK_BLOCK_TYPES.get(meta.get("kind"))
    file_id = meta.get("fileId")
    # fileId 只在轮询到 active 后才保存；provider 必须是 ark
    if block_type is None or not file_id or meta.get("provider") != "ark":
        return None
    return {"type": block_type, block_type: {"file_id": file_id}}


def build_message_parts(
    node, provider: str | None = None
) -> tuple[str, list[dict], list[dict]]:
    """把节点附件转成（追加文本, 图片内容块, 其它内容块）。

    文本附件按「【附件：名称】内容」拼接到问题后面；
    provider 为 ark 时图片 / 视频 / 音频 / PDF 只注入 fileId 内容块；
    其它服务商保持原有行为（图片转 data URL、已解析文档注入 fileId）；
    元数据 provider 与当前服务商不匹配时跳过该附件（附件本身保留）。
    """
    text_parts: list[str] = []
    images: list[dict] = []
    documents: list[dict] = []
    total_chars = 0

    for meta in _attachment_items(node):
        # 附件由其它服务商解析：不注入上下文，避免把无效 fileId 传给模型
        meta_provider = meta.get("provider")
        if meta_provider and meta_provider != provider:
            logging.info("附件服务商不匹配，跳过：%s", meta.get("id"))
            continue

        kind = meta.get("kind")
        name = meta.get("name") or meta.get("id")

        if kind == "text":
            path = file_path(meta)
            if path is None:
                logging.warning("附件文件缺失，跳过：%s", meta.get("id"))
                continue
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
            continue

        if provider == "ark":
            block = _ark_block(meta)
            if block is None:
                logging.warning("附件缺少可用的 fileId，跳过：%s", meta.get("id"))
                continue
            documents.append(block)
            continue

        # 其它服务商：保持原有行为
        file_id = meta.get("fileId")
        if file_id:
            documents.append({"type": "file", "file_id": file_id})
            continue

        path = file_path(meta)
        if path is None:
            logging.warning("附件文件缺失，跳过：%s", meta.get("id"))
            continue

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
        else:
            logging.warning("不支持的附件类型，跳过：%s", meta.get("id"))

    return "".join(text_parts), images, documents
