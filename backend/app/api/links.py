"""笔记连接 API：回答卡片（chat）与笔记卡片（note）之间的连接关系。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.projects import _get_project_or_404
from app.db import get_db
from app.models import ConversationNode, NoteLink, User
from app.schemas import NoteLinkCreate, NoteLinkOut, NoteLinksSync
from app.services.auth import require_user

router = APIRouter(prefix="/api/projects", tags=["links"])


def _validate_pair(
    db: Session, project_id: str, item: NoteLinkCreate
) -> tuple[ConversationNode, ConversationNode]:
    """校验一条连接：同画布、起点为回答卡片、终点为笔记卡片、且不能是同一节点。"""
    if item.answer_node_id == item.note_node_id:
        raise HTTPException(status_code=400, detail="回答卡片与笔记卡片不能相同")

    answer = db.get(ConversationNode, item.answer_node_id)
    if answer is None or answer.project_id != project_id:
        raise HTTPException(status_code=400, detail="回答卡片不属于该画布")
    note = db.get(ConversationNode, item.note_node_id)
    if note is None or note.project_id != project_id:
        raise HTTPException(status_code=400, detail="笔记卡片不属于该画布")
    if answer.node_type != "chat":
        raise HTTPException(status_code=400, detail="连接的起点必须是回答卡片")
    if note.node_type != "note":
        raise HTTPException(status_code=400, detail="连接的终点必须是笔记卡片")
    return answer, note


def _link_dto(link: NoteLink) -> dict:
    """连接 ORM 转 camelCase 字典。"""
    return NoteLinkOut.model_validate(link).model_dump(by_alias=True)


def _project_links(db: Session, project_id: str) -> list[NoteLink]:
    """取画布全部连接，按创建时间排序。"""
    return list(
        db.scalars(
            select(NoteLink)
            .where(NoteLink.project_id == project_id)
            .order_by(NoteLink.created_at)
        ).all()
    )


@router.get("/{project_id}/links")
def list_links(
    project_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> list[dict]:
    """列出画布的全部笔记连接。"""
    _get_project_or_404(db, project_id, user)
    return [_link_dto(link) for link in _project_links(db, project_id)]


@router.post("/{project_id}/links")
def create_link(
    project_id: str,
    payload: NoteLinkCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """新建一条连接；已存在的组合幂等返回原记录。"""
    _get_project_or_404(db, project_id, user)
    answer, note = _validate_pair(db, project_id, payload)

    existing = db.scalar(
        select(NoteLink).where(
            NoteLink.project_id == project_id,
            NoteLink.answer_node_id == answer.id,
            NoteLink.note_node_id == note.id,
        )
    )
    if existing is not None:
        return _link_dto(existing)

    link = NoteLink(
        project_id=project_id,
        answer_node_id=answer.id,
        note_node_id=note.id,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _link_dto(link)


@router.delete("/{project_id}/links/{link_id}")
def delete_link(
    project_id: str,
    link_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """删除一条连接。"""
    _get_project_or_404(db, project_id, user)
    link = db.get(NoteLink, link_id)
    if link is None or link.project_id != project_id:
        raise HTTPException(status_code=404, detail="连接不存在")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.put("/{project_id}/links")
def sync_links(
    project_id: str,
    payload: NoteLinksSync,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> list[dict]:
    """全量覆盖连接（撤销用）：先整体校验，再删除重建，保证失败时不部分写入。"""
    _get_project_or_404(db, project_id, user)

    # 先全量校验并去重，任意一项非法直接 400，此时尚未改动数据库
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in payload.links:
        answer, note = _validate_pair(db, project_id, item)
        key = (answer.id, note.id)
        if key in seen:
            continue
        seen.add(key)
        pairs.append(key)

    db.execute(delete(NoteLink).where(NoteLink.project_id == project_id))
    links = [
        NoteLink(
            project_id=project_id,
            answer_node_id=answer_id,
            note_node_id=note_id,
        )
        for answer_id, note_id in pairs
    ]
    db.add_all(links)
    db.commit()
    for link in links:
        db.refresh(link)
    return [_link_dto(link) for link in links]
