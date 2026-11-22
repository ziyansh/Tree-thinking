"""模型客户端：DeepSeek、火山方舟（ark）与 OpenAI 均按 OpenAI 兼容协议调用。

Key 与模型名只来自后端（数据库「设置」优先，其次 backend/.env），前端不参与。
请求参数按服务商分流：DeepSeek 使用 thinking 专有参数，OpenAI 使用
temperature / max_completion_tokens / reasoning_effort / timeout。
火山方舟的基础对话走 Chat Completions（thinking 扩展字段），
联网搜索走 Responses API 的 web_search 工具。
"""

import json
from typing import AsyncIterator

import httpx
from openai import AsyncOpenAI

from app import config
from app.services.search import normalize_tool_source


class LLMError(Exception):
    """模型调用异常；message 为可直接展示给用户的中文提示。"""


# 上下文超限错误的识别关键字：统一转成可执行的中文提示
_CONTEXT_ERROR_HINTS = (
    "input too long",
    "tokens exceeds",
    "maximum context",
    "context length",
    "too many tokens",
)


def _friendly_error(exc: Exception) -> str:
    """把底层异常转成用户可理解的提示；上下文超限时给出处理建议。"""
    text = str(exc)
    lowered = text.lower()
    if any(hint in lowered for hint in _CONTEXT_ERROR_HINTS):
        return (
            "上下文超过模型上限：附件或历史内容过长，请减少附件（尤其是页数较多的 PDF）、"
            "删减历史分支或改用上下文更大的模型后重试。\n原始错误：" + text
        )
    return f"模型调用失败：{text}"


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

    if provider == "ark":
        return {
            "provider": "ark",
            "api_key": (values.get("api_key") or config.ARK_API_KEY or "").strip(),
            "base_url": (values.get("base_url") or config.ARK_BASE_URL).strip(),
            "model": (values.get("model") or config.ARK_MODEL).strip(),
            "thinking_enabled": bool(
                values.get("thinking_enabled", config.THINKING_ENABLED)
            ),
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

    if options["provider"] == "ark":
        # 火山方舟：thinking 是顶层扩展字段，用 extra_body 透传；
        # 推理强度不传，联网工具由 Responses API 分支单独处理。
        return {
            "extra_body": {
                "thinking": {
                    "type": "enabled" if options["thinking_enabled"] else "disabled"
                }
            }
        }

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
    """从最后 chunk 的 delta.server_tool_calls（按步分组）里收集来源。

    搜索结果在 call.sources 中；打开 / 阅读网页时展示信息在 call.page 中，
    这里一并归一化为来源，保证引用角标能在 sources 里找到对应条目。
    去重仍交给调用方的 merge_sources。
    """
    sources: list[dict] = []
    for step in steps if isinstance(steps, list) else []:
        if not isinstance(step, dict):
            continue
        for call in step.get("calls") or []:
            if not isinstance(call, dict):
                continue
            sources.extend(_extract_sources(call.get("sources")))
            page = call.get("page")
            if isinstance(page, dict):
                sources.extend(_extract_sources([page]))
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


def _ark_source(item: dict) -> dict:
    """火山方舟来源归一化：publish_time 映射为统一的日期字段。"""
    data = dict(item)
    if not data.get("published_at") and data.get("publish_time"):
        data["published_at"] = data["publish_time"]
    return normalize_tool_source(data)


def _ark_content_text(content) -> str:
    """把消息 content 压平成纯文本；附件内容块由附件扩展另行处理。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "\n".join(parts)
    return str(content or "")


def _ark_user_content(content) -> list[dict]:
    """把 user 消息内容转成 Responses API 内容块：文本 + 已上传的 PDF / 图片。

    联网路径的附件支持 PDF（input_file）与图片（input_image）；
    视频 / 音频在 Responses 的字段尚未确认，暂时跳过。
    """
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    parts: list[dict] = []
    texts: list[str] = []
    for part in content if isinstance(content, list) else []:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            texts.append(str(part.get("text") or ""))
        elif part.get("type") == "file":
            file = part.get("file") if isinstance(part.get("file"), dict) else {}
            file_id = file.get("file_id")
            if file_id:
                parts.append({"type": "input_file", "file_id": str(file_id)})
        elif part.get("type") == "image_url":
            image = part.get("image_url") if isinstance(part.get("image_url"), dict) else {}
            file_id = image.get("file_id")
            if file_id:
                parts.append({"type": "input_image", "file_id": str(file_id)})
    text = "\n".join(texts)
    # 没有附件时保留空文本块，保证消息结构完整
    if text or not parts:
        parts.append({"type": "input_text", "text": text})
    return parts


def _ark_input(messages: list[dict]) -> tuple[str, list[dict]]:
    """把 Chat Completions 的 messages 转成 Responses API 的 instructions + input。

    system 消息合并为 instructions，user / assistant 转为 input 项；
    user 消息中的 PDF 附件转成 input_file，其它附件类型跳过。
    """
    instructions: list[str] = []
    items: list[dict] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        text = _ark_content_text(message.get("content"))
        if role == "system":
            if text:
                instructions.append(text)
            continue
        if role == "assistant":
            items.append(
                {"role": "assistant", "content": [{"type": "output_text", "text": text}]}
            )
        else:
            items.append(
                {"role": "user", "content": _ark_user_content(message.get("content"))}
            )
    return "\n\n".join(instructions), items


async def _ark_web_search_stream(
    messages: list[dict], options: dict
) -> AsyncIterator[tuple[str, object]]:
    """火山方舟联网搜索：走 Responses API 的 web_search 工具并解析 SSE。

    产出与 stream_chat 一致的事件：delta / reasoning / sources。
    来源只用于前端「来源」抽屉，不生成正文 [n] 角标。
    """
    instructions, input_items = _ark_input(messages)
    payload: dict = {
        "model": options["model"],
        "input": input_items,
        "stream": True,
        "tools": [{"type": "web_search", "sources": ["doubao"]}],
        "thinking": {
            "type": "enabled" if options["thinking_enabled"] else "disabled"
        },
    }
    if instructions:
        payload["instructions"] = instructions

    base = (options["base_url"] or "").rstrip("/")
    url = f"{base}/responses"
    headers = {
        "Authorization": f"Bearer {options.get('api_key') or ''}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST", url, json=payload, headers=headers
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                detail = body.decode("utf-8", errors="ignore")[:200]
                raise LLMError(
                    f"火山方舟联网搜索请求失败（{response.status_code}）：{detail}"
                )

            event_name = ""
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    event_name = line[len("event:"):].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                raw = line[len("data:"):].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(event, dict):
                    continue

                kind = event.get("type") or event_name
                if kind == "response.output_text.delta":
                    text = event.get("delta")
                    if text:
                        yield "delta", str(text)
                elif kind in (
                    "response.reasoning_text.delta",
                    "response.reasoning_summary_text.delta",
                ):
                    text = event.get("delta")
                    if text:
                        yield "reasoning", str(text)
                elif kind == "response.output_text.annotation.added":
                    annotation = event.get("annotation")
                    if isinstance(annotation, dict):
                        source = _ark_source(annotation)
                        if source.get("url"):
                            yield "sources", [source]
                elif kind == "response.web_search_call.completed":
                    found = _ark_sources_from_event(event)
                    if found:
                        yield "sources", found
                elif kind == "response.completed":
                    return
                elif kind in ("error", "response.failed"):
                    error = event.get("error")
                    detail = ""
                    if isinstance(error, dict):
                        detail = str(error.get("message") or "")
                    detail = detail or str(event.get("message") or "")
                    raise LLMError(f"火山方舟联网搜索失败：{detail or '未知错误'}")


def _ark_sources_from_event(event: dict) -> list[dict]:
    """从 web_search_call.completed 事件里收集来源（兼容 results / sources）。"""
    raw = event.get("results") or event.get("sources")
    if not isinstance(raw, list):
        call = event.get("web_search_call")
        if isinstance(call, dict):
            raw = call.get("results") or call.get("sources")
    if not isinstance(raw, list):
        return []
    found = [_ark_source(item) for item in raw if isinstance(item, dict)]
    return [item for item in found if item.get("url")]


async def stream_chat(
    messages: list[dict],
    runtime: dict | None = None,
    enable_title: bool = False,
    tools: list[dict] | None = None,
    web_search: bool = False,
) -> AsyncIterator[tuple[str, object]]:
    """流式请求模型，逐段产出增量。

    常规产出 ("reasoning", 文本) 与 ("delta", 文本)；
    DeepSeek 扩展字段另外产出 ("title", 标题)、("sources", 来源列表)、
    ("annotations", 引用列表) 与 ("tool_use", "")（出现过服务端工具调用，用于禁止继续生成）。
    火山方舟在 web_search=True 时走 Responses API，联网来源以 ("sources", 列表) 产出。
    """
    options = _resolve(runtime)
    try:
        if options["provider"] == "ark" and web_search:
            async for item in _ark_web_search_stream(messages, options):
                yield item
            return

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
            # 引用同时用于提取来源与生成正文角标，原始列表一并传出
            raw_annotations = _extra(delta, "annotations")
            if isinstance(raw_annotations, list) and raw_annotations:
                found = _sources_from_annotations(raw_annotations)
                if found:
                    yield "sources", found
                # 由调用方在落库前转成正文 [n] 角标
                yield "annotations", list(raw_annotations)
        if used_tool:
            yield "tool_use", ""
    except LLMError:
        raise
    except Exception as exc:
        # 统一转成中文提示，避免把英文异常直接暴露给用户
        raise LLMError(_friendly_error(exc)) from exc


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
        raise LLMError(_friendly_error(exc)) from exc

    # 空响应或无内容时返回空串，由调用方决定如何降级
    if not response.choices:
        return ""
    return response.choices[0].message.content or ""
