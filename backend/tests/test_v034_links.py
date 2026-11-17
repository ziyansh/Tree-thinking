"""v0.3.4 笔记连接测试：连接 CRUD、级联删除、导出导入与设置字段。"""

import json
import uuid

from sqlalchemy import select

from app.models import NoteLink


def _create_project(client, name: str = "连接测试") -> dict:
    """新建画布，返回 {project, rootNode, nodes}。"""
    return client.post("/api/projects", json={"name": name}).json()


def _create_chat(client, project_id: str, root_id: str, question: str) -> dict:
    """在根卡片下新建一张回答卡片（chat）。"""
    return client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": root_id, "question": question},
    ).json()


def _create_note(client, project_id: str, x: float = 100, y: float = 100) -> dict:
    """新建一张笔记卡片（note）。"""
    return client.post(
        f"/api/projects/{project_id}/notes", json={"x": x, "y": y}
    ).json()


def _post_link(client, project_id: str, answer_id: str, note_id: str):
    """创建一条连接。"""
    return client.post(
        f"/api/projects/{project_id}/links",
        json={"answerNodeId": answer_id, "noteNodeId": note_id},
    )


def _links(client, project_id: str) -> list[dict]:
    """读取画布全部连接。"""
    return client.get(f"/api/projects/{project_id}/links").json()


def _pairs(links: list[dict]) -> set[tuple[str, str]]:
    """把连接列表压缩成 (answer, note) 集合，便于比较。"""
    return {(item["answerNodeId"], item["noteNodeId"]) for item in links}


# ---------- A. 创建 / 幂等 / 校验 ----------


def test_create_link_and_idempotent(client):
    """创建成功；重复提交返回同一条记录；多对多组合都允许。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    root_id = data["rootNode"]["id"]
    chat = _create_chat(client, project_id, root_id, "第一个回答")
    other_chat = _create_chat(client, project_id, root_id, "第二个回答")
    note = _create_note(client, project_id)
    other_note = _create_note(client, project_id, 500, 500)

    created = _post_link(client, project_id, chat["id"], note["id"])
    assert created.status_code == 200
    body = created.json()
    assert len(body["id"]) == 32
    assert body["projectId"] == project_id
    assert body["answerNodeId"] == chat["id"]
    assert body["noteNodeId"] == note["id"]

    # 重复连接幂等：返回已有记录，不新增
    again = _post_link(client, project_id, chat["id"], note["id"])
    assert again.status_code == 200
    assert again.json()["id"] == body["id"]
    assert len(_links(client, project_id)) == 1

    # 同一回答可连多个笔记，同一笔记也可连多个回答
    _post_link(client, project_id, chat["id"], other_note["id"])
    _post_link(client, project_id, other_chat["id"], note["id"])
    assert len(_links(client, project_id)) == 3


def test_create_link_rejects_invalid_pairs(client):
    """同类型、同一节点、跨项目与不存在的 id 都返回 400。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    root_id = data["rootNode"]["id"]
    chat = _create_chat(client, project_id, root_id, "回答")
    note = _create_note(client, project_id)
    note2 = _create_note(client, project_id, 600, 600)

    # 回答 ↔ 回答、笔记 ↔ 笔记
    assert _post_link(client, project_id, root_id, chat["id"]).status_code == 400
    assert _post_link(client, project_id, note["id"], note2["id"]).status_code == 400
    # 同一节点
    assert _post_link(client, project_id, chat["id"], chat["id"]).status_code == 400
    # 不存在的 id
    missing = uuid.uuid4().hex
    assert _post_link(client, project_id, missing, note["id"]).status_code == 400
    assert _post_link(client, project_id, chat["id"], missing).status_code == 400

    # 跨项目节点
    other = _create_project(client, "另一个画布")
    other_root = other["rootNode"]["id"]
    cross = _post_link(client, project_id, other_root, note["id"])
    assert cross.status_code == 400
    assert "不属于该画布" in cross.json()["detail"]

    assert _links(client, project_id) == []


