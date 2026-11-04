"""节点相关的共用查询与序列化辅助函数。"""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ConversationNode
from app.schemas import NodeOut
from app.services import settings as runtime_settings

# 笔记卡片的默认尺寸与最小尺寸（笔记不共享全局卡片尺寸）
NOTE_DEFAULT_WIDTH = 320
NOTE_DEFAULT_HEIGHT = 220
NOTE_MIN_WIDTH = 280
NOTE_MIN_HEIGHT = 240

# 同列分支卡片的纵向安全间距（与前端 BRANCH_GAP 保持一致）
BRANCH_GAP = 64


def get_node_or_404(db: Session, node_id: str, detail: str = "节点不存在") -> ConversationNode:
    """按 id 取节点，不存在时抛 404。"""
    node = db.get(ConversationNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=detail)
    return node


def node_to_dto(node: ConversationNode) -> dict:
    """ORM 节点转 camelCase 字典：解析 suggestions JSON，时间转 ISO 字符串。"""
    return NodeOut.model_validate(node).model_dump(by_alias=True)


def next_child_position(db: Session, parent: ConversationNode) -> tuple[float, float]:
    """计算新子节点坐标：水平间隔为「卡片宽 + 320」。

    首个孩子与父卡片同一水平线；出现第二个及以上孩子时，
    每个后续孩子按「卡片高 + BRANCH_GAP」纵向错开。
    """
    runtime = runtime_settings.effective(db)
    sibling_count = (
        db.scalar(
            select(func.count())
            .select_from(ConversationNode)
            .where(ConversationNode.parent_id == parent.id)
        )
        or 0
    )
    x = parent.x + runtime["card_width"] + 320
    if sibling_count == 0:
        return x, parent.y
    return x, parent.y + sibling_count * (runtime["card_height"] + BRANCH_GAP)


def collect_subtree_ids(db: Session, root_id: str) -> list[str]:
    """递归收集节点自身及全部后代的 id（用于级联删除）。"""
    ids = [root_id]
    child_ids = db.scalars(
        select(ConversationNode.id).where(ConversationNode.parent_id == root_id)
    ).all()
    for child_id in child_ids:
        ids.extend(collect_subtree_ids(db, child_id))
    return ids
