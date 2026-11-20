"""附件扩展测试：kind 识别、PDF 页数、provider 匹配、ark 内容块与 Files API。"""

import json
from types import SimpleNamespace

from app import config
from app.services import attachments, llm


def _upload(client, name: str, content: bytes, mime: str) -> dict:
    """调用上传接口，返回附件元数据。"""
    response = client.post(
        "/api/attachments", files={"file": (name, content, mime)}
    )
    assert response.status_code == 200
    return response.json()


def _meta(kind: str, file_id: str | None, provider: str | None = "ark") -> dict:
    """构造仅含 build_message_parts 所需字段的附件元数据。"""
    return {
        "id": f"{kind[:1] * 32}",
        "name": f"demo.{kind}",
        "mime": "application/octet-stream",
        "size": 1,
        "kind": kind,
        "ext": "",
        "fileId": file_id,
        "provider": provider,
    }


def test_kind_detection():
    """kind 按 MIME 与扩展名识别为 image / text / pdf / video / audio / other。"""
    assert attachments._kind_of("a.pdf", "application/pdf") == "pdf"
    assert attachments._kind_of("a.pdf", "") == "pdf"
    assert attachments._kind_of("clip.mp4", "video/mp4") == "video"
    assert attachments._kind_of("clip.mov", "") == "video"
    assert attachments._kind_of("voice.mp3", "audio/mpeg") == "audio"
    assert attachments._kind_of("voice.wav", "") == "audio"
    assert attachments._kind_of("note.md", "text/markdown") == "text"
    assert attachments._kind_of("pixel.png", "image/png") == "image"
    assert attachments._kind_of("archive.zip", "application/zip") == "other"


def test_pdf_page_count(client, monkeypatch):
    """PDF 上传返回 pageCount；非 PDF 为 null。"""

    class FakePages:
        def __len__(self):
            return 3

    class FakeReader:
        def __init__(self, stream):
            self.pages = FakePages()

    monkeypatch.setattr(attachments, "PdfReader", FakeReader)

    pdf_meta = _upload(client, "doc.pdf", b"%PDF-1.4 fake", "application/pdf")
    assert pdf_meta["kind"] == "pdf"
    assert pdf_meta["pageCount"] == 3

    text_meta = _upload(client, "note.txt", "正文".encode("utf-8"), "text/plain")
    assert text_meta["pageCount"] is None


def test_provider_mismatch_skipped():
    """服务商不匹配的附件不注入上下文，文本不受影响。"""
    ark_meta = _meta("pdf", "file-ark", "ark")
    deepseek_meta = _meta("pdf", "file-ds", "deepseek")

    ark_node = SimpleNamespace(attachments=json.dumps([ark_meta]))
    text, images, documents = attachments.build_message_parts(ark_node, "deepseek")
    assert (text, images, documents) == ("", [], [])

    ds_node = SimpleNamespace(attachments=json.dumps([deepseek_meta]))
    text, images, documents = attachments.build_message_parts(ds_node, "ark")
    assert (text, images, documents) == ("", [], [])


def test_ark_content_blocks():
    """ark 模式下图片 / 视频 / 音频 / PDF 只注入 fileId 内容块，缺失则跳过。"""
    node = SimpleNamespace(
        attachments=json.dumps(
            [
                _meta("image", "img-1"),
                _meta("video", "vid-1"),
                _meta("audio", "aud-1"),
                _meta("pdf", "pdf-1"),
                _meta("image", None),
            ]
        )
    )

    text, images, documents = attachments.build_message_parts(node, "ark")

    assert text == ""
    assert images == []
    assert documents == [
        {"type": "image_url", "image_url": {"file_id": "img-1"}},
        {"type": "video_url", "video_url": {"file_id": "vid-1"}},
        {"type": "input_audio", "input_audio": {"file_id": "aud-1"}},
        {"type": "file", "file": {"file_id": "pdf-1"}},
    ]


