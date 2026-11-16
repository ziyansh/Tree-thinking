"""v0.3.0 认证与多用户隔离测试（server 模式）。"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.nodes as nodes_api
from app import config
from app.db import Base, get_db
from app.main import app
from app.models import User, UserSetting


@pytest.fixture()
def server_mode(monkeypatch):
    """切到 server 模式；测试走 http，必须关闭 Secure Cookie 才能回传。"""
    monkeypatch.setattr(config, "APP_MODE", "server")
    monkeypatch.setattr(config, "AUTH_SECRET", "unit-test-secret")
    monkeypatch.setattr(config, "AUTH_COOKIE_SECURE", False)


@pytest.fixture()
def server_session_factory(server_mode, monkeypatch):
    """server 模式下的内存库会话工厂。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(nodes_api, "SessionLocal", factory)

    yield factory

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def server_client(server_session_factory):
    """覆盖 get_db 为内存库的 TestClient（server 模式）。"""

    def override_get_db():
        db: Session = server_session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _register(client, username: str = "alice", password: str = "password123"):
    """注册账号（成功后自动登录）。"""
    return client.post(
        "/api/auth/register", json={"username": username, "password": password}
    )


def _login(client, username: str = "alice", password: str = "password123"):
    """登录账号。"""
    return client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )


def test_local_mode_session(client):
    """local 模式下会话接口报告 local，注册登录被拒绝。"""
    session = client.get("/api/auth/session").json()
    assert session == {"mode": "local", "user": None}
    assert _register(client).status_code == 400
    assert _login(client).status_code == 400


def test_register_sets_cookie_and_session(server_client):
    """注册成功后自动登录：写入 Cookie，会话接口返回当前用户。"""
    response = _register(server_client)

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "alice"
    assert "tt_session" in server_client.cookies

    session = server_client.get("/api/auth/session").json()
    assert session["mode"] == "server"
    assert session["user"]["username"] == "alice"


def test_register_validation_and_duplicate(server_client):
    """用户名/密码格式校验与重复注册（大小写不敏感）。"""
    assert _register(server_client, "ab", "password123").status_code == 400
    assert _register(server_client, "alice!", "password123").status_code == 400
    assert _register(server_client, "alice", "short").status_code == 400

    assert _register(server_client).status_code == 200
    duplicate = _register(server_client, "ALICE")
    assert duplicate.status_code == 400
    assert "已被注册" in duplicate.json()["detail"]


def test_login_errors_are_unified(server_client):
    """用户名不存在或密码错误统一提示「用户名或密码错误」。"""
    _register(server_client)

    wrong_password = _login(server_client, "alice", "wrong-password")
    assert wrong_password.status_code == 400
    assert wrong_password.json()["detail"] == "用户名或密码错误"

    unknown_user = _login(server_client, "nobody", "password123")
    assert unknown_user.status_code == 400
    assert unknown_user.json()["detail"] == "用户名或密码错误"


def test_login_and_logout(server_client):
    """登出后受保护接口返回 401；登录用户名大小写不敏感。"""
    _register(server_client)
    server_client.post("/api/auth/logout")

    assert server_client.get("/api/auth/session").json()["user"] is None
    assert server_client.get("/api/projects").status_code == 401

    server_client.cookies.clear()
    assert _login(server_client, "Alice").status_code == 200
    assert server_client.get("/api/projects").status_code == 200


def test_protected_routes_require_login(server_client):
    """server 模式下未登录访问受保护接口一律 401。"""
    assert server_client.get("/api/projects").status_code == 401
    assert server_client.get("/api/settings").status_code == 401
    assert server_client.post("/api/projects", json={}).status_code == 401
    assert server_client.get("/api/attachments/" + "0" * 32).status_code == 401


