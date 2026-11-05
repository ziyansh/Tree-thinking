"""附件测试：上传/回读、节点绑定、上下文注入与回答链路携带附件。"""

import base64
import json
from types import SimpleNamespace

from app.services import attachments, llm, suggestions

# 1×1 透明 PNG，用于验证图片附件转 data URL 内容块
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
)

TEXT_MARKER_B = "分支B的附件正文"
TEXT_MARKER_C = "分支C的附件正文"


def _upload(client, name: str, content: bytes, mime: str) -> dict:
    """调用上传接口，返回附件元数据。"""
    response = client.post(
        "/api/attachments", files={"file": (name, content, mime)}
    )
    assert response.status_code == 200
    return response.json()


def _create_project(client, name: str = "附件测试") -> dict:
    """新建画布，返回 {project, rootNode, nodes}。"""
    return client.post("/api/projects", json={"name": name}).json()


def test_upload_and_read_text_attachment(client):
    """上传文本附件后返回元数据，GET 能回读内容；不存在的 id 返回 404。"""
    meta = _upload(client, "note.txt", "你好，附件".encode("utf-8"), "text/plain")

    assert meta["name"] == "note.txt"
    assert meta["kind"] == "text"
    assert meta["ext"] == ".txt"
    assert meta["size"] > 0
    assert meta["url"] == f"/api/attachments/{meta['id']}"

    got = client.get(meta["url"])
    assert got.status_code == 200
    assert "你好，附件" in got.text

    missing = client.get("/api/attachments/" + "0" * 32)
    assert missing.status_code == 404

    # 非法 id 同样按 404 处理，不做路径拼接
    assert client.get("/api/attachments/not-an-id").status_code == 404


def test_upload_rejects_oversized_file(client):
    """超过 20MB 的上传被拒绝，且错误提示可读。"""
    too_big = b"x" * (attachments.MAX_FILE_BYTES + 1)
    response = client.post(
        "/api/attachments", files={"file": ("big.txt", too_big, "text/plain")}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "附件大小不能超过 20MB"


def test_create_node_with_attachments(client):
    """创建子节点带附件 id：DTO 有值，graph 回读一致；未知 id 返回 400。"""
    meta = _upload(client, "data.csv", b"a,b\n1,2\n", "text/csv")

    project = _create_project(client, "节点附件")
    project_id = project["project"]["id"]
    root = project["rootNode"]

    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "parentId": root["id"],
            "question": "结合附件回答问题",
            "attachments": [meta["id"]],
        },
    ).json()

    assert child["attachments"] and child["attachments"][0]["id"] == meta["id"]

    nodes = client.get(f"/api/projects/{project_id}/graph").json()["nodes"]
    graph_child = {node["id"]: node for node in nodes}[child["id"]]
    assert [item["id"] for item in graph_child["attachments"]] == [meta["id"]]

    bad = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "parentId": root["id"],
            "question": "带无效附件",
            "attachments": ["f" * 32],
        },
    )
    assert bad.status_code == 400
    assert bad.json()["detail"] == "附件不存在或已失效"


def test_build_messages_injects_text_attachment(client):
    """文本附件进入 user 消息，且兄弟分支不互串。"""
    meta_b = _upload(
        client,
        "b.txt",
        TEXT_MARKER_B.encode("utf-8"),
        "text/plain",
    )
    meta_c = _upload(
        client,
        "c.txt",
        TEXT_MARKER_C.encode("utf-8"),
        "text/plain",
    )

    from app.services.context import build_messages

    def _node(question: str, answer: str, attachments_json: str) -> SimpleNamespace:
        """构造仅含 build_messages 所需字段的朴素节点。"""
        return SimpleNamespace(
            question=question, answer=answer, attachments=attachments_json
        )

    root = _node("根问题", "根回答", "[]")
    node_b = _node("分支 B", "", json.dumps([meta_b]))
    node_c = _node("分支 C", "", json.dumps([meta_c]))

    messages = build_messages(
        [root, node_b], attachments_for=attachments.build_message_parts
    )

    last = messages[-1]["content"]
    assert isinstance(last, str)
    assert "分支 B" in last
    assert "【附件：b.txt】" in last
    assert TEXT_MARKER_B in last
    # 兄弟分支 C 的附件不会串进来
    assert TEXT_MARKER_C not in last
    assert "【附件：" not in messages[1]["content"]


def test_build_message_parts_image(client):
    """图片附件转成 image_url 内容块，URL 以 data:image/png;base64, 开头。"""
    meta = _upload(client, "pixel.png", PNG_BYTES, "image/png")
    assert meta["kind"] == "image"

    node = SimpleNamespace(attachments=json.dumps([meta]))
    text, images = attachments.build_message_parts(node)

    assert text == ""
    assert len(images) == 1
    block = images[0]
    assert block["type"] == "image_url"
    assert block["image_url"]["detail"] == "low"
    assert block["image_url"]["url"].startswith("data:image/png;base64,")


def test_answer_carries_attachment_text(client, monkeypatch):
    """回答链路把附件文本拼进最后一条 user 消息。"""
    client.put("/api/settings", json={"apiKey": "sk-attach-key"})

    meta = _upload(client, "memo.md", "附件里的关键结论".encode("utf-8"), "text/markdown")

    project = _create_project(client, "回答携带附件")
    project_id = project["project"]["id"]
    root = project["rootNode"]

    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "parentId": root["id"],
            "question": "请总结附件",
            "attachments": [meta["id"]],
        },
    ).json()

    captured: dict = {}

    async def fake_stream_chat(messages, runtime=None):
        captured["messages"] = messages
        yield "delta", "好"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{child['id']}/answer")
    assert "event: done" in response.text

    content = captured["messages"][-1]["content"]
    assert isinstance(content, str)
    assert "【附件：memo.md】" in content
    assert "附件里的关键结论" in content
