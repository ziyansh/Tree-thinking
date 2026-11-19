"""画布 API：列表、创建（自动建根节点）、改名/视口、删除、取图、建子节点、笔记、快照、导入导出。"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import ConversationNode, NoteLink, Project, User
from app.schemas import (
    ImportPayload,
    NoteCreate,
    NoteLinkOut,
    NodeCreate,
    ProjectCreate,
    ProjectListItem,
    ProjectOut,
    ProjectPatch,
    RestoreRequest,
)
from app.services import attachments, naming
from app.services import settings as runtime_settings
from app.services.auth import require_user
from app.services.graph import (
    NOTE_DEFAULT_HEIGHT,
    NOTE_DEFAULT_WIDTH,
    next_child_position,
    node_to_dto,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])

# 导入文件格式标识与版本
EXPORT_APP = "tree-thinking"
EXPORT_VERSION = 1
# 导入时的名称后缀与上限（与 projects.name 列长度一致）
IMPORT_SUFFIX = "（导入）"
MAX_PROJECT_NAME_LENGTH = 120


def _saves_dir() -> Path:
    """快照目录：与数据库同级的 saves/（默认 backend/data/saves），不存在时自动创建。"""
    path = config.DB_PATH.parent / "saves"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _project_dto(project: Project) -> dict:
    """画布转 camelCase 字典（viewport 解析为对象，时间转 ISO 字符串）。"""
    return ProjectOut.model_validate(project).model_dump(by_alias=True)


def _get_project_or_404(
    db: Session, project_id: str, user: User | None = None
) -> Project:
    """按 id 取画布，不存在或不属于当前用户时抛 404（不泄露存在性）。"""
    project = db.get(Project, project_id)
    if project is None or (user is not None and project.owner_id != user.id):
        raise HTTPException(status_code=404, detail="画布不存在")
    return project


def _suggestion_ids(node: ConversationNode) -> set[str]:
    """取节点已有候选方向的 id 集合（suggestions 是 JSON 数组字符串）。"""
    try:
        items = json.loads(node.suggestions or "[]")
    except ValueError:
        return set()
    return {item.get("id") for item in items if isinstance(item, dict)}


def _viewport_of(project: Project) -> dict | None:
    """数据库里的视口 JSON 字符串转对象；非法内容按空视口处理。"""
    if not project.viewport:
        return None
    try:
        parsed = json.loads(project.viewport)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


@router.get("")
def list_projects(
    db: Session = Depends(get_db), user: User | None = Depends(require_user)
) -> list[dict]:
    """画布列表，含根问题摘要与节点数，按更新时间倒序；server 模式只返回本人画布。"""
    query = select(Project)
    if user is not None:
        query = query.where(Project.owner_id == user.id)
    projects = db.scalars(query.order_by(Project.updated_at.desc())).all()

    project_ids = [project.id for project in projects]
    nodes = (
        db.scalars(
            select(ConversationNode).where(
                ConversationNode.project_id.in_(project_ids)
            )
        ).all()
        if project_ids
        else []
    )

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
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """新建画布，并自动创建唯一根节点（元问题卡片）。"""
    name = (payload.name or "").strip() or "新画布"
    project = Project(name=name, owner_id=user.id if user else None)
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


@router.post("/import")
def import_project(
    payload: ImportPayload,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """导入历史文件：新建画布，为每个节点生成新 id 并重建父子关系。"""
    if payload.app != EXPORT_APP:
        raise HTTPException(status_code=400, detail="不是本应用导出的画布文件")
    if payload.version != EXPORT_VERSION:
        raise HTTPException(status_code=400, detail="不支持的导出文件版本")
    if not payload.nodes:
        raise HTTPException(status_code=400, detail="导入文件里没有节点")

    # 每个节点必须有原 id，否则无法重建父子关系
    old_ids = [item.id for item in payload.nodes]
    if any(not old_id for old_id in old_ids) or len(set(old_ids)) != len(old_ids):
        raise HTTPException(status_code=400, detail="导入文件里的节点 id 缺失或重复")

    root_item = next(
        (
            item
            for item in payload.nodes
            if item.parent_id is None and item.node_type != "note"
        ),
        None,
    )
    if root_item is None:
        raise HTTPException(status_code=400, detail="导入文件缺少根节点")

    known_ids = set(old_ids)
    for item in payload.nodes:
        if item.parent_id is not None and item.parent_id not in known_ids:
            raise HTTPException(status_code=400, detail="导入文件里的父子关系不完整")

    name = (payload.project.name or "").strip() or "新画布"
    viewport = payload.project.viewport
    project = Project(
        name=(name + IMPORT_SUFFIX)[:MAX_PROJECT_NAME_LENGTH],
        viewport=(
            json.dumps(viewport, ensure_ascii=False) if viewport is not None else None
        ),
        owner_id=user.id if user else None,
    )
    db.add(project)
    db.flush()

    # 旧 id → 新 id 的映射：parent 同步换成新 id，保持原有树结构
    id_map = {item.id: uuid.uuid4().hex for item in payload.nodes}
    for item in payload.nodes:
        db.add(
            ConversationNode(
                id=id_map[item.id],
                project_id=project.id,
                parent_id=id_map[item.parent_id] if item.parent_id else None,
                question=item.question,
                prompt=item.prompt or item.question,
                title_custom=item.title_custom,
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
                sources=json.dumps(item.sources, ensure_ascii=False),
                attachments=json.dumps(item.attachments, ensure_ascii=False),
                suggestions_consumed=item.suggestions_consumed,
                pinned=item.pinned,
                node_type=item.node_type,
                width=item.width,
                height=item.height,
                x=item.x,
                y=item.y,
            )
        )
    # 笔记连接：旧 id 换成新 id；引用缺失或类型不匹配的项直接跳过
    node_types = {item.id: item.node_type for item in payload.nodes}
    link_pairs: list[tuple[str, str]] = []
    seen_links: set[tuple[str, str]] = set()
    for link in payload.links:
        answer_old = link.answer_node_id
        note_old = link.note_node_id
        if (
            answer_old not in id_map
            or note_old not in id_map
            or answer_old == note_old
            or node_types.get(answer_old) != "chat"
            or node_types.get(note_old) != "note"
        ):
            continue
        key = (id_map[answer_old], id_map[note_old])
        if key in seen_links:
            continue
        seen_links.add(key)
        link_pairs.append(key)

    links = [
        NoteLink(
            project_id=project.id,
            answer_node_id=answer_id,
            note_node_id=note_id,
        )
        for answer_id, note_id in link_pairs
    ]
    db.add_all(links)
    db.commit()
    db.refresh(project)
    return {
        "project": _project_dto(project),
        "nodeId": id_map[root_item.id],
        "links": [
            NoteLinkOut.model_validate(link).model_dump(by_alias=True)
            for link in links
        ],
    }


@router.patch("/{project_id}")
def patch_project(
    project_id: str,
    payload: ProjectPatch,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """更新画布名称或视口；名字真正变化时才标记为用户自定义。"""
    project = _get_project_or_404(db, project_id, user)
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
async def auto_name_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """首轮回答完成后自动命名画布；用户手动改过名或已命名时直接返回。"""
    project = _get_project_or_404(db, project_id, user)
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

    runtime = runtime_settings.effective(db, user)
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
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """删除画布及全部节点。"""
    project = _get_project_or_404(db, project_id, user)
    node_ids = db.scalars(
        select(ConversationNode.id).where(ConversationNode.project_id == project_id)
    ).all()
    if node_ids:
        db.execute(delete(ConversationNode).where(ConversationNode.id.in_(node_ids)))
    # 连接随画布一起删除
    db.execute(delete(NoteLink).where(NoteLink.project_id == project_id))
    db.delete(project)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/graph")
def get_graph(
    project_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """取画布及其全部节点与笔记连接；父子连线仍由前端按 parentId 派生。"""
    project = _get_project_or_404(db, project_id, user)
    nodes = db.scalars(
        select(ConversationNode)
        .where(ConversationNode.project_id == project_id)
        .order_by(ConversationNode.created_at)
    ).all()
    # 笔记连接随图一起返回，避免前端每次切换画布后丢失连接
    links = db.scalars(
        select(NoteLink)
        .where(NoteLink.project_id == project_id)
        .order_by(NoteLink.created_at)
    ).all()
    return {
        "project": _project_dto(project),
        "nodes": [node_to_dto(node) for node in nodes],
        "links": [
            NoteLinkOut.model_validate(link).model_dump(by_alias=True) for link in links
        ],
    }


@router.get("/{project_id}/export")
def export_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> Response:
    """导出画布为 JSON 文件（含项目信息与全部节点）。"""
    project = _get_project_or_404(db, project_id, user)
    nodes = db.scalars(
        select(ConversationNode)
        .where(ConversationNode.project_id == project_id)
        .order_by(ConversationNode.created_at)
    ).all()
    links = db.scalars(
        select(NoteLink)
        .where(NoteLink.project_id == project_id)
        .order_by(NoteLink.created_at)
    ).all()

    exported_at = datetime.now(timezone.utc)
    payload = {
        "app": EXPORT_APP,
        "version": EXPORT_VERSION,
        "exportedAt": exported_at.isoformat(),
        "project": {"name": project.name, "viewport": _viewport_of(project)},
        "nodes": [node_to_dto(node) for node in nodes],
        # 笔记连接使用导出时的节点 id，导入时按旧 id → 新 id 映射重建
        "links": [
            {"answerNodeId": link.answer_node_id, "noteNodeId": link.note_node_id}
            for link in links
        ],
    }

    stamp = exported_at.strftime("%Y%m%d")
    # 中文文件名用 RFC 5987 的 filename* 形式，同时给出 ASCII 兜底名
    file_name = f"{project.name}-{stamp}.json"
    disposition = (
        f'attachment; filename="{EXPORT_APP}-{stamp}.json"; '
        f"filename*=UTF-8''{quote(file_name)}"
    )
    return Response(
        content=json.dumps(payload, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": disposition},
    )


@router.post("/{project_id}/notes")
def create_note(
    project_id: str,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """在指定坐标创建笔记卡片：不参与连线与自动整理，尺寸独立。"""
    _get_project_or_404(db, project_id, user)
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
    project_id: str,
    payload: RestoreRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """批量恢复节点（前端撤销「删除」）：保留原 id，已存在的 id 跳过。"""
    _get_project_or_404(db, project_id, user)
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
                prompt=item.prompt or item.question,
                title_custom=item.title_custom,
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
                # 来源与附件元数据原样恢复
                sources=json.dumps(item.sources, ensure_ascii=False),
                attachments=json.dumps(item.attachments, ensure_ascii=False),
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
def save_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """把当前画布完整快照写入 saves/{projectId}.json，覆盖旧文件（只保留 1 份）。"""
    project = _get_project_or_404(db, project_id, user)
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
    project_id: str,
    payload: NodeCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(require_user),
) -> dict:
    """创建子节点：校验父节点归属与问题，自动分配不重叠的坐标。"""
    _get_project_or_404(db, project_id, user)

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
    x, y = next_child_position(db, parent, user)

    # 附件先校验（不存在时直接 400，不创建节点）
    metas = attachments.resolve_ids(payload.attachments, user)

    node = ConversationNode(
        project_id=project_id,
        parent_id=parent.id,
        question=question,
        # 原始提问与标题初始相同，之后标题可单独改名
        prompt=question,
        answer="",
        reasoning="",
        origin=payload.origin,
        suggestion_id=payload.suggestion_id,
        status="pending",
        suggestions="[]",
        attachments=json.dumps(metas, ensure_ascii=False),
        x=x,
        y=y,
    )
    # 创建任意子卡片都意味着这一轮候选方向已结束（建议、自定义输入、底部追问通用）
    parent.suggestions_consumed = True
    db.add(node)
    db.commit()
    db.refresh(node)
    return node_to_dto(node)
