"""布局与分支测试：平级坐标、候选方向单选状态、新增空分支卡片。"""

import json

from app.models import ConversationNode


def _create_project(client, name: str = "布局测试") -> dict:
    """新建画布，返回 {project, rootNode, nodes}。"""
    return client.post("/api/projects", json={"name": name}).json()


def _mark_done(session_factory, node_id: str, suggestion_items: list[dict] | None = None) -> None:
    """直接把节点置为「已完成回答」，可选写入候选方向。"""
    db = session_factory()
    try:
        node = db.get(ConversationNode, node_id)
        node.question = "已完成的问题"
        node.answer = "已完成的回答"
        node.status = "done"
        if suggestion_items is not None:
            node.suggestions = json.dumps(suggestion_items, ensure_ascii=False)
        db.commit()
    finally:
        db.close()


def _graph_nodes(client, project_id: str) -> dict[str, dict]:
    """取画布全量节点并转成 {id: node}，便于按 id 断言。"""
    nodes = client.get(f"/api/projects/{project_id}/graph").json()["nodes"]
    return {node["id"]: node for node in nodes}


def _create_child(client, project_id: str, parent_id: str, question: str, **extra) -> dict:
    """在指定父节点下创建子节点（默认 origin=user）。"""
    payload = {"parentId": parent_id, "question": question, **extra}
    return client.post(f"/api/projects/{project_id}/nodes", json=payload).json()


def test_first_child_aligns_with_parent(client):
    """首个子节点为主干：父卡片正右方、同一 y，间距取默认 80。"""
    project = _create_project(client)
    project_id = project["project"]["id"]
    root = project["rootNode"]

    child = _create_child(client, project_id, root["id"], "继续追问")

    assert child["y"] == root["y"]
    assert child["x"] == root["x"] + 400 + 80


def test_second_child_is_branch_head_in_direct_mode(client):
    """直接分支模式下，第二个子节点落在父卡片同列下方，纵向间距为卡片高 + 80。"""
    project = _create_project(client)
    project_id = project["project"]["id"]
    root = project["rootNode"]

    first = _create_child(client, project_id, root["id"], "第一个分支")
    second = _create_child(client, project_id, root["id"], "第二个分支", origin="user")

    assert first["y"] == root["y"]
    assert second["y"] == root["y"] + (560 + 80)
    assert second["x"] == root["x"]
    assert first["x"] == root["x"] + 400 + 80


def test_second_child_shares_column_in_bus_mode(client):
    """共用母线模式下，分支头位于父卡片右侧下一列，与主干子卡片同列。"""
    project = _create_project(client)
    project_id = project["project"]["id"]
    root = project["rootNode"]
    client.put("/api/settings", json={"connectionStyle": "bus"})

    first = _create_child(client, project_id, root["id"], "主干")
    second = _create_child(client, project_id, root["id"], "分支头")

    assert first["x"] == root["x"] + 400 + 80
    assert second["x"] == first["x"]
    assert second["y"] == root["y"] + (560 + 80)


def test_custom_child_consumes_parent_suggestions(client, session_factory):
    """自定义输入/底部追问创建子卡片后，父卡片这一轮候选方向也应隐藏。"""
    project = _create_project(client, "自定义输入")
    project_id = project["project"]["id"]
    root = project["rootNode"]
    _mark_done(session_factory, root["id"], [{"id": "sug00001", "text": "方向一"}])

    child = _create_child(client, project_id, root["id"], "自定义问题", origin="user")

    assert _graph_nodes(client, project_id)[root["id"]]["suggestionsConsumed"] is True
    assert _graph_nodes(client, project_id)[child["id"]]["suggestionsConsumed"] is False


def test_suggestion_marks_parent_consumed(client, session_factory, monkeypatch):
    """点选建议创建子节点后父节点置为已选，重新生成建议后恢复未选。"""
    project = _create_project(client, "单选状态")
    project_id = project["project"]["id"]
    root = project["rootNode"]
    items = [
        {"id": "sug00001", "text": "方向一"},
        {"id": "sug00002", "text": "方向二"},
    ]
    _mark_done(session_factory, root["id"], items)

    child = _create_child(
        client,
        project_id,
        root["id"],
        items[1]["text"],
        origin="suggestion",
        suggestionId=items[1]["id"],
    )
    assert child["question"] == items[1]["text"]

    # 父节点在库里被置为已选，GET graph 输出 suggestionsConsumed
    assert _graph_nodes(client, project_id)[root["id"]]["suggestionsConsumed"] is True
    assert _graph_nodes(client, project_id)[child["id"]]["suggestionsConsumed"] is False

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return [{"id": "new00001", "text": "新一轮方向"}]

    monkeypatch.setattr("app.api.nodes.suggestions.generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{root['id']}/suggestions", json={"count": 2})

    assert response.status_code == 200
    # 换一个方向后解除隐藏
    assert _graph_nodes(client, project_id)[root["id"]]["suggestionsConsumed"] is False


def test_branch_creates_empty_input_node(client, session_factory):
    """分支接口返回输入态空卡片；首个分支为主干，后续分支落在父卡片同列下方。"""
    project = _create_project(client, "分支测试")
    project_id = project["project"]["id"]
    root = project["rootNode"]
    _mark_done(session_factory, root["id"])

    first = client.post(f"/api/nodes/{root['id']}/branch").json()

    assert first["status"] == "input"
    assert first["origin"] == "user"
    assert first["question"] == ""
    assert first["answer"] == ""
    assert first["reasoning"] == ""
    assert first["suggestions"] == []
    # 首个分支即主干，与父卡片齐平并位于正右方
    assert first["y"] == root["y"]
    assert first["x"] == root["x"] + 400 + 80

    second = client.post(f"/api/nodes/{root['id']}/branch").json()
    # 第二个分支在直接分支模式下落到父卡片同列下方
    assert second["y"] == first["y"] + (560 + 80)
    assert second["x"] == root["x"]


def test_branch_requires_done_status(client):
    """未完成回答的卡片不能新增分支。"""
    project = _create_project(client, "状态校验")
    root = project["rootNode"]

    response = client.post(f"/api/nodes/{root['id']}/branch")

    assert response.status_code == 400
    assert response.json()["detail"] == "当前卡片还没有完成回答，无法新增分支"
