"""搜索接口测试：画布内 / 全局范围、片段与画布名命中。"""

from app.models import ConversationNode


def _add_node(session_factory, project_id: str, question: str, answer: str) -> str:
    """直接写库插入一个已完成节点，避免依赖模型调用。"""
    with session_factory() as db:
        node = ConversationNode(
            project_id=project_id,
            parent_id=None,
            question=question,
            answer=answer,
            status="done",
            x=0,
            y=0,
        )
        db.add(node)
        db.commit()
        db.refresh(node)
        return node.id


def test_search_scoped_to_project(client, session_factory):
    """带 project_id 时只返回该画布的命中，不带时搜索全部画布。"""
    first = client.post("/api/projects", json={"name": "甲画布"}).json()
    second = client.post("/api/projects", json={"name": "乙画布"}).json()
    first_id = first["project"]["id"]
    second_id = second["project"]["id"]
    node_id = _add_node(session_factory, first_id, "标题", "关于量子纠缠的讨论")

    scoped = client.get("/api/search", params={"q": "量子纠缠", "project_id": first_id}).json()
    assert scoped["query"] == "量子纠缠"
    assert scoped["truncated"] is False
    assert [item["nodeId"] for item in scoped["items"]] == [node_id]
    assert scoped["items"][0]["field"] == "answer"
    assert scoped["items"][0]["nodeType"] == "chat"

    other = client.get("/api/search", params={"q": "量子纠缠", "project_id": second_id}).json()
    assert other["items"] == []

    everywhere = client.get("/api/search", params={"q": "量子纠缠"}).json()
    assert [item["nodeId"] for item in everywhere["items"]] == [node_id]


def test_search_matches_title_and_project_name(client, session_factory):
    """卡片标题与画布名称同样可以命中，画布名命中的结果没有 nodeId。"""
    project = client.post("/api/projects", json={"name": "材料整理"}).json()
    project_id = project["project"]["id"]
    node_id = _add_node(session_factory, project_id, "材料清单", "正文")

    by_title = client.get("/api/search", params={"q": "材料清单"}).json()["items"]
    assert [item["nodeId"] for item in by_title] == [node_id]
    assert by_title[0]["field"] == "title"

    by_project = client.get("/api/search", params={"q": "材料整理"}).json()["items"]
    assert by_project[0]["nodeId"] is None
    assert by_project[0]["field"] == "project"
    assert by_project[0]["projectName"] == "材料整理"


def test_search_snippet_and_empty_query(client, session_factory):
    """长文本返回带省略号的片段；空关键词返回空结果。"""
    project = client.post("/api/projects", json={"name": "片段"}).json()
    project_id = project["project"]["id"]
    answer = "开头" + "填充" * 40 + "关键目标" + "收尾" * 40
    _add_node(session_factory, project_id, "", answer)

    items = client.get("/api/search", params={"q": "关键目标"}).json()["items"]
    assert len(items) == 1
    snippet = items[0]["snippet"]
    assert "关键目标" in snippet
    assert snippet.startswith("…") and snippet.endswith("…")
    assert "\n" not in snippet

    empty = client.get("/api/search", params={"q": "   "}).json()
    assert empty["items"] == []