def test_ark_text_attachment_still_injected(client):
    """ark 模式下文本附件仍按文本注入。"""
    meta = _upload(client, "memo.txt", "文本内容".encode("utf-8"), "text/plain")
    node = SimpleNamespace(attachments=json.dumps([meta]))

    text, images, documents = attachments.build_message_parts(node, "ark")

    assert "【附件：memo.txt】" in text
    assert "文本内容" in text
    assert images == [] and documents == []


def test_ark_responses_pdf_input_file():
    """Responses 联网路径把 PDF 转成 input_file、图片转成 input_image。"""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "file", "file": {"file_id": "file-1"}},
                {"type": "image_url", "image_url": {"file_id": "img-1"}},
                {"type": "text", "text": "总结附件"},
            ],
        }
    ]

    _, items = llm._ark_input(messages)

    assert items == [
        {
            "role": "user",
            "content": [
                {"type": "input_file", "file_id": "file-1"},
                {"type": "input_image", "file_id": "img-1"},
                {"type": "input_text", "text": "总结附件"},
            ],
        }
    ]


def _fake_ark_client(captured: dict, statuses: list[str]):
    """构造假的 httpx.AsyncClient：记录上传请求，按顺序返回文件状态。"""

    class FakeResponse:
        def __init__(self, payload: dict):
            self._payload = payload
            self.status_code = 200

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            captured.update(url=url, headers=headers, data=data, files=files)
            return FakeResponse({"id": "file-ark-1"})

        async def get(self, url, headers=None):
            captured["get_url"] = url
            captured["get_headers"] = headers
            index = captured.get("gets", 0)
            captured["gets"] = index + 1
            status = statuses[min(index, len(statuses) - 1)]
            return FakeResponse({"id": "file-ark-1", "status": status})

    return FakeClient


def test_ark_files_api_upload(client, monkeypatch):
    """ark 上传图片：POST /files（Bearer + purpose），轮询到 active 后保存 fileId。"""
    captured: dict = {}
    monkeypatch.setattr(
        attachments.httpx, "AsyncClient", _fake_ark_client(captured, ["processing", "active"])
    )
    monkeypatch.setattr(attachments, "ARK_POLL_INTERVAL_SECONDS", 0.0)

    client.put(
        "/api/settings", json={"provider": "ark", "arkApiKey": "ark-upload-key"}
    )
    meta = _upload(client, "pixel.png", b"png-bytes", "image/png")

    assert meta["provider"] == "ark"
    assert meta["fileId"] == "file-ark-1"
    assert meta["parsed"] is True
    assert captured["url"] == f"{config.ARK_BASE_URL}/files"
    assert captured["headers"]["Authorization"] == "Bearer ark-upload-key"
    assert captured["data"] == {"purpose": "user_data"}
    assert "file" in captured["files"]
    # 轮询文件详情，直到 status 为 active
    assert captured["get_url"] == f"{config.ARK_BASE_URL}/files/file-ark-1"
    assert captured["gets"] == 2
    assert attachments.load_meta(meta["id"])["fileId"] == "file-ark-1"


def test_ark_files_api_timeout_keeps_attachment(client, monkeypatch):
    """轮询超时只记日志：附件仍保存，但不带 fileId / provider。"""
    captured: dict = {}
    monkeypatch.setattr(
        attachments.httpx, "AsyncClient", _fake_ark_client(captured, ["processing"])
    )
    monkeypatch.setattr(attachments, "ARK_POLL_INTERVAL_SECONDS", 0.0)
    monkeypatch.setattr(attachments, "ARK_POLL_TIMEOUT_SECONDS", 0.0)

    client.put(
        "/api/settings", json={"provider": "ark", "arkApiKey": "ark-upload-key"}
    )
    meta = _upload(client, "clip.mp4", b"video-bytes", "video/mp4")

    assert meta["kind"] == "video"
    assert meta["provider"] is None
    assert "fileId" not in meta
    assert meta["parsed"] is False
    assert attachments.load_meta(meta["id"])["kind"] == "video"
