"""v0.3.7 链接识别测试：链接提取、编号提示词与智能搜索的 tools 切换。"""

from app.services import llm, suggestions
from app.services import search as search_service
from app.services.urls import build_url_prompt, extract_urls

SAMPLE_SOURCE = {
    "title": "示例标题",
    "url": "https://example.com/source",
    "snippet": "示例片段",
    "siteName": "示例站",
    "date": "2026-01-01",
}


# ---------- A. 链接提取 ----------


def test_extract_http_and_https():
    """带协议的链接按出现顺序保留，尾部英文标点被去掉。"""
    text = "参考 https://example.com/a?b=1，还有 http://example.org/b, 以及 https://example.net/c."
    assert extract_urls(text) == [
        "https://example.com/a?b=1",
        "http://example.org/b",
        "https://example.net/c",
    ]


def test_extract_bare_domains():
    """无协议的裸域名（常见 TLD）也能识别。"""
    text = "去 github.com/owner/repo 或 www.example.com/page 看看"
    assert extract_urls(text) == ["github.com/owner/repo", "www.example.com/page"]


def test_extract_strips_chinese_punctuation():
    """中文标点与全角括号不会被吞进链接。"""
    text = "链接是https://example.com/a。另见（https://example.com/b），还有 github.com/x/y！"
    assert extract_urls(text) == [
        "https://example.com/a",
        "https://example.com/b",
        "github.com/x/y",
    ]


def test_extract_deduplicates_keeping_first_order():
    """重复链接只保留第一次出现的那个。"""
    text = "https://example.com/a，又见 https://example.com/a。最后 https://example.com/b"
    assert extract_urls(text) == ["https://example.com/a", "https://example.com/b"]


def test_extract_truncates_to_limit():
    """超过 10 个链接时只取前 10 个。"""
    text = " ".join(f"https://example.com/{i}" for i in range(12))
    urls = extract_urls(text)
    assert len(urls) == 10
    assert urls[0] == "https://example.com/0"
    assert urls[-1] == "https://example.com/9"


def test_extract_ignores_plain_text():
    """普通文字、版本号、小数与非 TLD 的域名不误判为链接。"""
    text = "版本 1.2.3 已发布，价格 3.5 元，文件 report.final.v2，邮箱 a@b.com 不是链接。"
    assert extract_urls(text) == []
    assert extract_urls("") == []


# ---------- B. 编号提示词 ----------


def test_build_url_prompt_lists_numbered_links():
    """提示词包含「链接1」及对应 URL，并说明与正文角标编号是两套编号。"""
    prompt = build_url_prompt(["https://a.com/1", "github.com/b"])
    assert "链接1 是 https://a.com/1" in prompt
    assert "链接2 是 github.com/b" in prompt
    assert "不要混淆或编造" in prompt
    assert "[n]" in prompt
    assert "两套编号" in prompt


# ---------- C. answer_node 的 tools 切换 ----------


def _create_node_with_question(client, question: str) -> str:
    """新建画布并写入根节点问题，返回根节点 id。"""
    project = client.post("/api/projects", json={"name": "链接测试"}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": question})
    return node_id


def _patch_llm(monkeypatch) -> dict:
    """替换流式回答与候选方向，记录本次请求的 messages 与 tools。"""
    captured: dict = {}

    async def fake_stream_chat(messages, runtime=None, **kwargs):
        captured["messages"] = messages
        captured["tools"] = kwargs.get("tools")
        yield "delta", "ok"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)
    return captured


def test_smart_search_with_url_declares_read_url(client, monkeypatch):
    """智能搜索遇到链接：只声明 deepseek_read_url，并注入链接编号映射。"""
    client.put(
        "/api/settings",
        json={"apiKey": "sk-url-key", "webSearchEnabled": True, "webSearchMode": "smart"},
    )
    url = "https://github.com/owner/repo"
    node_id = _create_node_with_question(client, f"帮我总结 {url} 这个项目")
    captured = _patch_llm(monkeypatch)

    response = client.post(f"/api/nodes/{node_id}/answer")
    assert response.status_code == 200

    assert captured["tools"] == [{"type": "deepseek_read_url"}]
    messages = captured["messages"]
    # 原用户消息保留在最后，链接映射插在它之前
    assert messages[-1] == {"role": "user", "content": f"帮我总结 {url} 这个项目"}
    assert messages[-2]["role"] == "system"
    assert "链接1 是 https://github.com/owner/repo" in messages[-2]["content"]


def test_smart_search_without_url_keeps_web_search(client, monkeypatch):
    """智能搜索但没有链接：仍声明 deepseek_web_search，不注入链接映射。"""
    client.put(
        "/api/settings",
        json={"apiKey": "sk-url-key", "webSearchEnabled": True, "webSearchMode": "smart"},
    )
    node_id = _create_node_with_question(client, "2026 年 AI 有哪些新进展")
    captured = _patch_llm(monkeypatch)

    client.post(f"/api/nodes/{node_id}/answer")

    assert captured["tools"] == [{"type": "deepseek_web_search"}]
    assert all("链接1" not in str(item.get("content", "")) for item in captured["messages"])


def test_forced_search_with_url_is_unaffected(client, monkeypatch):
    """强制搜索不受链接影响：不声明读取链接工具，只走预检索来源注入。"""
    client.put(
        "/api/settings",
        json={"apiKey": "sk-url-key", "webSearchEnabled": True, "webSearchMode": "forced"},
    )
    node_id = _create_node_with_question(client, "看看 https://github.com/owner/repo 有什么")
    captured = _patch_llm(monkeypatch)

    async def fake_search(query, runtime):
        return [dict(SAMPLE_SOURCE)]

    monkeypatch.setattr(search_service, "search_web", fake_search)

    client.post(f"/api/nodes/{node_id}/answer")

    assert captured["tools"] is None
    messages = captured["messages"]
    # 倒数第二条是来源系统消息，而不是链接映射
    assert messages[-2]["role"] == "system"
    assert SAMPLE_SOURCE["url"] in messages[-2]["content"]
    assert all("链接1" not in str(item.get("content", "")) for item in messages)
