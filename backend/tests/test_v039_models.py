"""火山方舟模型列表接口测试：配置校验、上游解析、错误透传与缓存。"""

import pytest

from app.api import models as models_api


@pytest.fixture(autouse=True)
def _clear_cache():
    """每个用例前后清空内存缓存，避免用例之间相互影响。"""
    models_api._cache.clear()
    yield
    models_api._cache.clear()


def _fake_client(
    captured: dict, payload: dict | None = None, status: int = 200, text: str = ""
):
    """构造假的 httpx.AsyncClient：记录请求信息并返回固定响应。"""

    class FakeResponse:
        status_code = status

        @property
        def text(self):
            return text

        def json(self):
            return payload or {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, headers=None):
            captured["calls"] = captured.get("calls", 0) + 1
            captured["url"] = url
            captured["headers"] = headers
            return FakeResponse()

    return FakeClient


def _configure_ark(client, key: str = "ark-test-key") -> None:
    """把当前生效服务商切换到火山方舟并保存测试用配置。"""
    client.put(
        "/api/settings",
        json={
            "provider": "ark",
            "arkApiKey": key,
            "arkBaseUrl": "https://ark.example.com/api/v3/",
        },
    )


def test_rejects_non_ark_provider(client):
    """当前 provider 不是 ark 时，即使保存了 ark Key 也返回 400。"""
    client.put("/api/settings", json={"arkApiKey": "ark-test-key"})
    response = client.get("/api/ark/models")
    assert response.status_code == 400
    assert response.json()["detail"] == "请先配置火山方舟 API Key"


def test_requires_ark_key(client, monkeypatch):
    """切换到 ark 但没有 Key 时返回 400。"""
    # 排除 .env 里可能存在的真实 Key 影响
    monkeypatch.setattr(models_api.runtime_settings.config, "ARK_API_KEY", "")
    client.put("/api/settings", json={"provider": "ark"})
    response = client.get("/api/ark/models")
    assert response.status_code == 400
    assert response.json()["detail"] == "请先配置火山方舟 API Key"


def test_lists_models_with_camel_case_fields(client, monkeypatch):
    """请求地址与 Bearer 正确，响应字段映射为 camelCase，缺少 id 的项被丢弃。"""
    captured: dict = {}
    payload = {
        "object": "list",
        "data": [
            {
                "id": "doubao-seed-2-1-pro-260915",
                "name": "doubao-seed-2-1-pro",
                "modalities": {
                    "input_modalities": ["text", "image", "video"],
                    "output_modalities": ["text"],
                },
                "features": {"tools": {"function_calling": True}},
            },
            {"name": "没有 id，应被丢弃"},
        ],
    }
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _fake_client(captured, payload))
    _configure_ark(client)

    response = client.get("/api/ark/models")

    assert response.status_code == 200
    assert captured["url"] == "https://ark.example.com/api/v3/models"
    assert captured["headers"]["Authorization"] == "Bearer ark-test-key"
    assert captured["timeout"] == 30
    assert response.json() == {
        "models": [
            {
                "id": "doubao-seed-2-1-pro-260915",
                "name": "doubao-seed-2-1-pro",
                "inputModalities": ["text", "image", "video"],
                "outputModalities": ["text"],
                "features": {"tools": {"function_calling": True}},
            }
        ]
    }
    assert "ark-test-key" not in response.text


def test_upstream_error_returns_502(client, monkeypatch):
    """上游返回 403 时转成 502，detail 包含状态码且不泄露 Key。"""
    captured: dict = {}
    monkeypatch.setattr(
        models_api.httpx,
        "AsyncClient",
        _fake_client(captured, status=403, text="Forbidden: invalid api key"),
    )
    _configure_ark(client)

    response = client.get("/api/ark/models")

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "403" in detail
    assert "Forbidden" in detail
    assert "ark-test-key" not in response.text


def test_cache_hits_avoid_upstream_requests(client, monkeypatch):
    """5 分钟内连续两次调用只请求上游一次，缓存键不含明文 Key。"""
    captured: dict = {}
    payload = {"data": [{"id": "model-a", "name": "model-a"}]}
    monkeypatch.setattr(models_api.httpx, "AsyncClient", _fake_client(captured, payload))
    _configure_ark(client)

    first = client.get("/api/ark/models")
    second = client.get("/api/ark/models")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert captured["calls"] == 1
    assert all("ark-test-key" not in key for key in models_api._cache)