# ---------- B. 列表 / 删除 / 全量覆盖 ----------


def test_list_and_delete_link(client):
    """列表返回全部连接；删除后消失；删除不存在的连接返回 404。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    chat = _create_chat(client, project_id, data["rootNode"]["id"], "回答")
    note = _create_note(client, project_id)
    link = _post_link(client, project_id, chat["id"], note["id"]).json()

    assert _pairs(_links(client, project_id)) == {(chat["id"], note["id"])}

    deleted = client.delete(f"/api/projects/{project_id}/links/{link['id']}")
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}
    assert _links(client, project_id) == []

    missing = client.delete(f"/api/projects/{project_id}/links/{link['id']}")
    assert missing.status_code == 404


def test_sync_links_replaces_all_and_rejects_invalid(client):
    """PUT 全量覆盖并去重；列表中有非法项时整体拒绝，已有连接保持不变。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    root_id = data["rootNode"]["id"]
    chat = _create_chat(client, project_id, root_id, "回答")
    note = _create_note(client, project_id)
    note2 = _create_note(client, project_id, 700, 700)

    first = _post_link(client, project_id, chat["id"], note["id"]).json()
    assert first["id"]

    # 覆盖为两条（其中一条重复），重复项被去重
    body = {
        "links": [
            {"answerNodeId": chat["id"], "noteNodeId": note2["id"]},
            {"answerNodeId": chat["id"], "noteNodeId": note2["id"]},
        ]
    }
    synced = client.put(f"/api/projects/{project_id}/links", json=body)
    assert synced.status_code == 200
    assert _pairs(synced.json()) == {(chat["id"], note2["id"])}
    assert _pairs(_links(client, project_id)) == {(chat["id"], note2["id"])}

    # 重复提交同一列表保持幂等（内容一致）
    repeat = client.put(f"/api/projects/{project_id}/links", json=body)
    assert _pairs(repeat.json()) == {(chat["id"], note2["id"])}

    # 含非法项的列表整体拒绝，覆盖前的数据不被部分写入
    bad = {
        "links": [
            {"answerNodeId": chat["id"], "noteNodeId": note["id"]},
            {"answerNodeId": root_id, "noteNodeId": chat["id"]},
        ]
    }
    rejected = client.put(f"/api/projects/{project_id}/links", json=bad)
    assert rejected.status_code == 400
    assert _pairs(_links(client, project_id)) == {(chat["id"], note2["id"])}


# ---------- C. 级联删除 ----------


def test_delete_answer_node_cascades_links(client):
    """删除回答卡片时，引用它的连接一并删除。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    chat = _create_chat(client, project_id, data["rootNode"]["id"], "会被删除的回答")
    note = _create_note(client, project_id)
    _post_link(client, project_id, chat["id"], note["id"])

    assert client.delete(f"/api/nodes/{chat['id']}").status_code == 200
    assert _links(client, project_id) == []
    # 笔记卡片本身保留
    graph = client.get(f"/api/projects/{project_id}/graph").json()
    assert note["id"] in {node["id"] for node in graph["nodes"]}


def test_delete_note_node_cascades_links(client):
    """删除笔记卡片或整个画布时，相关连接一并删除。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    chat = _create_chat(client, project_id, data["rootNode"]["id"], "保留的回答")
    note = _create_note(client, project_id)
    _post_link(client, project_id, chat["id"], note["id"])

    assert client.delete(f"/api/nodes/{note['id']}").status_code == 200
    assert _links(client, project_id) == []

    # 再建一条连接后直接删除画布
    note2 = _create_note(client, project_id)
    _post_link(client, project_id, chat["id"], note2["id"])
    assert len(_links(client, project_id)) == 1
    assert client.delete(f"/api/projects/{project_id}").status_code == 200


# ---------- D. 导出 / 导入 ----------


