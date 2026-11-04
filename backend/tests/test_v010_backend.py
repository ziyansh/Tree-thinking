"""v0.1.0 后端新增能力测试：设置项、pin、笔记、批量恢复与保存快照。"""

import json
import time

from app import config
from app.models import ConversationNode

SETTING_DEFAULTS = {
    "connectionStyle": "direct",
    "doubleClickMs": 300,
    "dragDriftDelayMs": 0,
    "dragDriftDistance": 10,
    "cardFontSize": 14,
    "autosaveMinutes": 5,
    "undoSteps": 10,
    "themeHue": 173,
    "edgeWidth": 1.5,
    "edgeColor": "#3a3f4a",
    "themeMode": "system",
    "timeFormat": "24h",
}


def _create_project(client, name: str = "v010 测试") -> dict:
    """新建画布，返回 {project, rootNode, nodes}。"""
    return client.post("/api/projects", json={"name": name}).json()


def _graph_nodes(client, project_id: str) -> dict[str, dict]:
    """取画布全量节点并转成 {id: node}，便于按 id 断言。"""
    nodes = client.get(f"/api/projects/{project_id}/graph").json()["nodes"]
    return {node["id"]: node for node in nodes}


def _mark_done(session_factory, node_id: str, suggestion_items: list[dict]) -> None:
    """直接把节点置为「已完成回答」并写入候选方向。"""
    db = session_factory()
    try:
        node = db.get(ConversationNode, node_id)
        node.question = "已完成的问题"
        node.answer = "已完成的回答"
        node.status = "done"
        node.suggestions = json.dumps(suggestion_items, ensure_ascii=False)
        db.commit()
    finally:
        db.close()


def test_settings_new_fields(client):
    """新增设置项都有默认值，PUT 后可读回，越界值被夹取。"""
    data = client.get("/api/settings").json()
    for key, value in SETTING_DEFAULTS.items():
        assert data[key] == value

    saved = client.put(
        "/api/settings",
        json={
            "connectionStyle": "bus",
            "doubleClickMs": 500,
            "dragDriftDelayMs": 120,
            "dragDriftDistance": 24,
            "autosaveMinutes": 3,
            "undoSteps": 15,
            "themeHue": 200,
            "edgeWidth": 2.5,
            "edgeColor": "#FF0000",
            "themeMode": "dark",
            "timeFormat": "12h",
        },
    )
    assert saved.status_code == 200
    again = client.get("/api/settings").json()
    assert again["connectionStyle"] == "bus"
    assert again["doubleClickMs"] == 500
    assert again["dragDriftDelayMs"] == 120
    assert again["dragDriftDistance"] == 24
    assert again["autosaveMinutes"] == 3
    assert again["undoSteps"] == 15
    assert again["themeHue"] == 200
    assert again["edgeWidth"] == 2.5
    # 颜色统一转小写
    assert again["edgeColor"] == "#ff0000"
    assert again["themeMode"] == "dark"
    assert again["timeFormat"] == "12h"


def test_settings_clamp_and_invalid_enum(client):
    """越界数值夹取到边界，0 分钟的自动保存保持关闭，非法枚举返回 422。"""
    # 色相超上限 → 360
    assert client.put("/api/settings", json={"themeHue": 400}).json()["themeHue"] == 360
    # 撤销步数小于 1 → 1
    assert client.put("/api/settings", json={"undoSteps": 0}).json()["undoSteps"] == 1
    # 自动保存 0 表示关闭，保持 0
    assert client.put("/api/settings", json={"autosaveMinutes": 0}).json()["autosaveMinutes"] == 0
    # 连线粗细超上限 → 6
    assert client.put("/api/settings", json={"edgeWidth": 10}).json()["edgeWidth"] == 6
    # 正文字号超上限 → 24，低于下限 → 12
    assert client.put("/api/settings", json={"cardFontSize": 30}).json()["cardFontSize"] == 24
    assert client.put("/api/settings", json={"cardFontSize": 5}).json()["cardFontSize"] == 12

    bad_mode = client.put("/api/settings", json={"themeMode": "neon"})
    assert bad_mode.status_code == 422


def test_root_node_pinned_by_default(client):
    """新建画布的根节点默认固定；PATCH 解除固定后 updatedAt 变化。"""
    project = _create_project(client, "pin 测试")
    root = project["rootNode"]

    assert root["pinned"] is True
    assert root["nodeType"] == "chat"

    # 间隔一小段时间，保证 updated_at 时间戳可区分
    time.sleep(0.01)
    patched = client.patch(f"/api/nodes/{root['id']}", json={"pinned": False}).json()

    assert patched["pinned"] is False
    assert patched["updatedAt"] != root["updatedAt"]
    assert _graph_nodes(client, project["project"]["id"])[root["id"]]["pinned"] is False


