"""联网搜索测试：设置开关、来源注入 SSE 与落库、异常降级、服务商限制。"""

import json

from app.models import ConversationNode


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


def _create_node_with_question(client, question: str) -> tuple[str, str]:
    """新建画布并写入根节点问题，返回（画布 id, 节点 id）。"""
    project = client.post("/api/projects", json={"name": "搜索测试"}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": question})
    return project["project"]["id"], node_id


def _graph_node(client, project_id: str, node_id: str) -> dict:
    """从画布图数据里取出指定节点 DTO。"""
    nodes = client.get(f"/api/projects/{project_id}/graph").json()["nodes"]
    return {node["id"]: node for node in nodes}[node_id]


SAMPLE_SOURCE = {
    "title": "示例标题",
    "url": "https://example.com/a",
    "snippet": "示例片段",
    "summary": "示例摘要",
    "siteName": "示例站",
    "date": "2026-01-01",
}


def test_web_search_setting_default_and_toggle(client):
    """联网搜索默认关闭；PUT true 后读取为 true。"""
    data = client.get("/api/settings").json()
    assert data["webSearchEnabled"] is False

    updated = client.put("/api/settings", json={"webSearchEnabled": True}).json()
    assert updated["webSearchEnabled"] is True
    assert client.get("/api/settings").json()["webSearchEnabled"] is True


def test_answer_with_web_search(client, session_factory, monkeypatch):
    """开启搜索：SSE 先推 sources，来源注入系统消息并落库到节点。"""
    from app.services import search as search_service
    from app.services import llm, suggestions

    client.put(
        "/api/settings",
        json={"apiKey": "sk-search-key", "webSearchEnabled": True},
    )
    project_id, node_id = _create_node_with_question(client, "2026 年 AI 有哪些新进展")

    captured: dict = {}

    async def fake_search(query, runtime):
        return [dict(SAMPLE_SOURCE)]

    async def fake_stream_chat(messages, runtime=None):
        captured["messages"] = messages
        yield "delta", "ok"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(search_service, "search_web", fake_search)
    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    assert [event for event, _ in events] == ["sources", "delta", "done"]
    assert events[0] == ("sources", {"sources": [SAMPLE_SOURCE]})

    # 系统消息插到最后一条 user 消息之前，内容含来源链接
    messages = captured["messages"]
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"] == "2026 年 AI 有哪些新进展"
    assert messages[-2]["role"] == "system"
    assert SAMPLE_SOURCE["url"] in messages[-2]["content"]
    assert "示例标题" in messages[-2]["content"]

    # 节点 DTO 回读时 sources 已落库
    node_dto = _graph_node(client, project_id, node_id)
    assert node_dto["sources"] == [SAMPLE_SOURCE]


def test_answer_search_failure_keeps_flow(client, session_factory, monkeypatch):
    """搜索抛异常或返回空：回答仍 done，sources 为空。"""
    from app.services import search as search_service
    from app.services import llm, suggestions

    async def fake_stream_chat(messages, runtime=None):
        yield "delta", "ok"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)
    monkeypatch.setattr(search_service, "search_web", lambda query, runtime: _boom())

    client.put(
        "/api/settings",
        json={"apiKey": "sk-search-key", "webSearchEnabled": True},
    )
    _, node_id = _create_node_with_question(client, "搜索失败时回答")

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    assert events[-1] == ("done", {"status": "done"})
    assert all(event != "sources" for event, _ in events)

    db = session_factory()
    try:
        node = db.get(ConversationNode, node_id)
        assert json.loads(node.sources) == []
    finally:
        db.close()


async def _boom():
    """模拟搜索内部异常（用于替换 search_web）。"""
    raise RuntimeError("搜索服务不可用")


def test_answer_skips_search_for_other_provider(client, monkeypatch):
    """非 DeepSeek 服务商时即使开启开关也不调用搜索。"""
    from app.services import search as search_service
    from app.services import llm, suggestions

    called: list[str] = []

    async def fake_search(query, runtime):
        called.append(query)
        return [dict(SAMPLE_SOURCE)]

    async def fake_stream_chat(messages, runtime=None):
        yield "delta", "ok"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(search_service, "search_web", fake_search)
    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    client.put(
        "/api/settings",
        json={
            "provider": "openai",
            "openaiApiKey": "sk-openai-key",
            "webSearchEnabled": True,
        },
    )
    _, node_id = _create_node_with_question(client, "OpenAI 服务商下是否搜索")

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    assert called == []
    assert events[-1] == ("done", {"status": "done"})
    assert all(event != "sources" for event, _ in events)
