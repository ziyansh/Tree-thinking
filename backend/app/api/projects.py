"""画布 API：列表、创建（自动建根节点）、改名/视口、删除、取图、建子节点、笔记与快照。"""

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import ConversationNode, Project
from app.schemas import (
    NoteCreate,
    NodeCreate,
    ProjectCreate,
    ProjectListItem,
    ProjectOut,
    ProjectPatch,
    RestoreRequest,
)
from app.services import naming
from app.services import settings as runtime_settings
from app.services.graph import (
    NOTE_DEFAULT_HEIGHT,
    NOTE_DEFAULT_WIDTH,
    next_child_position,
    node_to_dto,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _saves_dir() -> Path:
    """快照目录：与数据库同级的 saves/（默认 backend/data/saves），不存在时自动创建。"""
    path = config.DB_PATH.parent / "saves"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _project_dto(project: Project) -> dict:
    """画布转 camelCase 字典（viewport 解析为对象，时间转 ISO 字符串）。"""
    return ProjectOut.model_validate(project).model_dump(by_alias=True)


def _get_project_or_404(db: Session, project_id: str) -> Project:
    """按 id 取画布，不存在时抛 404。"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="画布不存在")
    return project


def _suggestion_ids(node: ConversationNode) -> set[str]:
    """取节点已有候选方向的 id 集合（suggestions 是 JSON 数组字符串）。"""
    try:
        items = json.loads(node.suggestions or "[]")
    except ValueError:
        return set()
    return {item.get("id") for item in items if isinstance(item, dict)}


@router.get("")
def list_projects(db: Session = Depends(get_db)) -> list[dict]:
    """画布列表，含根问题摘要与节点数，按更新时间倒序。"""
    projects = db.scalars(select(Project).order_by(Project.updated_at.desc())).all()
    nodes = db.scalars(select(ConversationNode)).all()

    node_count: dict[str, int] = {}
    root_question: dict[str, str] = {}
    for node in nodes:
        node_count[node.project_id] = node_count.get(node.project_id, 0) + 1
        # 根节点 parent_id 恒为空；笔记卡片同样没有父节点，不能覆盖根问题摘要
        if node.parent_id is None and node.node_type != "note":
            root_question[node.project_id] = node.question

    return [
        ProjectListItem(
            id=project.id,
            name=project.name,
            viewport=project.viewport,
            root_question=root_question.get(project.id, ""),
            node_count=node_count.get(project.id, 0),
            updated_at=project.updated_at,
        ).model_dump(by_alias=True)
        for project in projects
    ]


@router.post("")
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> dict:
    """新建画布，并自动创建唯一根节点（元问题卡片）。"""
    name = (payload.name or "").strip() or "新画布"
    project = Project(name=name)
    db.add(project)
    db.flush()  # 先取得项目主键，再创建根节点

    root = ConversationNode(
        project_id=project.id,
        parent_id=None,
        question="",
        origin="root",
        status="input",
        # 元问题卡片新建时默认固定
        pinned=True,
        x=0,
        y=0,
    )
    db.add(root)
    db.commit()
    db.refresh(project)
    db.refresh(root)
    # 前端按 {project, nodes} 的图数据结构消费，这里与 GET /graph 保持一致；
    # rootNode 保留给已有调用方（测试）
    root_dto = node_to_dto(root)
    return {"project": _project_dto(project), "rootNode": root_dto, "nodes": [root_dto]}


@router.patch("/{project_id}")
def patch_project(project_id: str, payload: ProjectPatch, db: Session = Depends(get_db)) -> dict:
    """更新画布名称或视口；名字真正变化时才标记为用户自定义。"""
    project = _get_project_or_404(db, project_id)
    if payload.name is not None:
        name = payload.name.strip()
        # 同名提交（例如点开重命名后直接失焦）不算用户改名，保留自动命名资格
        if name and name != project.name:
            project.name = name
            project.name_is_custom = True
    if payload.viewport is not None:
        project.viewport = json.dumps(payload.viewport, ensure_ascii=False)
    db.commit()
    db.refresh(project)
    return _project_dto(project)


@router.post("/{project_id}/auto-name")
async def auto_name_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    """首轮回答完成后自动命名画布；用户手动改过名或已命名时直接返回。"""
    project = _get_project_or_404(db, project_id)
    # 已手动改名或已经不是默认名：只自动命名一次
    if project.name_is_custom or project.name != "新画布":
        return _project_dto(project)

    root = db.scalar(
        select(ConversationNode).where(
            ConversationNode.project_id == project_id,
            ConversationNode.parent_id.is_(None),
            ConversationNode.node_type == "chat",
        )
    )
    if root is None or root.status != "done" or not (root.answer or "").strip():
        return _project_dto(project)

    runtime = runtime_settings.effective(db)
    if not runtime["api_key"]:
        return _project_dto(project)

    try:
        name = await naming.generate_project_name(root.question, root.answer, runtime=runtime)
    except Exception:
        # 自动命名失败不影响画布内容，保持默认名
        return _project_dto(project)

    if not name:
        return _project_dto(project)

    # 生成期间用户可能已手动改名，这里再检查一次
    db.refresh(project)
    if not project.name_is_custom and project.name == "新画布":
        project.name = name
        db.commit()
        db.refresh(project)
    return _project_dto(project)


@router.delete("/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    """删除画布及全部节点。"""
    project = _get_project_or_404(db, project_id)
    node_ids = db.scalars(
        select(ConversationNode.id).where(ConversationNode.project_id == project_id)
    ).all()
    if node_ids:
        db.execute(delete(ConversationNode).where(ConversationNode.id.in_(node_ids)))
    db.delete(project)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/graph")
def get_graph(project_id: str, db: Session = Depends(get_db)) -> dict:
    """取画布及其全部节点；连线由前端按 parentId 派生。"""
    project = _get_project_or_404(db, project_id)
    nodes = db.scalars(
        select(ConversationNode)
        .where(ConversationNode.project_id == project_id)
        .order_by(ConversationNode.created_at)
    ).all()
    return {"project": _project_dto(project), "nodes": [node_to_dto(node) for node in nodes]}


@router.post("/{project_id}/notes")
def create_note(project_id: str, payload: NoteCreate, db: Session = Depends(get_db)) -> dict:
    """在指定坐标创建笔记卡片：不参与连线与自动整理，尺寸独立。"""
    _get_project_or_404(db, project_id)
    note = ConversationNode(
        project_id=project_id,
        parent_id=None,
        question="",
        answer="",
        reasoning="",
        origin="user",
        status="done",
        suggestions="[]",
        node_type="note",
        pinned=False,
        width=NOTE_DEFAULT_WIDTH,
        height=NOTE_DEFAULT_HEIGHT,
        x=payload.x,
        y=payload.y,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return node_to_dto(note)


@router.post("/{project_id}/nodes/restore")
def restore_nodes(
    project_id: str, payload: RestoreRequest, db: Session = Depends(get_db)
) -> dict:
    """批量恢复节点（前端撤销「删除」）：保留原 id，已存在的 id 跳过。"""
    _get_project_or_404(db, project_id)
    restored = 0
    # 同一批次里重复的 id 也要跳过，避免主键冲突
    restored_ids: set[str] = set()
    for item in payload.nodes:
        if item.id in restored_ids or db.get(ConversationNode, item.id) is not None:
            continue
        db.add(
            ConversationNode(
                id=item.id,
                # 画布归属强制取路径中的画布，防止前端串画布恢复
                project_id=project_id,
                parent_id=item.parent_id,
                question=item.question,
                answer=item.answer,
                reasoning=item.reasoning,
                origin=item.origin,
                suggestion_id=item.suggestion_id,
                status=item.status,
                error=item.error,
                suggestions=json.dumps(
                    [suggestion.model_dump() for suggestion in item.suggestions],
                    ensure_ascii=False,
                ),
                suggestions_consumed=item.suggestions_consumed,
                pinned=item.pinned,
                node_type=item.node_type,
                width=item.width,
                height=item.height,
                x=item.x,
                y=item.y,
            )
        )
        restored_ids.add(item.id)
        restored += 1
    db.commit()
    return {"ok": True, "restored": restored}


@router.post("/{project_id}/save")
def save_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    """把当前画布完整快照写入 saves/{projectId}.json，覆盖旧文件（只保留 1 份）。"""
    project = _get_project_or_404(db, project_id)
    nodes = db.scalars(
        select(ConversationNode)
        .where(ConversationNode.project_id == project_id)
        .order_by(ConversationNode.created_at)
    ).all()
    saved_at = datetime.now(timezone.utc).isoformat()
    snapshot = {
        "project": _project_dto(project),
        "nodes": [node_to_dto(node) for node in nodes],
        "savedAt": saved_at,
    }
    file_name = f"{project_id}.json"
    target = _saves_dir() / file_name
    target.write_text(
        json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
    )
    return {"ok": True, "savedAt": saved_at, "fileName": file_name}


@router.post("/{project_id}/nodes")
def create_node(
    project_id: str, payload: NodeCreate, db: Session = Depends(get_db)
) -> dict:
    """创建子节点：校验父节点归属与问题，自动分配不重叠的坐标。"""
    _get_project_or_404(db, project_id)

    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    parent = db.get(ConversationNode, payload.parent_id)
    if parent is None or parent.project_id != project_id:
        raise HTTPException(status_code=400, detail="父节点不属于该画布")

    # 点选建议创建的分支，必须对应父节点上真实存在的候选方向
    if payload.suggestion_id and payload.suggestion_id not in _suggestion_ids(parent):
        raise HTTPException(status_code=400, detail="候选方向不存在")

    # 已有子节点数决定纵向槽位，避免同级卡片重叠
    x, y = next_child_position(db, parent)

    node = ConversationNode(
        project_id=project_id,
        parent_id=parent.id,
        question=question,
        answer="",
        reasoning="",
        origin=payload.origin,
        suggestion_id=payload.suggestion_id,
        status="pending",
        suggestions="[]",
        x=x,
        y=y,
    )
    # 创建任意子卡片都意味着这一轮候选方向已结束（建议、自定义输入、底部追问通用）
    parent.suggestions_consumed = True
    db.add(node)
    db.commit()
    db.refresh(node)
    return node_to_dto(node)