def test_note_create_and_patch(client):
    """笔记默认 320×220，可改标题/正文/尺寸；聊天卡片忽略正文与尺寸。"""
    project = _create_project(client, "笔记测试")
    project_id = project["project"]["id"]

    note = client.post(f"/api/projects/{project_id}/notes", json={"x": 100, "y": 200}).json()

    assert note["nodeType"] == "note"
    assert note["status"] == "done"
    assert note["origin"] == "user"
    assert note["question"] == ""
    assert note["answer"] == ""
    assert note["x"] == 100
    assert note["y"] == 200
    assert note["width"] == 320
    assert note["height"] == 220
    assert note["pinned"] is False

    patched = client.patch(
        f"/api/nodes/{note['id']}",
        json={"title": "笔记标题", "content": "笔记正文", "width": 460, "height": 380},
    ).json()
    assert patched["question"] == "笔记标题"
    assert patched["answer"] == "笔记正文"
    assert patched["width"] == 460
    assert patched["height"] == 380

    # 尺寸不低于 280×240
    shrunk = client.patch(f"/api/nodes/{note['id']}", json={"width": 100, "height": 100}).json()
    assert shrunk["width"] == 280
    assert shrunk["height"] == 240

    # 聊天卡片：正文与尺寸都不写入
    chat = client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "子问题"},
    ).json()
    chat_patched = client.patch(
        f"/api/nodes/{chat['id']}", json={"content": "不应写入", "width": 500}
    ).json()
    assert chat_patched["answer"] == ""
    assert chat_patched["width"] is None


def test_restore_after_delete(client, session_factory):
    """删除子节点（含笔记）后，restore 能按原 id 完整恢复，重复调用不再新增。"""
    project = _create_project(client, "恢复测试")
    project_id = project["project"]["id"]
    root_id = project["rootNode"]["id"]

    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": root_id, "question": "子问题"},
    ).json()
    suggestions = [{"id": "sug00001", "text": "方向一"}]
    _mark_done(session_factory, child["id"], suggestions)
    # 调整坐标并固定，验证恢复时一并带回
    client.patch(f"/api/nodes/{child['id']}", json={"x": 123, "y": 456, "pinned": True})

    note = client.post(f"/api/projects/{project_id}/notes", json={"x": 30, "y": 40}).json()

    snapshot = _graph_nodes(client, project_id)
    chat_snapshot = snapshot[child["id"]]
    note_snapshot = snapshot[note["id"]]

    # 笔记同样可以删除（不受「元问题卡片不可删除」限制）
    assert client.delete(f"/api/nodes/{child['id']}").status_code == 200
    assert client.delete(f"/api/nodes/{note['id']}").status_code == 200
    assert set(_graph_nodes(client, project_id)) == {root_id}

    response = client.post(
        f"/api/projects/{project_id}/nodes/restore",
        json={"nodes": [chat_snapshot, note_snapshot]},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "restored": 2}

    restored = _graph_nodes(client, project_id)
    assert restored[child["id"]]["suggestions"] == suggestions
    assert restored[child["id"]]["x"] == 123
    assert restored[child["id"]]["y"] == 456
    assert restored[child["id"]]["pinned"] is True
    assert restored[child["id"]]["nodeType"] == "chat"
    assert restored[note["id"]]["nodeType"] == "note"
    assert restored[note["id"]]["width"] == 320

    # 已存在的 id 跳过，不再重复插入
    again = client.post(
        f"/api/projects/{project_id}/nodes/restore",
        json={"nodes": [chat_snapshot, note_snapshot]},
    )
    assert again.json() == {"ok": True, "restored": 0}


def test_patch_suggestions(client):
    """PATCH 可整组回写候选方向（撤销「换一个方向」），空内容返回 400 中文提示。"""
    project = _create_project(client, "建议测试")
    project_id = project["project"]["id"]
    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "子问题"},
    ).json()

    items = [{"id": "sug-a", "text": "方向一"}, {"id": "sug-b", "text": "方向二"}]
    patched = client.patch(f"/api/nodes/{child['id']}", json={"suggestions": items}).json()
    assert patched["suggestions"] == items
    assert _graph_nodes(client, project_id)[child["id"]]["suggestions"] == items

    # 非法内容（空 id）→ 400 中文提示，且不写入
    bad = client.patch(
        f"/api/nodes/{child['id']}", json={"suggestions": [{"id": "", "text": "空 id"}]}
    )
    assert bad.status_code == 400
    assert "候选方向" in bad.json()["detail"]
    assert _graph_nodes(client, project_id)[child["id"]]["suggestions"] == items


def test_save_snapshot_file(client):
    """保存写出单个 JSON 快照，节点数与图一致，连续保存仍只保留一份。"""
    project = _create_project(client, "保存测试")
    project_id = project["project"]["id"]
    client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "子问题"},
    )

    response = client.post(f"/api/projects/{project_id}/save")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["fileName"] == f"{project_id}.json"
    assert body["savedAt"]

    target = config.DB_PATH.parent / "saves" / f"{project_id}.json"
    assert target.exists()
    snapshot = json.loads(target.read_text(encoding="utf-8"))
    assert snapshot["project"]["id"] == project_id
    assert snapshot["savedAt"] == body["savedAt"]
    assert len(snapshot["nodes"]) == len(_graph_nodes(client, project_id))

    # 再次保存覆盖旧文件，同画布只留 1 份
    client.post(f"/api/projects/{project_id}/save")
    files = [path for path in target.parent.iterdir() if path.stem == project_id]
    assert len(files) == 1
