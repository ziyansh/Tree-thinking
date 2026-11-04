"""流式回答 SSE 端点测试：用假 LLM 覆盖真实请求，数据库走内存库。"""

import json

from app import config
from app.models import ConversationNode
from app.services import llm, suggestions


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
    """新建画布并写入根节点问题，返回根节点 id。"""
    project = client.post("/api/projects", json={"name": "测试画布"}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": question})
    return node_id


def _load_node(session_factory, node_id: str) -> ConversationNode:
    """直接从内存库读取节点最终状态。"""
    db = session_factory()
    try:
        return db.get(ConversationNode, node_id)
    finally:
        db.close()


def test_answer_stream_success(client, session_factory, monkeypatch):
    """假 LLM 吐 2 段思考 + 3 段回答：SSE 事件顺序正确且结果落库。"""
    node_id = _create_node_with_question(client, "请用一句话解释递归")
    # 测试环境默认无 Key，这里给个占位值以走正常的流式分支（真实客户端不会被创建）
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "test-key")

    async def fake_stream_chat(messages, runtime=None):
        # 上下文最后一条必须是当前节点的问题
        assert messages[-1]["content"] == "请用一句话解释递归"
        yield "reasoning", "先理解"
        yield "reasoning", "递归定义"
        yield "delta", "递归是"
        yield "delta", "函数调用"
        yield "delta", "自身。"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        # 回答结束后基于累积的完整回答生成
        assert node.answer == "递归是函数调用自身。"
        return [{"id": "sug00001", "text": "递归的终止条件是什么"}]

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{node_id}/answer")

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"

    events = _parse_sse(response.text)
    # 事件顺序：reasoning → delta* → suggestions → done
    assert [event for event, _ in events] == [
        "reasoning",
        "reasoning",
        "delta",
        "delta",
        "delta",
        "suggestions",
        "done",
    ]
    assert events[0][1] == {"text": "先理解"}
    assert events[5][1] == {"suggestions": [{"id": "sug00001", "text": "递归的终止条件是什么"}]}
    assert events[-1] == ("done", {"status": "done"})

    node = _load_node(session_factory, node_id)
    assert node.status == "done"
    assert node.answer == "递归是函数调用自身。"
    assert node.reasoning == "先理解递归定义"
    assert node.error is None
    assert json.loads(node.suggestions) == [
        {"id": "sug00001", "text": "递归的终止条件是什么"}
    ]


def test_answer_without_api_key(client, session_factory, monkeypatch):
    """未配置 Key：仍返回 200 + SSE，收到 error 事件且节点置为错误态。"""
    node_id = _create_node_with_question(client, "没有 API Key 时会怎样？")
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")

    response = client.post(f"/api/nodes/{node_id}/answer")

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

    events = _parse_sse(response.text)
    assert len(events) == 1
    event, data = events[0]
    assert event == "error"
    assert "未配置 API Key" in data["message"]

    node = _load_node(session_factory, node_id)
    assert node.status == "error"
    assert node.error == data["message"]
