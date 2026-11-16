"""v0.3.1 功能测试：会话标题、文件解析与智能/强制搜索。"""

import asyncio
import json
from types import SimpleNamespace

from app.models import ConversationNode, Project
from app.services import attachments, llm, suggestions


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    """把 SSE 响应文本解析成 (event, data) 列表。"""
    events: list[tuple[str, dict]] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = ""
        data: dict = {}
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: ") :])
        events.append((event, data))
    return events


def _create_root(client, name: str = "新画布") -> dict:
    """新建画布并写入根节点问题，返回 {project, root} 的接口结果。"""
    project = client.post("/api/projects", json={"name": name}).json()
    client.post(
        f"/api/nodes/{project['rootNode']['id']}/question",
        json={"question": "北京明天会下雨吗"},
    )
    return project


def _load_project(session_factory, project_id: str) -> Project:
    """直接从内存库读取画布。"""
    db = session_factory()
    try:
        return db.get(Project, project_id)
    finally:
        db.close()


def _load_node(session_factory, node_id: str) -> ConversationNode:
    """直接从内存库读取节点。"""
    db = session_factory()
    try:
        return db.get(ConversationNode, node_id)
    finally:
        db.close()


# ---------- A. 联网搜索模式设置 ----------


def test_web_search_mode_default_and_toggle(client):
    """搜索模式默认 smart，可切换 forced；非法值返回 422。"""
    assert client.get("/api/settings").json()["webSearchMode"] == "smart"

    forced = client.put("/api/settings", json={"webSearchMode": "forced"})
    assert forced.status_code == 200
    assert forced.json()["webSearchMode"] == "forced"
    assert client.get("/api/settings").json()["webSearchMode"] == "forced"

    back = client.put("/api/settings", json={"webSearchMode": "smart"})
    assert back.json()["webSearchMode"] == "smart"

    invalid = client.put("/api/settings", json={"webSearchMode": "auto"})
    assert invalid.status_code == 422


# ---------- B. 会话标题 ----------


def test_root_first_answer_uses_title(client, session_factory, monkeypatch):
    """根卡片首次回答开启 title：收到标题后改名画布并推送 title 事件。"""
    client.put("/api/settings", json={"apiKey": "sk-title-key"})
    project = _create_root(client)
    project_id = project["project"]["id"]
    node_id = project["rootNode"]["id"]

    captured: dict = {}

    async def fake_stream_chat(
        messages, runtime=None, enable_title=False, tools=None
    ):
        captured["enable_title"] = enable_title
        yield "delta", "会下雨"
        yield "title", "北京明日天气"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    assert captured["enable_title"] is True
    assert ("title", {"title": "北京明日天气", "projectId": project_id}) in events
    assert events[-1] == ("done", {"status": "done"})

    saved = _load_project(session_factory, project_id)
    assert saved.name == "北京明日天气"
    # 标题属于自动命名，不标记为用户自定义
    assert saved.name_is_custom is False

    # 后续回答不再开启标题
    client.post(f"/api/nodes/{node_id}/answer")
    assert captured["enable_title"] is False


def test_title_disabled_for_non_root_and_renamed_project(
    client, monkeypatch
):
    """非根卡片、已手动改名的画布都不开启 title。"""
    client.put("/api/settings", json={"apiKey": "sk-title-key"})
    project = _create_root(client)
    project_id = project["project"]["id"]
    root_id = project["rootNode"]["id"]

    captured: list[bool] = []

    async def fake_stream_chat(
        messages, runtime=None, enable_title=False, tools=None
    ):
        captured.append(enable_title)
        yield "delta", "好"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    # 非根卡片：即使画布仍是默认名也不开启
    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": root_id, "question": "子问题"},
    ).json()
    client.post(f"/api/nodes/{child['id']}/answer")
    assert captured == [False]

    # 根卡片：画布被手动改名后不开启
    client.patch(f"/api/projects/{project_id}", json={"name": "手动命名"})
    client.post(f"/api/nodes/{root_id}/answer")
    assert captured == [False, False]


# ---------- C. 文件解析（DeepSeek Files API） ----------


def _fake_httpx_client(captured: dict, file_id: str = "file-api-123"):
    """构造假的 httpx.AsyncClient：记录上传请求并返回 file id。"""

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"id": file_id, "object": "file"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, data=None, files=None):
            captured.update(url=url, headers=headers, data=data, files=files)
            return FakeResponse()

    return FakeClient


