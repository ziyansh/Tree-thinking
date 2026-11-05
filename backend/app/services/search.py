"""联网搜索：请求 DeepSeek 的搜索工具接口，并把结果归一化为前端可用结构。

这里只负责发起请求与数据清洗，是否启用由调用方按服务商与 Key 判断。
任何失败（超时、非 200、异常）都只记日志并返回空列表，不影响回答流程。
"""

import logging

import httpx

# 每次搜索请求的结果条数
SEARCH_COUNT = 10
# 摘要截断长度，避免把超长正文塞进系统提示词
SUMMARY_MAX_CHARS = 800


def _endpoint(base_url: str) -> str:
    """拼接搜索接口地址：base 已带 /v1 时直接接 /tools/search。"""
    base = (base_url or "").rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/tools/search"
    return f"{base}/v1/tools/search"


def _normalize(item: dict) -> dict:
    """单条结果转 camelCase；缺失字段用空串，日期允许为 None。"""
    summary = str(item.get("summary") or "")
    return {
        "title": item.get("title") or "",
        "url": item.get("url") or "",
        "snippet": item.get("snippet") or "",
        "summary": summary[:SUMMARY_MAX_CHARS],
        "siteName": item.get("site_name") or item.get("siteName") or "",
        "date": item.get("date") or None,
    }


async def search_web(query: str, runtime: dict) -> list[dict]:
    """根据运行时设置发起联网搜索，返回最多 10 条归一化结果。"""
    url = _endpoint(runtime.get("base_url") or "")
    payload = {
        "query": query,
        "count": SEARCH_COUNT,
        "need_content": False,
        "ori_question": query,
    }
    headers = {"Authorization": f"Bearer {runtime.get('api_key') or ''}"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json=payload, headers=headers)
    except Exception as exc:  # 网络异常、超时等一律降级为空结果
        logging.warning("联网搜索请求失败：%s", exc)
        return []

    if response.status_code != 200:
        logging.warning("联网搜索返回非 200 状态码：%s", response.status_code)
        return []

    try:
        data = response.json()
    except ValueError:
        logging.warning("联网搜索返回内容不是合法 JSON")
        return []

    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []

    return [
        _normalize(item)
        for item in results[:SEARCH_COUNT]
        if isinstance(item, dict)
    ]