def test_export_and_import_links(client, session_factory):
    """导出 JSON 含 links；导入后按旧 id → 新 id 重建，非法项跳过。"""
    data = _create_project(client, "连接导出")
    project_id = data["project"]["id"]
    root_id = data["rootNode"]["id"]
    chat = _create_chat(client, project_id, root_id, "子问题")
    note = _create_note(client, project_id)
    _post_link(client, project_id, chat["id"], note["id"])

    exported = client.get(f"/api/projects/{project_id}/export").json()
    assert exported["links"] == [
        {"answerNodeId": chat["id"], "noteNodeId": note["id"]}
    ]

    # 追加一条引用不存在节点、一条类型不匹配的连接，导入时应被跳过
    exported["links"].append(
        {"answerNodeId": uuid.uuid4().hex, "noteNodeId": note["id"]}
    )
    exported["links"].append({"answerNodeId": root_id, "noteNodeId": chat["id"]})

    imported = client.post("/api/projects/import", json=exported)
    assert imported.status_code == 200
    body = imported.json()
    new_project_id = body["project"]["id"]
    assert new_project_id != project_id
    assert len(body["links"]) == 1

    graph = client.get(f"/api/projects/{new_project_id}/graph").json()
    new_chat_id = next(
        node["id"] for node in graph["nodes"] if node["question"] == "子问题"
    )
    new_note_id = next(
        node["id"] for node in graph["nodes"] if node["nodeType"] == "note"
    )

    assert body["links"][0]["answerNodeId"] == new_chat_id
    assert body["links"][0]["noteNodeId"] == new_note_id
    assert body["links"][0]["projectId"] == new_project_id
    assert _pairs(_links(client, new_project_id)) == {(new_chat_id, new_note_id)}


def test_delete_project_removes_links(client, session_factory):
    """删除画布后连接记录清零。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    chat = _create_chat(client, project_id, data["rootNode"]["id"], "回答")
    note = _create_note(client, project_id)
    _post_link(client, project_id, chat["id"], note["id"])

    client.delete(f"/api/projects/{project_id}")

    db = session_factory()
    try:
        assert db.scalars(select(NoteLink)).all() == []
    finally:
        db.close()


# ---------- E. 设置字段 ----------


def test_note_link_settings_defaults_and_update(client):
    """默认直角线 1.5 / none；保存 curved 与 shift-note 生效，粗细夹取。"""
    defaults = client.get("/api/settings").json()
    assert defaults["noteLinkStyle"] == "orthogonal"
    assert defaults["noteLinkWidth"] == 1.5
    assert defaults["noteLinkReleaseAction"] == "none"

    updated = client.put(
        "/api/settings",
        json={
            "noteLinkStyle": "curved",
            "noteLinkWidth": 99,
            "noteLinkReleaseAction": "shift-note",
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["noteLinkStyle"] == "curved"
    assert body["noteLinkWidth"] == 6
    assert body["noteLinkReleaseAction"] == "shift-note"

    # 过小夹到 0.5；再次读取保持
    small = client.put("/api/settings", json={"noteLinkWidth": 0.1})
    assert small.json()["noteLinkWidth"] == 0.5
    assert client.get("/api/settings").json()["noteLinkStyle"] == "curved"

    # 非法枚举值返回 422
    assert (
        client.put("/api/settings", json={"noteLinkStyle": "straight"}).status_code
        == 422
    )
    assert (
        client.put(
            "/api/settings", json={"noteLinkReleaseAction": "delete"}
        ).status_code
        == 422
    )


def test_note_link_export_json_serializable(client):
    """导出的 links 可再次序列化为 JSON（避免 datetime 等非 JSON 值混入）。"""
    data = _create_project(client)
    project_id = data["project"]["id"]
    chat = _create_chat(client, project_id, data["rootNode"]["id"], "回答")
    note = _create_note(client, project_id)
    _post_link(client, project_id, chat["id"], note["id"])

    exported = client.get(f"/api/projects/{project_id}/export").json()
    assert json.loads(json.dumps(exported))["links"]
