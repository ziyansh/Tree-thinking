"""v0.3.0 功能测试：停止三态、继续生成、标题自动更新、导入导出与 Key 加密。"""

import json

import app.api.nodes as nodes_api
from app import config
from app.models import AppSetting, ConversationNode
from app.services import auth, llm, suggestions
from app.services.naming import MAX_NAME_LENGTH


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


def _create_project(client, name: str = "v030 测试") -> dict:
    """新建画布，返回 {project, rootNode, nodes}。"""
    return client.post("/api/projects", json={"name": name}).json()


def _set_node(session_factory, node_id: str, **fields) -> None:
    """直接改库：模拟流式过程中已产生的内容。"""
    db = session_factory()
    try:
        node = db.get(ConversationNode, node_id)
        for name, value in fields.items():
            setattr(node, name, value)
        db.commit()
    finally:
        db.close()


def _load_node(session_factory, node_id: str) -> ConversationNode:
    """直接从内存库读取节点最终状态。"""
    db = session_factory()
    try:
        return db.get(ConversationNode, node_id)
    finally:
        db.close()


# ---------- A. 停止生成三态 ----------


def test_stop_with_answer_pauses_and_keeps_content(client, session_factory):
    """已有输出时停止：置为 paused，保留回答/思考/来源并清空错误。"""
    project = _create_project(client)
    root_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{root_id}/question", json={"question": "会被暂停的提问"})
    sources = [{"title": "来源", "url": "https://example.com"}]
    _set_node(
        session_factory,
        root_id,
        answer="已经生成的部分",
        reasoning="已经产生的思考",
        sources=json.dumps(sources, ensure_ascii=False),
        status="streaming",
        error="旧的错误",
    )

    stopped = client.post(f"/api/nodes/{root_id}/stop").json()

    assert stopped["status"] == "paused"
    assert stopped["answer"] == "已经生成的部分"
    assert stopped["reasoning"] == "已经产生的思考"
    assert stopped["sources"][0]["title"] == "来源"
    assert stopped["error"] is None
    assert stopped["prompt"] == "会被暂停的提问"


def test_stop_without_answer_keeps_non_root_node(client):
    """没有输出时停止非根卡片：保持原样返回，由前端删除。"""
    project = _create_project(client)
    child = client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "子问题"},
    ).json()

    stopped = client.post(f"/api/nodes/{child['id']}/stop").json()

    assert stopped["status"] == "pending"
    assert stopped["answer"] == ""
    assert stopped["question"] == "子问题"
    # 节点仍存在
    graph = client.get(f"/api/projects/{project['project']['id']}/graph").json()
    assert child["id"] in {node["id"] for node in graph["nodes"]}


def test_stop_with_body_saves_streaming_content_for_root(client, session_factory):
    """流式中途停止根卡片：DB 中 answer 仍为空，但 body 回传的内容要落库并暂停。"""
    project = _create_project(client)
    root_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{root_id}/question", json={"question": "流式中途停止"})
    sources = [{"title": "来源", "url": "https://example.com"}]
    # 模拟前端流式期间：DB 里还没有任何回答内容
    assert _load_node(session_factory, root_id).answer == ""

    stopped = client.post(
        f"/api/nodes/{root_id}/stop",
        json={
            "answer": "前端已累积的回答",
            "reasoning": "前端已累积的思考",
            "sources": sources,
        },
    ).json()

    assert stopped["status"] == "paused"
    assert stopped["answer"] == "前端已累积的回答"
    assert stopped["reasoning"] == "前端已累积的思考"
    assert stopped["sources"] == sources

    node = _load_node(session_factory, root_id)
    assert node.status == "paused"
    assert node.answer == "前端已累积的回答"
    assert node.reasoning == "前端已累积的思考"
    assert json.loads(node.sources) == sources


def test_stop_with_body_saves_streaming_content_for_child(client, session_factory):
    """非根卡片同理：body 带内容时置 paused 并落库；未传 sources 时保留原来源。"""
    project = _create_project(client)
    child = client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "子问题"},
    ).json()
    old_sources = [{"title": "旧来源", "url": "https://old.example.com"}]
    _set_node(
        session_factory,
        child["id"],
        sources=json.dumps(old_sources, ensure_ascii=False),
    )

    stopped = client.post(
        f"/api/nodes/{child['id']}/stop",
        json={"answer": "子卡片已生成的内容"},
    ).json()

    assert stopped["status"] == "paused"
    assert stopped["answer"] == "子卡片已生成的内容"
    # body 未带 sources 时不清空、不覆盖原有来源
    assert stopped["sources"] == old_sources

    node = _load_node(session_factory, child["id"])
    assert node.status == "paused"
    assert node.answer == "子卡片已生成的内容"


