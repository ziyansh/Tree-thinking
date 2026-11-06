"""设置接口测试：脱敏输出、持久化、校验与「保存后立即生效」。"""

from app.services import llm


def test_settings_defaults(client):
    """没有任何设置行时，读取 .env 默认值且认为未配置 Key。"""
    response = client.get("/api/settings")

    assert response.status_code == 200
    data = response.json()
    assert data["hasKey"] is False
    assert data["apiKeyMasked"] == ""
    assert data["baseUrl"].startswith("https://")
    assert data["model"]
    assert data["thinkingEnabled"] is True
    assert data["suggestionCount"] == 3
    # 卡片尺寸默认 400×560
    assert data["cardWidth"] == 400
    assert data["cardHeight"] == 560
    assert data["cardGap"] == 80
    # 指针手势默认：双击 300ms、漂移延迟 0ms、漂移距离 10px
    assert data["doubleClickMs"] == 300
    assert data["dragDriftDelayMs"] == 0
    assert data["dragDriftDistance"] == 10
    # 滚轮逻辑默认始终缩放画布
    assert data["wheelMode"] == "zoom-canvas"
    # 旧的长按设置不再暴露
    assert "longPressMs" not in data
    assert data["cardFontSize"] == 14
    # 默认服务商为 DeepSeek，OpenAI 使用独立配置
    assert data["provider"] == "deepseek"
    assert data["openaiHasKey"] is False
    assert data["openaiBaseUrl"] == "https://api.openai.com/v1"
    assert data["openaiModel"] == "gpt-4o-mini"
    assert data["openaiTemperatureEnabled"] is False
    assert data["openaiTemperature"] == 1.0
    assert data["openaiMaxTokens"] == 0
    assert data["openaiReasoningEffort"] == "default"
    assert data["openaiTimeoutSeconds"] == 60
    # 来源抽屉高度比例默认 0.25
    assert data["sourcesPanelRatio"] == 0.25
    # 画布惯性默认关闭，系数 0.5；背景默认无
    assert data["panInertiaEnabled"] is False
    assert data["panInertiaCoefficient"] == 0.5
    assert data["canvasStyle"] == "none"


def test_settings_canvas_motion_clamp(client):
    """惯性系数超出 0.1–1.0 时夹到边界，画布样式可切换并持久化。"""
    too_big = client.put(
        "/api/settings",
        json={"panInertiaEnabled": True, "panInertiaCoefficient": 1.8},
    )
    assert too_big.status_code == 200
    assert too_big.json()["panInertiaEnabled"] is True
    assert too_big.json()["panInertiaCoefficient"] == 1.0

    too_small = client.put("/api/settings", json={"panInertiaCoefficient": 0.05})
    assert too_small.status_code == 200
    assert too_small.json()["panInertiaCoefficient"] == 0.1

    style = client.put("/api/settings", json={"canvasStyle": "dots"})
    assert style.status_code == 200
    assert style.json()["canvasStyle"] == "dots"
    assert client.get("/api/settings").json()["canvasStyle"] == "dots"


def test_settings_sources_panel_ratio_clamp(client):
    """来源抽屉高度比例超出 0.15–0.7 时夹到边界。"""
    too_big = client.put("/api/settings", json={"sourcesPanelRatio": 0.9})
    assert too_big.status_code == 200
    assert too_big.json()["sourcesPanelRatio"] == 0.7

    too_small = client.put("/api/settings", json={"sourcesPanelRatio": 0.1})
    assert too_small.status_code == 200
    assert too_small.json()["sourcesPanelRatio"] == 0.15

    # 落库后再次读取保持一致
    data = client.get("/api/settings").json()
    assert data["sourcesPanelRatio"] == 0.15


