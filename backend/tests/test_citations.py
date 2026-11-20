"""引用角标标准化测试：智能搜索的 annotations 转正文 [n]。"""

import json

from app.models import ConversationNode
from app.services import llm, suggestions


def _citation(url: str, title: str, start: int, end: int) -> dict:
    """构造一条 url_citation 注解。"""
    return {
        "type": "url_citation",
        "url_citation": {
            "url": url,
            "title": title,
            "start_index": start,
            "end_index": end,
        },
    }


def _source(url: str) -> dict:
    """构造一条前端结构的来源。"""
    return {
        "title": "已有标题",
        "url": url,
        "snippet": "片段",
        "summary": "摘要",
        "siteName": "站点",
        "date": "2026-01-01",
    }


def test_apply_citations_chinese_counts_code_points():
    """中文按 Unicode 码点计数：end_index=4 即「人工智能」之后。"""
    from app.services.citations import apply_citations

    answer, sources = apply_citations(
        "人工智能很强大",
        [_citation("https://example.com/a", "标题", 0, 4)],
        [_source("https://example.com/a")],
    )

    assert answer == "人工智能[1]很强大"
    assert len(sources) == 1


def test_apply_citations_inserts_multiple_from_back():
    """多个引用按位置从后往前插入，序号与 sources 下标一致。"""
    from app.services.citations import apply_citations

    sources = [_source("https://example.com/a"), _source("https://example.com/b")]
    answer, result = apply_citations(
        "苹果和香蕉",
        [
            _citation("https://example.com/a", "苹果", 0, 2),
            _citation("https://example.com/b", "香蕉", 3, 5),
        ],
        sources,
    )

    assert answer == "苹果[1]和香蕉[2]"
    assert result == sources


def test_apply_citations_appends_unknown_url():
    """URL 不在 sources 中时追加来源，序号取追加后的位置。"""
    from app.services.citations import apply_citations

    sources = [_source("https://example.com/a")]
    answer, result = apply_citations(
        "测试内容",
        [_citation("https://example.com/b", "新标题", 0, 4)],
        sources,
    )

    assert answer == "测试内容[2]"
    assert len(result) == 2
    assert result[1] == {
        "title": "新标题",
        "url": "https://example.com/b",
        "snippet": "",
        "summary": "",
        "siteName": "",
        "date": "",
    }


def test_apply_citations_skips_when_model_already_wrote_marker():
    """模型已写 [1] 时不重复插入，也不新增来源。"""
    from app.services.citations import apply_citations

    sources = [_source("https://example.com/a")]
    answer, result = apply_citations(
        "结论[1]",
        [_citation("https://example.com/new", "标题", 0, 5)],
        sources,
    )

    assert answer == "结论[1]"
    assert result == sources


def test_apply_citations_skips_invalid_or_out_of_range_index():
    """非法或越界索引直接跳过，不抛异常、不改正文。"""
    from app.services.citations import apply_citations

    sources = [_source("https://example.com/a")]
    answer, result = apply_citations(
        "正文",
        [
            _citation("https://example.com/a", "标题", 999, 1000),
            _citation("https://example.com/a", "标题", 0, -1),
            "not-a-dict",
        ],
        sources,
    )

    assert answer == "正文"
    assert result == sources


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
    project = client.post("/api/projects", json={"name": "引用测试"}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": question})
    return node_id


def test_smart_search_persists_citation_marks(client, session_factory, monkeypatch):
    """智能搜索：流式文本落库前转成 [n]，done 事件带最终正文，sources 落库。"""
    url = "https://example.com/smart"
    node_id = _create_node_with_question(client, "智能搜索如何引用来源")

    async def fake_stream_chat(messages, runtime=None, **extra):
        assert extra.get("tools") == [{"type": "deepseek_web_search"}]
        yield "delta", "人工智能"
        yield "delta", "很强大"
        yield "annotations", [_citation(url, "智能搜索", 0, 4)]
        yield "tool_use", ""

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    client.put(
        "/api/settings",
        json={
            "apiKey": "sk-smart-key",
            "webSearchEnabled": True,
            "webSearchMode": "smart",
        },
    )

    response = client.post(f"/api/nodes/{node_id}/answer")
    events = _parse_sse(response.text)

    assert events[-1] == ("done", {"status": "done", "answer": "人工智能[1]很强大"})

    db = session_factory()
    try:
        node = db.get(ConversationNode, node_id)
        assert node.answer == "人工智能[1]很强大"
        assert node.status == "done"
        assert node.web_tool_used is True
        stored_sources = json.loads(node.sources)
        assert stored_sources[0]["url"] == url
        assert stored_sources[0]["title"] == "智能搜索"
    finally:
        db.close()