def test_late_stream_result_does_not_override_paused(client, session_factory):
    """暂停后迟到的流式落库被丢弃，已保留的内容不被覆盖。"""
    project = _create_project(client)
    root_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{root_id}/question", json={"question": "迟到的流"})

    client.post(
        f"/api/nodes/{root_id}/stop", json={"answer": "用户看到并保留的内容"}
    )

    # 模拟中断后生成器 finally 里的迟到落库
    nodes_api._persist_answer(root_id, "迟到的完整回答", "迟到思考", "done", None, None, [])

    node = _load_node(session_factory, root_id)
    assert node.status == "paused"
    assert node.answer == "用户看到并保留的内容"
    assert node.error is None


# ---------- A. 继续生成 ----------


def test_continue_appends_answer_and_emits_events(client, session_factory, monkeypatch):
    """继续生成：把已有回答作为 assistant 上下文，增量追加且不重新生成候选方向。"""
    project = _create_project(client)
    root_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{root_id}/question", json={"question": "继续测试"})
    sources = [{"title": "旧来源", "url": "https://example.com"}]
    suggestions_before = [{"id": "sug0001", "text": "原有方向"}]
    _set_node(
        session_factory,
        root_id,
        answer="已有开头。",
        reasoning="旧思考",
        status="paused",
        sources=json.dumps(sources, ensure_ascii=False),
        suggestions=json.dumps(suggestions_before, ensure_ascii=False),
    )
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "test-key")

    captured: dict = {}

    async def fake_stream_chat(messages, runtime=None):
        captured["messages"] = messages
        yield "reasoning", "续思考"
        yield "delta", "续写内容"

    async def fail_generate(node, count=None, used_texts=None, runtime=None):
        raise AssertionError("继续生成不应重新生成候选方向")

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(suggestions, "generate_suggestions", fail_generate)

    response = client.post(f"/api/nodes/{root_id}/continue")

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    events = _parse_sse(response.text)
    assert [event for event, _ in events] == ["reasoning", "delta", "done"]
    assert events[-1] == ("done", {"status": "done"})

    messages = captured["messages"]
    assert messages[-2] == {"role": "assistant", "content": "已有开头。"}
    assert messages[-1]["role"] == "user"
    assert "继续" in messages[-1]["content"]

    node = _load_node(session_factory, root_id)
    assert node.status == "done"
    assert node.answer == "已有开头。续写内容"
    assert node.reasoning == "旧思考续思考"
    assert node.error is None
    # 来源与候选方向保持不变
    assert json.loads(node.sources) == sources
    assert json.loads(node.suggestions) == suggestions_before


def test_continue_requires_existing_answer(client):
    """没有回答内容时不能继续生成，返回 400。"""
    project = _create_project(client)
    root_id = project["rootNode"]["id"]

    response = client.post(f"/api/nodes/{root_id}/continue")

    assert response.status_code == 400
    assert "无法继续生成" in response.json()["detail"]


# ---------- B. 卡片标题自动更新 ----------


def test_patch_prompt_auto_updates_title(client):
    """未手动改名时，重新提交提问会按同步规则更新标题。"""
    project = _create_project(client)
    child = client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "原始问题"},
    ).json()
    assert child["titleCustom"] is False

    patched = client.patch(
        f"/api/nodes/{child['id']}",
        json={"prompt": "  新的提问   内容 \n第二行被忽略  "},
    ).json()

    assert patched["prompt"] == "新的提问   内容 \n第二行被忽略"
    assert patched["question"] == "新的提问 内容"
    assert patched["titleCustom"] is False


def test_patch_prompt_title_truncated_to_limit(client):
    """自动标题去掉首尾引号与标点，并截断到 20 字。"""
    project = _create_project(client)
    child = client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "原始问题"},
    ).json()
    long_prompt = "“" + "很长的提问内容" * 6 + "”"

    patched = client.patch(f"/api/nodes/{child['id']}", json={"prompt": long_prompt}).json()

    assert len(patched["question"]) == MAX_NAME_LENGTH
    assert not patched["question"].startswith("“")