def test_settings_update_and_mask(client):
    """保存 Key 后只返回脱敏值，模型与开关按提交值生效。"""
    key = "sk-test-1234567890"
    response = client.put(
        "/api/settings",
        json={
            "apiKey": key,
            "model": "deepseek-v4-pro",
            "thinkingEnabled": False,
            "suggestionCount": 5,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["hasKey"] is True
    # 前端拿不到明文 Key
    assert data["apiKeyMasked"] == "sk-••••7890"
    assert key not in response.text
    assert data["model"] == "deepseek-v4-pro"
    assert data["thinkingEnabled"] is False
    assert data["suggestionCount"] == 5

    # 再次读取仍拿到同样的脱敏结果
    again = client.get("/api/settings").json()
    assert again["apiKeyMasked"] == data["apiKeyMasked"]


def test_settings_empty_key_keeps_existing(client):
    """只改模型、apiKey 留空时，原 Key 不被清掉。"""
    client.put("/api/settings", json={"apiKey": "sk-keep-12345678"})
    client.put("/api/settings", json={"apiKey": "", "model": "deepseek-flash"})

    data = client.get("/api/settings").json()
    assert data["hasKey"] is True
    assert data["apiKeyMasked"] == "sk-••••5678"


def test_settings_card_size_clamp(client):
    """卡片尺寸只夹最小值、不设上限；GET 返回 camelCase 字段。"""
    # 传小于最小值的宽 → 夹到 280
    small = client.put("/api/settings", json={"cardWidth": 200})
    assert small.status_code == 200
    assert small.json()["cardWidth"] == 280
    assert small.json()["cardHeight"] == 560

    # 高度超过默认值不受上限限制
    tall = client.put("/api/settings", json={"cardHeight": 5000})
    assert tall.status_code == 200
    assert tall.json()["cardHeight"] == 5000
    assert tall.json()["cardWidth"] == 280

    # 落库后再次读取保持一致
    data = client.get("/api/settings").json()
    assert data["cardWidth"] == 280
    assert data["cardHeight"] == 5000


def test_settings_validation(client):
    """接口地址协议与候选数量范围不合法时返回 422。"""
    bad_url = client.put("/api/settings", json={"baseUrl": "ftp://example.com"})
    assert bad_url.status_code == 422

    bad_count = client.put("/api/settings", json={"suggestionCount": 9})
    assert bad_count.status_code == 422


def test_answer_uses_saved_settings(client, monkeypatch):
    """保存设置后，回答请求立即使用新的 Key、模型与思考开关（无需重启）。"""
    client.put(
        "/api/settings",
        json={
            "apiKey": "sk-runtime-key",
            "model": "deepseek-v4-pro",
            "thinkingEnabled": False,
            "suggestionCount": 4,
        },
    )

    project = client.post("/api/projects", json={"name": "设置生效"}).json()
    node_id = project["rootNode"]["id"]
    client.post(f"/api/nodes/{node_id}/question", json={"question": "测试设置"})

    captured: dict = {}

    async def fake_stream_chat(messages, runtime=None):
        captured.update(runtime or {})
        yield "delta", "好"

    async def fake_generate(node, count=None, used_texts=None, runtime=None):
        return []

    monkeypatch.setattr(llm, "stream_chat", fake_stream_chat)
    monkeypatch.setattr("app.api.nodes.suggestions.generate_suggestions", fake_generate)

    response = client.post(f"/api/nodes/{node_id}/answer")

    assert "event: done" in response.text
    assert captured["api_key"] == "sk-runtime-key"
    assert captured["model"] == "deepseek-v4-pro"
    assert captured["thinking_enabled"] is False
    assert captured["suggestion_count"] == 4
    assert captured["provider"] == "deepseek"


def test_provider_switch_keeps_both_keys(client):
    """切换服务商不覆盖另一家的 Key / 模型，两个 Key 各自脱敏。"""
    client.put(
        "/api/settings",
        json={"provider": "deepseek", "apiKey": "sk-ds-12345678", "model": "deepseek-flash"},
    )
    client.put(
        "/api/settings",
        json={
            "provider": "openai",
            "openaiApiKey": "sk-oa-abcdefgh",
            "openaiModel": "gpt-4o-mini",
            "openaiOrganization": "org-demo",
            "openaiProject": "proj-demo",
        },
    )

    data = client.get("/api/settings").json()
    assert data["provider"] == "openai"
    # DeepSeek 的配置仍然保留
    assert data["hasKey"] is True
    assert data["apiKeyMasked"] == "sk-••••5678"
    assert data["model"] == "deepseek-flash"
    # OpenAI 的配置独立脱敏
    assert data["openaiHasKey"] is True
    assert data["openaiApiKeyMasked"] == "sk-••••efgh"
    assert data["openaiOrganization"] == "org-demo"
    assert data["openaiProject"] == "proj-demo"

    # 切回 DeepSeek 后 OpenAI 的 Key 仍不丢失
    client.put("/api/settings", json={"provider": "deepseek"})
    back = client.get("/api/settings").json()
    assert back["provider"] == "deepseek"
    assert back["openaiApiKeyMasked"] == "sk-••••efgh"


def test_openai_values_clamped(client):
    """OpenAI 数值越界时夹到合法范围，非法推理强度回落 default。"""
    response = client.put(
        "/api/settings",
        json={
            "provider": "openai",
            "openaiTemperature": 3,
            "openaiMaxTokens": -1,
            "openaiTimeoutSeconds": 5,
            "openaiReasoningEffort": "bad",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "openai"
    assert data["openaiTemperature"] == 2.0
    assert data["openaiMaxTokens"] == 0
    assert data["openaiTimeoutSeconds"] == 10
    assert data["openaiReasoningEffort"] == "default"


def test_openai_request_params():
    """按服务商组装参数：OpenAI 不发送 DeepSeek thinking 参数。"""
    default_options = llm._resolve(
        {
            "provider": "openai",
            "api_key": "sk-oa",
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
        }
    )
    assert llm._request_params(default_options) == {"timeout": 60}

    custom_options = llm._resolve(
        {
            "provider": "openai",
            "api_key": "sk-oa",
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "openai_temperature_enabled": True,
            "openai_temperature": 0.5,
            "openai_max_tokens": 100,
            "openai_reasoning_effort": "medium",
            "openai_timeout_seconds": 30,
        }
    )
    assert llm._request_params(custom_options) == {
        "timeout": 30,
        "temperature": 0.5,
        "max_completion_tokens": 100,
        "reasoning_effort": "medium",
    }

    deepseek_options = llm._resolve(
        {"provider": "deepseek", "api_key": "sk-ds", "thinking_enabled": True}
    )
    assert llm._request_params(deepseek_options) == {
        "reasoning_effort": "high",
        "extra_body": {"thinking": {"type": "enabled"}},
    }
