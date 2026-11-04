"""候选方向生成：基于最近一轮问答生成 N 条追问方向，并做解析与降级。

调用 DeepSeek 的 JSON Output（response_format=json_object）；解析失败时
按纯文本逐行降级，最终仍失败则用内置兜底方向，保证不影响正常回答。
"""

import json
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.models import ConversationNode
from app.services import llm

# 单条候选方向的字数上限（spec：不超过 20 个汉字）
MAX_TEXT_LENGTH = 20
# 生成数量范围（spec：默认 3、可配置 2–6）
MIN_COUNT = 2
MAX_COUNT = 6

# 兜底方向：模型失败或生成不足时补齐，保证前端箭头始终有内容
FALLBACK_TEXTS = [
    "换个角度分析这个问题",
    "这里的关键前提是什么",
    "给出一个具体例子",
    "有哪些常见的误区",
    "下一步可以怎么做",
    "有没有相反的观点",
]


def _normalize(text: str) -> str:
    """去掉全部空白后用于比较，避免「 方向A 」与「方向A」被当成两条。"""
    return re.sub(r"\s+", "", text)


def _from_lines(raw: str) -> list[str]:
    """纯文本降级：按行切分，去掉空行与序号/项目符号前缀。"""
    result: list[str] = []
    for line in raw.splitlines():
        text = line.strip()
        # 兼容「1. 方向」「- 方向」「• 方向」这类列表前缀
        text = re.sub(r"^[0-9一二三四五六七八九十]+[.、)）]\s*", "", text)
        text = re.sub(r"^[-•*]\s*", "", text)
        if text:
            result.append(text[:MAX_TEXT_LENGTH])
    return result


def _from_items(items: list) -> list[str]:
    """从数组元素取文本：兼容 {"text": ...} 与纯字符串两种形态。"""
    result: list[str] = []
    for item in items:
        if isinstance(item, dict):
            value = item.get("text")
        else:
            value = item
        if not isinstance(value, str):
            continue
        text = value.strip()
        if text:
            result.append(text[:MAX_TEXT_LENGTH])
    return result


def parse_suggestions(raw: str) -> list[str]:
    """解析模型输出，容错优先级：suggestions 字段 → 顶层数组 → 纯文本按行。

    空 content、非法 JSON 都降级为按行切分；仍为空时返回空列表。
    """
    text = (raw or "").strip()
    if not text:
        return []

    try:
        data = json.loads(text)
    except ValueError:
        # JSON Output 可能把非 JSON 内容替换为空格，这里统一按纯文本降级
        return _from_lines(text)

    if isinstance(data, dict):
        items = data.get("suggestions")
        return _from_items(items) if isinstance(items, list) else []
    if isinstance(data, list):
        return _from_items(data)
    return []


def _build_messages(node, count: int, used_texts: list[str]) -> list[dict]:
    """拼候选方向的 messages：system 说明规则与输出样例，user 给出当前问答。"""
    question = (getattr(node, "question", "") or "").strip()
    answer = (getattr(node, "answer", "") or "").strip()
    used = "、".join(used_texts) if used_texts else "（无）"

    system = (
        "你是对话画布的候选方向生成器。基于用户最近一轮问答，"
        f"给出 {count} 个用户可能继续追问的方向。"
        "要求：每条不超过 20 个汉字；各条视角互不重复；"
        "不要与已存在方向重复；只输出 json，不要任何解释。"
        '输出格式示例：{"suggestions":[{"text":"方向一"},{"text":"方向二"}]}'
    )
    user = (
        f"当前问题：{question}\n\n"
        f"当前回答：{answer}\n\n"
        f"已存在方向：{used}\n\n"
        f"请给出 {count} 个新的追问方向，只输出 json，"
        '格式为 {"suggestions":[{"text":"..."},{"text":"..."}]}'
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def generate_suggestions(
    node,
    count: int | None = None,
    used_texts: list[str] | None = None,
    runtime: dict | None = None,
) -> list[dict]:
    """生成候选方向列表，每项为 {"id", "text"}。

    runtime 为当前生效的模型设置（可为空，空时全部用 .env 默认值）。
    任何解析或请求错误都不向外抛出：记录日志后返回兜底方向，
    保证调用方（流式回答与重新生成）不被建议生成失败拖垮。
    """
    # 数量夹到 2–6；未指定时取设置里的值（数据库 > .env）
    default_count = (runtime or {}).get("suggestion_count", config.SUGGESTION_COUNT)
    try:
        wanted = int(default_count if count is None else count)
    except (TypeError, ValueError):
        wanted = int(default_count)
    wanted = max(MIN_COUNT, min(MAX_COUNT, wanted))

    # 已使用的方向文本（去空白后比较），用于去重
    blocked = {_normalize(text) for text in (used_texts or []) if text}

    texts: list[str] = []
    try:
        raw = await llm.complete_json(
            _build_messages(node, wanted, list(used_texts or [])),
            max_tokens=400,
            runtime=runtime,
        )
        for text in parse_suggestions(raw):
            key = _normalize(text)
            if not key or key in blocked:
                continue
            blocked.add(key)
            texts.append(text)
    except Exception as exc:  # 请求失败、内容为空等都降级为兜底方向
        logging.warning("生成候选方向失败，改用兜底方向：%s", exc)
        texts = []

    chosen = texts[:wanted]
    # 不足 count 时用兜底方向补齐（跳过与已用/已选重复的项）
    for fallback in FALLBACK_TEXTS + FALLBACK_TEXTS:
        if len(chosen) >= wanted:
            break
        key = _normalize(fallback)
        if key in blocked:
            continue
        blocked.add(key)
        chosen.append(fallback)

    return [{"id": uuid.uuid4().hex[:8], "text": text} for text in chosen]


def used_suggestion_ids(db: Session, node: ConversationNode) -> set[str]:
    """取该节点下已创建子卡片所对应的建议 id 集合（用于保留已用建议）。"""
    rows = db.scalars(
        select(ConversationNode.suggestion_id).where(
            ConversationNode.parent_id == node.id,
            ConversationNode.suggestion_id.isnot(None),
        )
    ).all()
    return {str(row) for row in rows if row}
