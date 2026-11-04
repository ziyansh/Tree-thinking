"""画布自动命名测试：默认名、用户改名、同名提交与模型失败。"""

from app.models import ConversationNode
from app.services import naming


def _create_default_project(client) -> dict:
    """新建未命名画布（默认名「新画布」），并配置一个假 Key 让自动命名继续执行。"""
    client.put("/api/settings", json={"apiKey": "sk-test-name"})
    return client.post("/api/projects", json={}).json()


def _mark_root_done(session_factory, root_id: str) -> None:
    """把根卡片置为已完成回答，满足自动命名前置条件。"""
    db = session_factory()
    try:
        node = db.get(ConversationNode, root_id)
        node.question = "如何校准频谱仪"
        node.answer = "先预热、再执行零点和满度校准，最后做增益与频响检查。"
        node.status = "done"
        db.commit()
    finally:
        db.close()


def test_auto_name_default_project(client, session_factory, monkeypatch):
    """首轮回答完成后自动改名，且只改一次。"""
    project = _create_default_project(client)
    project_id = project["project"]["id"]
    assert project["project"]["name"] == "新画布"
    _mark_root_done(session_factory, project["rootNode"]["id"])

    calls: list[str] = []

    async def fake_name(question, answer, runtime=None):
        calls.append(question)
        return "频谱仪校准要点"

    monkeypatch.setattr("app.api.projects.naming.generate_project_name", fake_name)

    first = client.post(f"/api/projects/{project_id}/auto-name").json()
    assert first["name"] == "频谱仪校准要点"
    assert len(calls) == 1

    # 已经命名为非默认名后不再调用模型
    second = client.post(f"/api/projects/{project_id}/auto-name").json()
    assert second["name"] == "频谱仪校准要点"
    assert len(calls) == 1


def test_user_rename_blocks_auto_name(client, session_factory, monkeypatch):
    """用户真正改名后，自动命名不再覆盖。"""
    project = _create_default_project(client)
    project_id = project["project"]["id"]
    _mark_root_done(session_factory, project["rootNode"]["id"])

    renamed = client.patch(f"/api/projects/{project_id}", json={"name": "我的画布"}).json()
    assert renamed["name"] == "我的画布"

    async def fail_name(question, answer, runtime=None):
        raise AssertionError("用户已改名，不应调用模型")

    monkeypatch.setattr("app.api.projects.naming.generate_project_name", fail_name)

    result = client.post(f"/api/projects/{project_id}/auto-name").json()
    assert result["name"] == "我的画布"


def test_same_name_rename_keeps_auto_name_eligibility(client, session_factory, monkeypatch):
    """点开重命名但提交同名，不算用户改名。"""
    project = _create_default_project(client)
    project_id = project["project"]["id"]
    _mark_root_done(session_factory, project["rootNode"]["id"])

    same = client.patch(f"/api/projects/{project_id}", json={"name": "新画布"}).json()
    assert same["name"] == "新画布"

    async def fake_name(question, answer, runtime=None):
        return "自动生成的标题"

    monkeypatch.setattr("app.api.projects.naming.generate_project_name", fake_name)

    result = client.post(f"/api/projects/{project_id}/auto-name").json()
    assert result["name"] == "自动生成的标题"


def test_auto_name_failure_keeps_default(client, session_factory, monkeypatch):
    """模型异常或空结果时保持默认名。"""
    project = _create_default_project(client)
    project_id = project["project"]["id"]
    _mark_root_done(session_factory, project["rootNode"]["id"])

    async def empty_name(question, answer, runtime=None):
        return ""

    monkeypatch.setattr("app.api.projects.naming.generate_project_name", empty_name)

    result = client.post(f"/api/projects/{project_id}/auto-name").json()
    assert result["name"] == "新画布"


def test_auto_name_model_error_keeps_default(client, session_factory, monkeypatch):
    """模型调用抛异常时保持默认名，不影响画布。"""
    project = _create_default_project(client)
    project_id = project["project"]["id"]
    _mark_root_done(session_factory, project["rootNode"]["id"])

    async def boom_name(question, answer, runtime=None):
        raise RuntimeError("模型不可用")

    monkeypatch.setattr("app.api.projects.naming.generate_project_name", boom_name)

    result = client.post(f"/api/projects/{project_id}/auto-name").json()
    assert result["name"] == "新画布"


def test_clean_name_strips_quotes_and_truncates():
    """标题清理：去引号/标点，并按最大长度截断。"""
    assert naming._clean_name('{"name":"“频谱校准”"}') == "频谱校准"
    assert len(naming._clean_name('{"name":"' + "很长的标题" * 10 + '"}')) == naming.MAX_NAME_LENGTH