def test_manual_title_survives_prompt_update(client):
    """手动改名后（titleCustom=True），重新提交提问不再覆盖标题。"""
    project = _create_project(client)
    child = client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "原始问题"},
    ).json()

    renamed = client.patch(f"/api/nodes/{child['id']}", json={"title": "自定义标题"}).json()
    assert renamed["question"] == "自定义标题"
    assert renamed["titleCustom"] is True

    patched = client.patch(f"/api/nodes/{child['id']}", json={"prompt": "全新的提问"}).json()
    assert patched["question"] == "自定义标题"
    assert patched["prompt"] == "全新的提问"
    assert patched["titleCustom"] is True


def test_title_wins_when_title_and_prompt_together(client):
    """同一次 PATCH 同时含 title 与 prompt 时，以 title 为准。"""
    project = _create_project(client)
    child = client.post(
        f"/api/projects/{project['project']['id']}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "原始问题"},
    ).json()

    patched = client.patch(
        f"/api/nodes/{child['id']}",
        json={"title": "手动标题", "prompt": "新的提问"},
    ).json()

    assert patched["question"] == "手动标题"
    assert patched["prompt"] == "新的提问"
    assert patched["titleCustom"] is True


def test_restore_keeps_title_custom(client):
    """撤销删除恢复时能带回 titleCustom 标记。"""
    project = _create_project(client)
    project_id = project["project"]["id"]
    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={"parentId": project["rootNode"]["id"], "question": "原始问题"},
    ).json()
    client.patch(f"/api/nodes/{child['id']}", json={"title": "手动标题"})

    snapshot = next(
        node
        for node in client.get(f"/api/projects/{project_id}/graph").json()["nodes"]
        if node["id"] == child["id"]
    )
    assert snapshot["titleCustom"] is True

    client.delete(f"/api/nodes/{child['id']}")
    client.post(f"/api/projects/{project_id}/nodes/restore", json={"nodes": [snapshot]})

    restored = next(
        node
        for node in client.get(f"/api/projects/{project_id}/graph").json()["nodes"]
        if node["id"] == child["id"]
    )
    assert restored["titleCustom"] is True


# ---------- API Key 加密 ----------


def test_api_key_encrypted_in_database(client, session_factory):
    """提交的 Key 在数据库中为密文，且可通过派生密钥还原。"""
    client.put(
        "/api/settings",
        json={"apiKey": "sk-deepseek-12345678", "openaiApiKey": "sk-openai-abcdefgh"},
    )

    db = session_factory()
    try:
        row = db.get(AppSetting, 1)
        stored_key = row.api_key
        stored_openai_key = row.openai_api_key
    finally:
        db.close()

    assert stored_key.startswith("enc:")
    assert "sk-deepseek-12345678" not in stored_key
    assert auth.decrypt_secret(stored_key) == "sk-deepseek-12345678"
    assert stored_openai_key.startswith("enc:")
    assert auth.decrypt_secret(stored_openai_key) == "sk-openai-abcdefgh"

    # 接口仍能正常脱敏展示
    data = client.get("/api/settings").json()
    assert data["apiKeyMasked"] == "sk-••••5678"


def test_legacy_plaintext_key_encrypted_on_next_save(client, session_factory):
    """旧明文 Key 可直接读取，并在下一次保存时自动转成密文。"""
    db = session_factory()
    try:
        db.add(AppSetting(id=1, api_key="sk-legacy-1234"))
        db.commit()
    finally:
        db.close()

    readable = client.get("/api/settings").json()
    assert readable["apiKeyMasked"] == "sk-••••1234"

    client.put("/api/settings", json={"model": "deepseek-flash"})

    db = session_factory()
    try:
        stored = db.get(AppSetting, 1).api_key
    finally:
        db.close()
    assert stored.startswith("enc:")
    assert auth.decrypt_secret(stored) == "sk-legacy-1234"


# ---------- D. 导出与导入 ----------