def test_document_upload_calls_files_api(client, monkeypatch):
    """上传 PDF 时调用 Files API：返回 fileId，元数据 parsed 为 True。"""
    client.put("/api/settings", json={"apiKey": "sk-parse-key"})
    captured: dict = {}
    monkeypatch.setattr(
        attachments.httpx, "AsyncClient", _fake_httpx_client(captured)
    )

    response = client.post(
        "/api/attachments",
        files={"file": ("report.pdf", b"%PDF-1.4 test", "application/pdf")},
    )

    assert response.status_code == 200
    meta = response.json()
    assert meta["fileId"] == "file-api-123"
    assert meta["parsed"] is True
    assert captured["url"].endswith("/files")
    assert captured["headers"]["Authorization"] == "Bearer sk-parse-key"
    # purpose 必须在 file 之前作为表单字段发送
    assert captured["data"] == {"purpose": "text_recognition"}
    assert "file" in captured["files"]
    assert captured["timeout"] == 180.0

    # 旁挂元数据同样落盘
    assert attachments.load_meta(meta["id"])["fileId"] == "file-api-123"


def test_document_upload_skips_without_key_or_for_openai(client, monkeypatch):
    """无 Key 或 OpenAI 服务商时不上传解析，元数据 parsed 为 False。"""
    called: list[str] = []

    class FailClient:
        def __init__(self, *args, **kwargs):
            called.append("init")
            raise AssertionError("不应发起 Files API 请求")

    monkeypatch.setattr(attachments.httpx, "AsyncClient", FailClient)

    # 默认无 Key
    meta = client.post(
        "/api/attachments",
        files={"file": ("no-key.pdf", b"%PDF-1.4", "application/pdf")},
    ).json()
    assert "fileId" not in meta
    assert meta["parsed"] is False

    # OpenAI 服务商（即使有 Key）也跳过
    client.put(
        "/api/settings",
        json={"provider": "openai", "openaiApiKey": "sk-openai-key"},
    )
    openai_meta = client.post(
        "/api/attachments",
        files={"file": ("openai.docx", b"docx-bytes", "application/octet-stream")},
    ).json()
    assert "fileId" not in openai_meta
    assert openai_meta["parsed"] is False

    assert called == []


def test_document_blocks_in_message_parts_and_messages(client):
    """build_message_parts 输出文档块；build_messages 顺序为文档 → 图片 → 文本。"""
    from app.services.context import build_messages

    doc_meta = {
        "id": "a" * 32,
        "name": "root.pdf",
        "mime": "application/pdf",
        "size": 10,
        "kind": "other",
        "ext": ".pdf",
        "fileId": "file-api-root",
        "parsed": True,
        "owner_id": "",
    }
    child_meta = {
        "id": "b" * 32,
        "name": "child.pdf",
        "mime": "application/pdf",
        "size": 10,
        "kind": "other",
        "ext": ".pdf",
        "fileId": "file-api-child",
        "parsed": True,
        "owner_id": "",
    }

    child = SimpleNamespace(
        question="请总结子文档",
        prompt="",
        answer="",
        attachments=json.dumps([child_meta]),
    )
    text, images, documents = attachments.build_message_parts(child)
    assert text == ""
    assert images == []
    assert documents == [{"type": "file", "file_id": "file-api-child"}]

    root = SimpleNamespace(
        question="根问题",
        prompt="",
        answer="根回答",
        attachments=json.dumps([doc_meta]),
    )
    messages = build_messages(
        [root, child], attachments_for=attachments.build_message_parts
    )

    # 祖先节点带 fileId 时同样注入，保证多轮对话中文档仍在上下文里
    root_content = messages[1]["content"]
    assert isinstance(root_content, list)
    assert root_content[0] == {"type": "file", "file_id": "file-api-root"}
    assert root_content[-1] == {"type": "text", "text": "根问题"}

    last = messages[-1]["content"]
    assert isinstance(last, list)
    assert last[0] == {"type": "file", "file_id": "file-api-child"}
    assert last[-1] == {"type": "text", "text": "请总结子文档"}


# ---------- D. 智能搜索 ----------


SAMPLE_SOURCE = {
    "title": "示例标题",
    "url": "https://example.com/a",
    "snippet": "示例片段",
    "summary": "示例片段",
    "siteName": "示例站",
    "date": "2026-01-01T00:00:00+00:00",
}