def test_cross_user_isolation(server_client):
    """不同用户之间：画布/节点/附件一律 404，设置互不影响。"""
    _register(server_client, "alice")
    alice_project = server_client.post(
        "/api/projects", json={"name": "A 的画布"}
    ).json()
    alice_project_id = alice_project["project"]["id"]
    alice_root_id = alice_project["rootNode"]["id"]
    alice_attachment = server_client.post(
        "/api/attachments", files={"file": ("a.txt", b"alice-only", "text/plain")}
    ).json()
    server_client.put(
        "/api/settings", json={"apiKey": "sk-alice-key-1234", "themeHue": 100}
    )
    server_client.post("/api/auth/logout")
    server_client.cookies.clear()

    _register(server_client, "bob")

    # 列表里看不到别人的画布
    assert server_client.get("/api/projects").json() == []
    # 画布相关接口统一 404（不泄露存在性）
    assert server_client.get(f"/api/projects/{alice_project_id}/graph").status_code == 404
    assert server_client.patch(
        f"/api/projects/{alice_project_id}", json={"name": "改名"}
    ).status_code == 404
    assert server_client.delete(f"/api/projects/{alice_project_id}").status_code == 404
    assert server_client.get(f"/api/projects/{alice_project_id}/export").status_code == 404
    assert server_client.post(
        f"/api/projects/{alice_project_id}/nodes/restore", json={"nodes": []}
    ).status_code == 404
    # 节点接口同样校验所属画布归属
    assert server_client.patch(f"/api/nodes/{alice_root_id}", json={"x": 1}).status_code == 404
    assert server_client.post(f"/api/nodes/{alice_root_id}/stop").status_code == 404
    # 附件读取校验归属
    assert server_client.get(alice_attachment["url"]).status_code == 404

    # 设置互不影响：bob 仍为默认值
    bob_settings = server_client.get("/api/settings").json()
    assert bob_settings["hasKey"] is False
    assert bob_settings["themeHue"] == 173


def test_server_settings_persist_per_user(server_client):
    """server 模式设置按用户保存，切换账号后互不覆盖。"""
    _register(server_client, "alice")
    server_client.put(
        "/api/settings",
        json={"apiKey": "sk-alice-12345678", "model": "deepseek-v4-pro"},
    )
    server_client.post("/api/auth/logout")
    server_client.cookies.clear()

    _register(server_client, "bob")
    assert server_client.get("/api/settings").json()["hasKey"] is False

    server_client.post("/api/auth/logout")
    server_client.cookies.clear()
    assert _login(server_client, "alice").status_code == 200

    data = server_client.get("/api/settings").json()
    assert data["hasKey"] is True
    assert data["model"] == "deepseek-v4-pro"
    assert data["apiKeyMasked"] == "sk-••••5678"


def test_server_api_key_encrypted_per_user(server_client, server_session_factory):
    """server 模式 Key 写入 user_settings 且为密文。"""
    _register(server_client, "alice")
    server_client.put("/api/settings", json={"apiKey": "sk-alice-secret-1234"})

    db = server_session_factory()
    try:
        user = db.scalar(select(User).where(User.username == "alice"))
        stored = db.get(UserSetting, user.id).api_key
    finally:
        db.close()

    assert stored.startswith("enc:")
    assert "sk-alice-secret-1234" not in stored


def test_attachment_owner_recorded(server_client, server_session_factory):
    """server 模式下附件 sidecar 写入当前用户 id。"""
    _register(server_client, "alice")
    meta = server_client.post(
        "/api/attachments", files={"file": ("a.txt", b"hello", "text/plain")}
    ).json()

    sidecar = config.UPLOAD_DIR / f"{meta['id']}.json"
    stored = json.loads(sidecar.read_text(encoding="utf-8"))

    db = server_session_factory()
    try:
        user = db.scalar(select(User).where(User.username == "alice"))
        user_id = user.id
    finally:
        db.close()
    assert stored["owner_id"] == user_id


def test_server_mode_requires_auth_secret(server_mode, monkeypatch):
    """server 模式缺少 AUTH_SECRET 时拒绝启动。"""
    monkeypatch.setattr(config, "AUTH_SECRET", "")
    with pytest.raises(RuntimeError):
        with TestClient(app):
            pass