def _prepare_export_project(client, session_factory) -> tuple[str, str]:
    """构造带来源、候选方向与手动标题的画布，返回（画布 id，子节点 id）。"""
    project = _create_project(client, "导出测试")
    project_id = project["project"]["id"]
    root_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{root_id}/question", json={"question": "根问题"})

    sources = [
        {
            "title": "来源标题",
            "url": "https://example.com/a",
            "snippet": "摘要",
            "summary": "摘要正文",
            "siteName": "示例站",
            "date": None,
        }
    ]
    _set_node(
        session_factory,
        root_id,
        answer="根回答",
        reasoning="根思考",
        status="done",
        sources=json.dumps(sources, ensure_ascii=False),
        suggestions=json.dumps(
            [{"id": "sug0001", "text": "方向一"}], ensure_ascii=False
        ),
    )

    child = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "parentId": root_id,
            "question": "子问题",
            "origin": "suggestion",
            "suggestionId": "sug0001",
        },
    ).json()
    client.patch(f"/api/nodes/{child['id']}", json={"title": "手动标题"})
    return project_id, child["id"]


def test_export_and_import_roundtrip(client, session_factory):
    """导出 JSON 后再导入：生成新 id、保持父子关系并保留全部字段。"""
    project_id, child_id = _prepare_export_project(client, session_factory)

    response = client.get(f"/api/projects/{project_id}/export")

    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert "attachment" in disposition
    assert "filename*=UTF-8''" in disposition

    data = response.json()
    assert data["app"] == "tree-thinking"
    assert data["version"] == 1
    assert data["exportedAt"]
    assert data["project"]["name"] == "导出测试"
    assert len(data["nodes"]) == 2

    old_root = next(
        node
        for node in data["nodes"]
        if node["parentId"] is None and node["nodeType"] == "chat"
    )
    old_child = next(node for node in data["nodes"] if node["id"] == child_id)
    assert old_child["titleCustom"] is True

    imported = client.post("/api/projects/import", json=data)

    assert imported.status_code == 200
    body = imported.json()
    new_project_id = body["project"]["id"]
    new_root_id = body["nodeId"]
    assert new_project_id != project_id
    assert body["project"]["name"] == "导出测试（导入）"
    assert new_root_id != old_root["id"]

    graph = client.get(f"/api/projects/{new_project_id}/graph").json()
    new_nodes = {node["id"]: node for node in graph["nodes"]}
    assert len(new_nodes) == 2
    # 所有节点都换了新 id
    assert not ({node["id"] for node in data["nodes"]} & set(new_nodes))

    new_root = new_nodes[new_root_id]
    assert new_root["question"] == "根问题"
    assert new_root["answer"] == "根回答"
    assert new_root["reasoning"] == "根思考"
    assert new_root["sources"] == old_root["sources"]
    assert new_root["suggestions"] == old_root["suggestions"]

    # 子节点：父子关系与手动标题都保留
    imported_child = next(
        node for node in new_nodes.values() if node["question"] == "手动标题"
    )
    assert imported_child["parentId"] == new_root_id
    assert imported_child["prompt"] == "子问题"
    assert imported_child["titleCustom"] is True
    assert imported_child["origin"] == "suggestion"
    assert imported_child["suggestionId"] == "sug0001"


def test_import_rejects_invalid_payload(client):
    """非法导入文件：app / version / nodes / 根节点 / 父子关系错误都返回 400。"""
    node = {
        "id": "a" * 32,
        "parentId": None,
        "question": "根问题",
        "nodeType": "chat",
        "status": "done",
    }
    base = {"app": "tree-thinking", "version": 1, "project": {"name": "导入"}, "nodes": [node]}

    bad_app = client.post("/api/projects/import", json={**base, "app": "other-app"})
    assert bad_app.status_code == 400

    missing_app = client.post(
        "/api/projects/import", json={"version": 1, "nodes": [node]}
    )
    assert missing_app.status_code == 400

    bad_version = client.post("/api/projects/import", json={**base, "version": 2})
    assert bad_version.status_code == 400

    no_nodes = client.post("/api/projects/import", json={**base, "nodes": []})
    assert no_nodes.status_code == 400

    no_root = client.post(
        "/api/projects/import",
        json={
            **base,
            "nodes": [{**node, "parentId": "b" * 32}],
        },
    )
    assert no_root.status_code == 400

    broken_parent = client.post(
        "/api/projects/import",
        json={**base, "nodes": [node, {**node, "id": "c" * 32, "parentId": "d" * 32}]},
    )
    assert broken_parent.status_code == 400

    duplicate_id = client.post(
        "/api/projects/import", json={**base, "nodes": [node, {**node, "question": "重复"}]}
    )
    assert duplicate_id.status_code == 400