def _fake_chunk(*, content="", title=None, tool_event=None, extra=None):
    """构造一个流式 chunk：扩展字段放在 delta.model_extra 里。"""
    model_extra = dict(extra or {})
    if title is not None:
        model_extra["title"] = title
    delta = SimpleNamespace(
        content=content, reasoning_content=None, model_extra=model_extra
    )
    choice = SimpleNamespace(delta=delta, server_tool_event=tool_event)
    return SimpleNamespace(choices=[choice])


async def _collect(iterator) -> list[tuple[str, object]]:
    """把异步生成器收集成列表。"""
    return [item async for item in iterator]


def test_stream_chat_merges_title_and_tools(monkeypatch):
    """title 与 thinking 同时进入 extra_body；工具在顶层；扩展事件可解析。"""
    captured: dict = {}

    async def fake_stream():
        yield _fake_chunk(tool_event={"type": "call_started", "call": {}})
        yield _fake_chunk(
            tool_event={
                "type": "call_completed",
                "call": {
                    "sources": [
                        {
                            "title": "来源一",
                            "url": "https://example.com/a",
                            "snippet": "片段",
                            "site_name": "站点",
                            "published_at": "2026-01-01",
                        }
                    ]
                },
            }
        )
        yield _fake_chunk(content="回答", title="会话标题")

    class FakeCompletions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return fake_stream()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(llm, "_get_client", lambda options: FakeClient())

    runtime = {
        "provider": "deepseek",
        "api_key": "sk-test",
        "thinking_enabled": True,
    }
    events = asyncio.run(
        _collect(
            llm.stream_chat(
                [{"role": "user", "content": "问题"}],
                runtime,
                enable_title=True,
                tools=[{"type": "deepseek_web_search"}],
            )
        )
    )

    # 思考与标题合并到同一个 extra_body，工具声明在顶层
    assert captured["extra_body"] == {
        "thinking": {"type": "enabled"},
        "title": {"enabled": True},
    }
    assert captured["tools"] == [{"type": "deepseek_web_search"}]
    assert "count" not in captured

    kinds = [kind for kind, _ in events]
    assert "sources" in kinds
    assert ("title", "会话标题") in events
    assert ("tool_use", "") in events
    source = next(payload for kind, payload in events if kind == "sources")[0]
    assert source["url"] == "https://example.com/a"
    assert source["summary"] == "片段"
    assert source["siteName"] == "站点"
    assert source["date"] == "2026-01-01"


def test_answer_smart_search_streams_sources_and_blocks_continue(
    client, session_factory, monkeypatch
):
    """智能搜索：请求带 tools、来源去重推送、webToolUsed 落库且禁止续写。"""
    from app.services import search as search_service

    client.put(
        "/api/settings",
        json={"apiKey": "sk-smart-key", "webSearchEnabled": True},
    )
    project = _create_root(client)
    project_id = project["project"]["id"]
    node_id = project["rootNode"]["id"]

    async def fail_search(query, runtime):
        raise AssertionError("智能搜索不应预检索")

    captured: dict = {}

    async def fake_stream_chat(messages, runtime=None, **kwargs):
        captured.update(kwargs)
        yield "sources", [dict(SAMPLE_SOURCE)]
        # 重复来源不再推送
        yield "sources", [dict(SAMPLE_SOURCE)]
        yield "delta", "基于资料的答案"
        yield "tool_use", ""

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(search_service, "search_web", fail_search)
    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    assert captured["tools"] == [{"type": "deepseek_web_search"}]
    assert [event for event, _ in events] == ["sources", "delta", "done"]
    assert events[0] == ("sources", {"sources": [SAMPLE_SOURCE]})

    # 来源与工具使用标记落库，DTO 输出 webToolUsed
    node = _load_node(session_factory, node_id)
    assert json.loads(node.sources) == [SAMPLE_SOURCE]
    assert node.web_tool_used is True

    graph = client.get(f"/api/projects/{project_id}/graph").json()
    dto = {item["id"]: item for item in graph["nodes"]}[node_id]
    assert dto["webToolUsed"] is True

    blocked = client.post(f"/api/nodes/{node_id}/continue")
    assert blocked.status_code == 400
    assert blocked.json()["detail"] == "智能搜索产生的回答不支持继续生成，请重新输入问题"
