"""火山方舟（ark）服务商适配测试：设置、请求参数、联网来源解析与回答流程。"""

import asyncio
import json

import pytest

from app.models import AppSetting, ConversationNode
from app.services import llm, settings as settings_service


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


def _create_node_with_question(client, question: str) -> str:
    """新建默认名画布并写入根节点问题，返回根节点 id。"""
    project = client.post("/api/projects", json={}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": question})
    return node_id


def test_ark_settings_defaults(client):
    """ark 默认未配置 Key，地址与模型使用火山方舟默认值。"""
    data = client.get("/api/settings").json()
    assert data["arkHasKey"] is False
    assert data["arkApiKeyMasked"] == ""
    assert data["arkBaseUrl"] == "https://ark.cn-beijing.volces.com/api/v3"
    assert data["arkModel"] == "doubao-seed-2-1-pro-260915"


def test_ark_key_encrypted_and_masked(client, session_factory):
    """保存 ark Key 后只返回脱敏值，数据库中为密文。"""
    key = "ark-test-1234567890"
    response = client.put(
        "/api/settings",
        json={
            "arkApiKey": key,
            "arkBaseUrl": "https://ark.example.com/api/v3",
            "arkModel": "doubao-test",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["arkHasKey"] is True
    assert data["arkApiKeyMasked"] == "ark••••7890"
    assert key not in response.text
    assert data["arkBaseUrl"] == "https://ark.example.com/api/v3"
    assert data["arkModel"] == "doubao-test"

    db = session_factory()
    try:
        row = db.get(AppSetting, 1)
        assert row.ark_api_key.startswith("enc:")
        assert key not in row.ark_api_key
    finally:
        db.close()


def test_ark_provider_resolves_ark_values(client, session_factory):
    """provider=ark 时生效的 Key / 地址 / 模型取 ark 配置，原 DeepSeek 配置保留。"""
    client.put(
        "/api/settings",
        json={
            "provider": "ark",
            "apiKey": "sk-ds-12345678",
            "arkApiKey": "ark-runtime-key",
            "arkBaseUrl": "https://ark.example.com/api/v3",
            "arkModel": "doubao-test",
        },
    )

    db = session_factory()
    try:
        runtime = settings_service.effective(db)
    finally:
        db.close()

    assert runtime["provider"] == "ark"
    assert runtime["api_key"] == "ark-runtime-key"
    assert runtime["base_url"] == "https://ark.example.com/api/v3"
    assert runtime["model"] == "doubao-test"
    assert runtime["deepseek_api_key"] == "sk-ds-12345678"


def test_ark_base_url_validation(client):
    """ark Base URL 必须是 http/https，非法协议返回 422。"""
    bad = client.put("/api/settings", json={"arkBaseUrl": "ftp://example.com"})
    assert bad.status_code == 422


def test_ark_chat_request_params():
    """ark 基础对话用 extra_body 透传 thinking，不发送 DeepSeek 专有参数。"""
    enabled = llm._resolve({"provider": "ark", "api_key": "ark-test"})
    assert llm._request_params(enabled) == {
        "extra_body": {"thinking": {"type": "enabled"}}
    }

    disabled = llm._resolve(
        {"provider": "ark", "api_key": "ark-test", "thinking_enabled": False}
    )
    assert llm._request_params(disabled) == {
        "extra_body": {"thinking": {"type": "disabled"}}
    }


def _fake_ark_client(captured: dict, lines: list[str], status: int = 200):
    """构造假的 httpx.AsyncClient：记录请求并逐行返回 SSE 文本。"""

    class FakeResponse:
        status_code = status

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aread(self):
            return b"bad request"

        async def aiter_lines(self):
            for line in lines:
                yield line

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, json=None, headers=None):
            captured["url"] = url
            captured["payload"] = json
            captured["headers"] = headers
            return FakeResponse()

    return FakeClient


def _collect(messages: list[dict], runtime: dict) -> list[tuple[str, object]]:
    """收集 stream_chat 的全部事件。"""

    async def _run():
        return [item async for item in llm.stream_chat(messages, runtime, web_search=True)]

    return asyncio.run(_run())


def test_ark_responses_sse_parsing(monkeypatch):
    """联网搜索走 Responses API：解析思考、正文、引用与来源。"""
    captured: dict = {}
    lines = [
        "event: response.reasoning_text.delta",
        'data: {"type":"response.reasoning_text.delta","delta":"先想"}',
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta","delta":"答案"}',
        "event: response.output_text.annotation.added",
        'data: {"type":"response.output_text.annotation.added","annotation":'
        '{"type":"url_citation","url":"https://example.com/a","title":"标题A",'
        '"site_name":"站点A","summary":"摘要A","publish_time":"2026-02-02"}}',
        "event: response.web_search_call.completed",
        'data: {"type":"response.web_search_call.completed","results":'
        '[{"url":"https://example.com/b","title":"标题B","snippet":"片段B",'
        '"site_name":"站点B"}]}',
        "event: response.completed",
        'data: {"type":"response.completed","response":{"status":"completed"}}',
        'data: {"type":"response.output_text.delta","delta":"不会出现"}',
    ]
    monkeypatch.setattr(
        llm.httpx, "AsyncClient", _fake_ark_client(captured, lines)
    )

    runtime = {
        "provider": "ark",
        "api_key": "ark-test",
        "base_url": "https://ark.example.com/api/v3",
        "model": "doubao-test",
        "thinking_enabled": True,
    }
    messages = [
        {"role": "system", "content": "系统提示"},
        {"role": "user", "content": "问题"},
    ]
    events = _collect(messages, runtime)

    assert events[0] == ("reasoning", "先想")
    assert events[1] == ("delta", "答案")
    source_a = events[2][1][0]
    assert events[2][0] == "sources"
    assert source_a["url"] == "https://example.com/a"
    assert source_a["siteName"] == "站点A"
    assert source_a["summary"] == "摘要A"
    assert source_a["date"] == "2026-02-02"
    source_b = events[3][1][0]
    assert source_b["url"] == "https://example.com/b"
    assert source_b["siteName"] == "站点B"
    # response.completed 后停止，不再输出后续 delta
    assert all(item != ("delta", "不会出现") for item in events)

    # 请求参数：生成文本 + 联网搜索工具 + thinking 开关
    assert captured["url"] == "https://ark.example.com/api/v3/responses"
    payload = captured["payload"]
    assert payload["tools"] == [{"type": "web_search", "sources": ["doubao"]}]
    assert payload["thinking"] == {"type": "enabled"}
    assert payload["instructions"] == "系统提示"
    assert payload["input"] == [
        {"role": "user", "content": [{"type": "input_text", "text": "问题"}]}
    ]
    assert captured["headers"]["Authorization"] == "Bearer ark-test"


def test_ark_responses_error_event(monkeypatch):
    """response.failed 事件转成 LLMError，携带服务端错误信息。"""
    captured: dict = {}
    lines = [
        "event: response.failed",
        'data: {"type":"response.failed","error":{"message":"余额不足"}}',
    ]
    monkeypatch.setattr(
        llm.httpx, "AsyncClient", _fake_ark_client(captured, lines)
    )

    runtime = {
        "provider": "ark",
        "api_key": "ark-test",
        "base_url": "https://ark.example.com/api/v3",
        "model": "doubao-test",
        "thinking_enabled": False,
    }
    with pytest.raises(llm.LLMError) as excinfo:
        _collect([{"role": "user", "content": "问题"}], runtime)

    assert "余额不足" in str(excinfo.value)
    assert captured["payload"]["thinking"] == {"type": "disabled"}


def test_ark_forced_search_treated_as_smart(client, session_factory, monkeypatch):
    """ark + forced：不预检索、不传 DeepSeek 工具，联网由 llm 内部处理。"""
    from app.services import search as search_service
    from app.services import suggestions

    source = {
        "title": "标题",
        "url": "https://example.com/ark",
        "snippet": "片段",
        "summary": "摘要",
        "siteName": "站点",
        "date": None,
    }
    searched: list[str] = []
    captured: dict = {}

    async def fake_search(query, runtime):
        searched.append(query)
        return [dict(source)]

    async def fake_stream_chat(messages, runtime=None, **kwargs):
        captured["kwargs"] = kwargs
        captured["runtime"] = runtime
        yield "delta", "回答"
        yield "sources", [source]

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(search_service, "search_web", fake_search)
    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    client.put(
        "/api/settings",
        json={
            "provider": "ark",
            "arkApiKey": "ark-test-key",
            "webSearchEnabled": True,
            "webSearchMode": "forced",
        },
    )
    node_id = _create_node_with_question(client, "火山方舟如何联网")

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    # 不调用 DeepSeek 预检索，联网开关以 web_search 传入 llm
    assert searched == []
    assert captured["kwargs"].get("web_search") is True
    # ark 不声明 DeepSeek 工具，也不开启会话标题
    assert "tools" not in captured["kwargs"]
    assert "enable_title" not in captured["kwargs"]
    assert captured["runtime"]["provider"] == "ark"

    # 来源照常推送并落库；done 只带 status，不带带角标的正文
    assert [event for event, _ in events] == ["delta", "sources", "done"]
    assert events[-1] == ("done", {"status": "done"})

    db = session_factory()
    try:
        node = db.get(ConversationNode, node_id)
        assert json.loads(node.sources) == [source]
        assert node.answer == "回答"
        assert node.status == "done"
    finally:
        db.close()
