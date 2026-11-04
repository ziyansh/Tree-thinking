"""候选方向测试：解析容错、数量补齐/截断，以及重新生成时保留已用建议。"""

import asyncio
import json
from types import SimpleNamespace

from app import config
from app.models import ConversationNode
from app.services import llm, suggestions
from app.services.suggestions import generate_suggestions, parse_suggestions


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


def test_parse_valid_json():
    """标准 {"suggestions":[...]} 与顶层数组都能解析出文本列表。"""
    raw = '{"suggestions":[{"text":"方向一"},{"text":"方向二"}]}'
    assert parse_suggestions(raw) == ["方向一", "方向二"]
    assert parse_suggestions('[{"text":"A"},{"text":"B"}]') == ["A", "B"]
    # 兼容字符串项
    assert parse_suggestions('{"suggestions":["A","B"]}') == ["A", "B"]


def test_parse_empty_content():
    """空 content（JSON Output 可能被替换成空格）返回空列表。"""
    assert parse_suggestions("") == []
    assert parse_suggestions("   \n  ") == []


def test_parse_invalid_json():
    """非法 JSON 降级为按行切分，并去掉列表序号/项目符号。"""
    raw = "1. 方向一\n- 方向二\n\n方向三"
    assert parse_suggestions(raw) == ["方向一", "方向二", "方向三"]


def test_parse_plain_lines():
    """纯文本逐行输出，空行被忽略且每条截断到 20 字。"""
    long_text = "这是一个超过二十个字符的候选方向文本用于验证截断行为"
    raw = f"{long_text}\n\n第二个方向"
    parsed = parse_suggestions(raw)

    assert len(parsed) == 2
    assert parsed[0] == long_text[:20]
    assert parsed[1] == "第二个方向"


def test_generate_fills_and_truncates(monkeypatch):
    """模型返回超长且重复的项：截断到 20 字、去重并补齐到 count。"""
    long_text = "这是一个非常长的候选方向文本超过了二十个字符需要被截断"

    async def fake_complete_json(messages, max_tokens=400, runtime=None):
        # prompt 中必须出现 json 字样（JSON Output 的硬性要求）
        assert "json" in messages[0]["content"].lower()
        return json.dumps(
            {
                "suggestions": [
                    {"text": long_text},
                    {"text": long_text},
                    {"text": "  第二个方向  "},
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(llm, "complete_json", fake_complete_json)
    node = SimpleNamespace(question="当前问题", answer="当前回答")

    result = asyncio.run(generate_suggestions(node, count=4))

    assert len(result) == 4
    assert result[0]["text"] == long_text[:20]
    assert result[1]["text"] == "第二个方向"
    # 去重后仅 2 条来自模型，其余用兜底方向补齐
    texts = [item["text"] for item in result]
    assert len(set(texts)) == len(texts)
    assert all(len(text) <= 20 for text in texts)
    assert all("id" in item and item["id"] for item in result)
    assert len({item["id"] for item in result}) == len(result)


def test_generate_falls_back_on_error(monkeypatch):
    """模型调用失败不抛异常，返回配置数量的兜底方向。"""
    async def boom(messages, max_tokens=400, runtime=None):
        raise llm.LLMError("请求失败")

    monkeypatch.setattr(llm, "complete_json", boom)
    monkeypatch.setattr(config, "SUGGESTION_COUNT", 3)
    node = SimpleNamespace(question="Q", answer="A")

    result = asyncio.run(generate_suggestions(node))

    assert len(result) == 3
    assert [item["text"] for item in result] == suggestions.FALLBACK_TEXTS[:3]


def test_regenerate_keeps_used(client, session_factory, monkeypatch):
    """重新生成时，已被子卡片使用的建议仍保留在前，其余被替换。"""
    project = client.post("/api/projects", json={"name": "建议测试"}).json()
    root_id = project["rootNode"]["id"]

    # 直接置库：根节点已完成回答，并带有 3 条建议，其中第 2 条已被使用
    used = {"id": "used0001", "text": "已使用的方向"}
    db = session_factory()
    try:
        node = db.get(ConversationNode, root_id)
        node.question = "根问题"
        node.answer = "根回答"
        node.status = "done"
        node.suggestions = json.dumps(
            [{"id": "old0001", "text": "未用方向一"}, used, {"id": "old0002", "text": "未用方向二"}],
            ensure_ascii=False,
        )
        db.commit()
    finally:
        db.close()

    # 点选该建议创建子卡片，使父节点的建议变为「已使用」
    client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={
            "parentId": root_id,
            "question": used["text"],
            "origin": "suggestion",
            "suggestionId": used["id"],
        },
    )

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        # 调用方应把已用建议的文本传进来，用于去重
        assert used_texts == [used["text"]]
        return [{"id": f"new{i:04d}", "text": f"新方向{i}"} for i in range(count or 3)]

    monkeypatch.setattr(
        "app.api.nodes.suggestions.generate_suggestions", fake_generate
    )

    response = client.post(f"/api/nodes/{root_id}/suggestions", json={"count": 2})

    assert response.status_code == 200
    items = response.json()
    assert items[0] == used
    assert len(items) == 3
    assert {item["id"] for item in items[1:]} == {"new0000", "new0001"}
    assert "old0001" not in {item["id"] for item in items}

    # 完整数组已落库
    db = session_factory()
    try:
        stored = json.loads(db.get(ConversationNode, root_id).suggestions)
    finally:
        db.close()
    assert stored == items


def test_answer_stream_emits_suggestions(client, monkeypatch):
    """流式回答成功路径：suggestions 事件在 done 之前，且带完整建议数组。"""
    project = client.post("/api/projects", json={"name": "流式建议"}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": "请解释闭包"})
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "test-key")

    async def fake_stream_chat(messages, runtime=None):
        assert messages[-1]["content"] == "请解释闭包"
        yield "delta", "闭包"
        yield "delta", "是函数。"

    generated: list[dict] = [
        {"id": "sug00001", "text": "闭包有哪些使用场景"},
        {"id": "sug00002", "text": "闭包会泄漏内存吗"},
    ]

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        # 应基于已累积的完整回答生成
        assert node.answer == "闭包是函数。"
        return generated

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(
        "app.api.nodes.suggestions.generate_suggestions", fake_generate
    )

    response = client.post(f"/api/nodes/{node_id}/answer")

    events = _parse_sse(response.text)
    assert [event for event, _ in events] == ["delta", "delta", "suggestions", "done"]
    assert events[2][1] == {"suggestions": generated}
    assert events[3] == ("done", {"status": "done"})
