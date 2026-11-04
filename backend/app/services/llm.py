"""模型客户端：DeepSeek 与 OpenAI 均按 OpenAI 兼容协议调用。

Key 与模型名只来自后端（数据库「设置」优先，其次 backend/.env），前端不参与。
请求参数按服务商分流：DeepSeek 使用 thinking 专有参数，OpenAI 使用
temperature / max_completion_tokens / reasoning_effort / timeout。
"""

from typing import AsyncIterator

from openai import AsyncOpenAI

from app import config


class LLMError(Exception):
    """模型调用异常；message 为可直接展示给用户的中文提示。"""


# 按客户端配置缓存实例；设置改动后自动切到新客户端
_clients: dict[tuple[str, str, str, str], AsyncOpenAI] = {}


def _get_client(options: dict) -> AsyncOpenAI:
    """取得（必要时创建）当前服务商的客户端。"""
    cache_key = (
        options["api_key"],
        options["base_url"],
        options.get("organization", ""),
        options.get("project", ""),
    )
    client = _clients.get(cache_key)
    if client is None:
        client = AsyncOpenAI(
            api_key=options["api_key"],
            base_url=options["base_url"],
            organization=options.get("organization") or None,
            project=options.get("project") or None,
        )
        _clients[cache_key] = client
    return client


def _resolve(runtime: dict | None) -> dict:
    """把运行时设置与环境变量合并；runtime 为空时全部用环境变量。"""
    values = runtime or {}
    provider = values.get("provider") or "deepseek"

    if provider == "openai":
        return {
            "provider": "openai",
            "api_key": (values.get("api_key") or config.OPENAI_API_KEY or "").strip(),
            "base_url": (values.get("base_url") or config.OPENAI_BASE_URL).strip(),
            "model": (values.get("model") or config.OPENAI_MODEL).strip(),
            "organization": (values.get("openai_organization") or "").strip(),
            "project": (values.get("openai_project") or "").strip(),
            "temperature_enabled": bool(
                values.get("openai_temperature_enabled", False)
            ),
            "temperature": float(values.get("openai_temperature", 1.0)),
            "max_tokens": int(values.get("openai_max_tokens", 0) or 0),
            "reasoning_effort": values.get("openai_reasoning_effort") or "default",
            "timeout_seconds": int(values.get("openai_timeout_seconds", 60) or 60),
        }

    return {
        "provider": "deepseek",
        "api_key": (values.get("api_key") or config.DEEPSEEK_API_KEY or "").strip(),
        "base_url": (values.get("base_url") or config.DEEPSEEK_BASE_URL).strip(),
        "model": (values.get("model") or config.DEEPSEEK_MODEL).strip(),
        "thinking_enabled": bool(
            values.get("thinking_enabled", config.THINKING_ENABLED)
        ),
    }


def _request_params(options: dict) -> dict:
    """按服务商组装请求参数；未启用的可选参数一律不发送。"""
    if options["provider"] == "openai":
        params: dict = {"timeout": options["timeout_seconds"]}
        # 推理模型不支持 temperature，默认不发送，由用户显式开启
        if options["temperature_enabled"]:
            params["temperature"] = options["temperature"]
        if options["max_tokens"] > 0:
            params["max_completion_tokens"] = options["max_tokens"]
        if options["reasoning_effort"] != "default":
            params["reasoning_effort"] = options["reasoning_effort"]
        return params

    # DeepSeek：思考模式开启时发送专有参数
    if not options["thinking_enabled"]:
        return {}
    return {
        "reasoning_effort": "high",
        "extra_body": {"thinking": {"type": "enabled"}},
    }


async def stream_chat(
    messages: list[dict], runtime: dict | None = None
) -> AsyncIterator[tuple[str, str]]:
    """流式请求模型，逐段产出 ("reasoning", 文本) 或 ("delta", 文本)。"""
    options = _resolve(runtime)
    try:
        stream = await _get_client(options).chat.completions.create(
            model=options["model"],
            messages=messages,
            stream=True,
            **_request_params(options),
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            # 思考过程增量；OpenAI 官方不返回，兼容代理可能返回，忽略空增量
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                yield "reasoning", reasoning
            if delta.content:
                yield "delta", delta.content
    except LLMError:
        raise
    except Exception as exc:
        # 统一转成中文提示，避免把英文异常直接暴露给用户
        raise LLMError(f"模型调用失败：{exc}") from exc


async def complete_json(
    messages: list[dict], max_tokens: int = 400, runtime: dict | None = None
) -> str:
    """非流式请求，要求 JSON 输出，返回 content 文本（供候选方向生成使用）。"""
    options = _resolve(runtime)
    params = _request_params(options)
    if options["provider"] == "openai":
        # 候选方向本身要有输出上限：用户配置更小时取更小值，未配置时用 400
        configured = options["max_tokens"]
        params["max_completion_tokens"] = (
            min(configured, max_tokens) if configured > 0 else max_tokens
        )
    else:
        params["max_tokens"] = max_tokens

    try:
        response = await _get_client(options).chat.completions.create(
            model=options["model"],
            messages=messages,
            response_format={"type": "json_object"},
            **params,
        )
    except Exception as exc:
        raise LLMError(f"模型调用失败：{exc}") from exc

    # 空响应或无内容时返回空串，由调用方决定如何降级
    if not response.choices:
        return ""
    return response.choices[0].message.content or ""
