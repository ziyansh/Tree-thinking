"""搜索 API：在当前画布或全部画布内检索卡片文本，server 模式按账号隔离。"""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ConversationNode, Project, User
from app.services.auth import require_user

router = APIRouter(prefix="/api/search", tags=["search"])

# 单次搜索最多返回的条目数，避免超大画布一次渲染过多结果
MAX_ITEMS = 60
# 片段中命中位置前后的保留字符数
SNIPPET_PAD = 48


def _iso(value: datetime | None) -> str:
    """时间转 ISO 字符串；旧数据为空时返回空串。"""
    return value.isoformat() if value else ""


def _snippet(text: str, needle: str) -> str | None:
    """返回命中位置附近的单行片段；未命中返回 None。"""
    if not text:
        return None
    position = text.lower().find(needle)
    if position < 0:
        return None
    start = max(0, position - SNIPPET_PAD)
    end = min(len(text), position + len(needle) + SNIPPET_PAD)
    # 折叠换行与连续空白，避免结果列表出现大段空行
    body = " ".join(text[start:end].split())
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{body}{suffix}"


@router.get("")
def search_all(
    q: str = "",
    project_id: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """按关键词搜索画布名称与卡片标题、正文；project_id 为空时搜索全部画布。"""
    term = (q or "").strip()
    if not term:
        return {"query": q, "items": [], "truncated": False}

    # server 模式只搜索本人的画布；project_id 越权时查不到画布，自然返回空结果
    project_query = select(Project)
    if user is not None:
        project_query = project_query.where(Project.owner_id == user.id)
    if project_id:
        project_query = project_query.where(Project.id == project_id)
    projects = db.scalars(project_query.order_by(Project.updated_at.desc())).all()
    if not projects:
        return {"query": q, "items": [], "truncated": False}

    needle = term.lower()
    names = {project.id: project.name for project in projects}
    items: list[dict] = []

    # 画布名称命中：nodeId 为空，点击结果只需切换到该画布
    for project in projects:
        snippet = _snippet(project.name, needle)
        if snippet is None:
            continue
        items.append(
            {
                "projectId": project.id,
                "projectName": project.name,
                "nodeId": None,
                "nodeType": "project",
                "field": "project",
                "snippet": snippet,
                "updatedAt": _iso(project.updated_at),
            }
        )

    nodes = db.scalars(
        select(ConversationNode)
        .where(ConversationNode.project_id.in_(list(names)))
        .order_by(ConversationNode.updated_at.desc())
    ).all()

    for node in nodes:
        # 笔记卡片：question 是标题、answer 是正文；问答卡片：卡片标题 + 回答
        for field, text in (("title", node.question), ("answer", node.answer)):
            snippet = _snippet(text or "", needle)
            if snippet is None:
                continue
            items.append(
                {
                    "projectId": node.project_id,
                    "projectName": names.get(node.project_id, ""),
                    "nodeId": node.id,
                    "nodeType": node.node_type or "chat",
                    "field": field,
                    "snippet": snippet,
                    "updatedAt": _iso(node.updated_at),
                }
            )

    return {
        "query": q,
        "items": items[:MAX_ITEMS],
        "truncated": len(items) > MAX_ITEMS,
    }
