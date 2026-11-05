"""分支上下文：把「根 → 当前节点」的唯一路径拼成 DeepSeek messages。

DeepSeek 的 /chat/completions 是无状态的，每次请求都要传完整历史；
这里只沿 parent_id 上溯，兄弟分支的问答不会进入上下文。
"""

from typing import Callable

from sqlalchemy.orm import Session

from app.models import ConversationNode

# 上溯层数上限，防止数据异常（断链或成环）导致死循环
MAX_DEPTH = 200

# 系统提示词：约束回答风格，避免模型臆造事实
SYSTEM_PROMPT = (
    "你是一个严谨的思考助手。请用 Markdown 简洁地回答用户的问题；"
    "只依据已知事实与上下文作答，不臆造事实，不确定时请明确说明。"
)


def _user_content(
    node: ConversationNode,
    attachments_for: Callable[[ConversationNode], tuple[str, list[dict]]] | None,
) -> str | list[dict]:
    """拼一条 user 消息的 content：有附件文本则追加，有图片则改用内容块数组。"""
    if attachments_for is None:
        return node.question
    extra_text, images = attachments_for(node)
    content = node.question + (extra_text or "")
    if images:
        return [{"type": "text", "text": content}, *images]
    return content


def build_messages(
    path: list[ConversationNode],
    attachments_for: Callable[[ConversationNode], tuple[str, list[dict]]] | None = None,
) -> list[dict]:
    """把祖先路径拼成 messages 列表（纯函数，不查库，便于单测）。

    path 顺序为「根 → 当前节点」，最后一项是待回答节点。
    祖先只回传问题与最终回答，绝不包含 reasoning（思考过程不进上下文）。
    attachments_for 为空时保持旧的纯文本行为；传入时按节点注入附件文本与图片。
    """
    if not path:
        return []

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for ancestor in path[:-1]:
        messages.append(
            {"role": "user", "content": _user_content(ancestor, attachments_for)}
        )
        messages.append({"role": "assistant", "content": ancestor.answer})
    messages.append(
        {"role": "user", "content": _user_content(path[-1], attachments_for)}
    )
    return messages


def get_path(db: Session, node: ConversationNode) -> list[ConversationNode]:
    """从当前节点沿 parent_id 上溯到根，返回「根 → 当前」顺序的路径。"""
    path: list[ConversationNode] = [node]
    current = node
    # 最多上溯 MAX_DEPTH 层，断链（父节点已不存在）时提前结束
    for _ in range(MAX_DEPTH - 1):
        if current.parent_id is None:
            break
        parent = db.get(ConversationNode, current.parent_id)
        if parent is None:
            break
        path.append(parent)
        current = parent
    path.reverse()
    return path
