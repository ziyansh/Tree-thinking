"""模型客户端：DeepSeek 与 OpenAI 均按 OpenAI 兼容协议调用。

Key 与模型名只来自后端（数据库「设置」优先，其次 backend/.env），前端不参与。
请求参数按服务商分流：DeepSeek 使用 thinking 专有参数，OpenAI 使用
temperature / max_completion_tokens / reasoning_effort / timeout。
"""

from typing import AsyncIterator

from openai import AsyncOpenAI

from app import config
from app.services.search import normalize_tool_source


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


def _request_params(
    options: dict,
    enable_title: bool = False,
    tools: list[dict] | None = None,
) -> dict:
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

    # DeepSeek：思考模式默认开启，关闭时必须显式传 disabled，否则模型仍会思考
    params = {}
    extra_body: dict = {}
    if options["thinking_enabled"]:
        params["reasoning_effort"] = "high"
        extra_body["thinking"] = {"type": "enabled"}
    else:
        extra_body["thinking"] = {"type": "disabled"}
    # 会话标题与思考开关共用 extra_body，可同时生效
    if enable_title:
        extra_body["title"] = {"enabled": True}
    if extra_body:
        params["extra_body"] = extra_body
    # 服务端联网工具在 Chat Completions 顶层声明；不能用 tool_choice 强制
    if tools:
        params["tools"] = tools
    return params


def _extra(obj, name: str):
    """读取 SDK 未声明的扩展字段：优先 model_extra，其次普通属性。"""
    if obj is None:
        return None
    extra = getattr(obj, "model_extra", None) or {}
    if name in extra:
        return extra[name]
    return getattr(obj, name, None)


def _extract_sources(raw) -> list[dict]:
    """把工具结果里的来源数组归一化为前端结构。"""
    if not isinstance(raw, list):
        return []
    return [normalize_tool_source(item) for item in raw if isinstance(item, dict)]


def _sources_from_steps(steps) -> list[dict]:
    """从最后 chunk 的 delta.server_tool_calls（按步分组）里收集来源。"""
    sources: list[dict] = []
    for step in steps if isinstance(steps, list) else []:
        if not isinstance(step, dict):
            continue
        for call in step.get("calls") or []:
            if isinstance(call, dict):
                sources.extend(_extract_sources(call.get("sources")))
    return sources


def _sources_from_annotations(raw) -> list[dict]:
    """从最后 chunk 的 delta.annotations（url_citation 引用）里收集来源。"""
    sources: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        citation = item.get("url_citation")
        if isinstance(citation, dict):
            sources.extend(_extract_sources([citation]))
    return sources


async def stream_chat(
    messages: list[dict],
    runtime: dict | None = None,
    enable_title: bool = False,
    tools: list[dict] | None = None,
) -> AsyncIterator[tuple[str, object]]:
    """流式请求模型，逐段产出增量。

    常规产出 ("reasoning", 文本) 与 ("delta", 文本)；
    DeepSeek 扩展字段另外产出 ("title", 标题)、("sources", 来源列表)
    与 ("tool_use", "")（出现过服务端工具调用，用于禁止继续生成）。
    """
    options = _resolve(runtime)
    try:
        stream = await _get_client(options).chat.completions.create(
            model=options["model"],
            messages=messages,
            stream=True,
            **_request_params(options, enable_title, tools),
        )
        used_tool = False
        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            # server_tool_event 与 delta 并列：call_completed 里带本次搜索的来源
            event = _extra(choice, "server_tool_event")
            if isinstance(event, dict):
                if event.get("type") == "call_started":
                    used_tool = True
                elif event.get("type") == "call_completed":
                    used_tool = True
                    call = event.get("call") or {}
                    found = _extract_sources(call.get("sources"))
                    if found:
                        yield "sources", found
            delta = choice.delta
            # 思考过程增量；OpenAI 官方不返回，兼容代理可能返回，忽略空增量
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                yield "reasoning", reasoning
            if delta.content:
                yield "delta", delta.content
            # 会话标题出现在最后一个 chunk 的 delta.title
            title = _extra(delta, "title")
            if title:
                yield "title", str(title)
            # 完整的工具调用与引用只在带 finish_reason 的最后一个 chunk 出现
            steps = _extra(delta, "server_tool_calls")
            if steps:
                used_tool = True
                found = _sources_from_steps(steps)
                if found:
                    yield "sources", found
            found = _sources_from_annotations(_extra(delta, "annotations"))
            if found:
                yield "sources", found
        if used_tool:
            yield "tool_use", ""
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
