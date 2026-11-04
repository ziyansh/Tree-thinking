"""节点 API：保存坐标、删除子树、写入问题、流式回答、候选方向。"""

import json
import logging
from types import SimpleNamespace
from typing import AsyncIterator, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import ConversationNode
from app.schemas import NodePatch, NodeQuestion, SuggestionRequest
from app.services import llm, suggestions
from app.services import settings as runtime_settings
from app.services.context import build_messages, get_path
from app.services.graph import (
    NOTE_MIN_HEIGHT,
    NOTE_MIN_WIDTH,
    collect_subtree_ids,
    get_node_or_404,
    next_child_position,
    node_to_dto,
)
from app.services.suggestions import used_suggestion_ids

router = APIRouter(prefix="/api/nodes", tags=["nodes"])

# SSE 响应头：禁用缓存与反向代理缓冲，保证增量及时到达浏览器
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

# 未配置 Key 时的提示：带上当前服务商名，同时作为节点错误信息落库
PROVIDER_LABELS = {"deepseek": "DeepSeek", "openai": "OpenAI"}


def _no_key_message(provider: str) -> str:
    """生成「未配置 Key」提示，保留统一的关键字便于前端识别。"""
    label = PROVIDER_LABELS.get(provider, "当前服务商")
    return f"当前服务商 {label} 未配置 API Key，请点击左下角「设置」填写后重试"


def _sse(event: str, data: dict) -> str:
    """拼一条 SSE 消息：event 行 + JSON data 行 + 结尾空行。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _persist_answer(
    node_id: str,
    answer: str,
    reasoning: str,
    status: str,
    error: str | None,
    suggestion_list: list[dict] | None = None,
) -> None:
    """用新的会话落库回答结果；suggestion_list 非空时一并写入候选方向。

    生成器里不能跨 await 复用请求级的同步会话，所以这里单独开一个会话。
    """
    db = SessionLocal()
    try:
        node = db.get(ConversationNode, node_id)
        if node is None:
            return
        node.answer = answer
        node.reasoning = reasoning
        node.status = status
        node.error = error
        if suggestion_list is not None:
            node.suggestions = json.dumps(suggestion_list, ensure_ascii=False)
        db.commit()
    finally:
        db.close()


@router.patch("/{node_id}")
def patch_node(node_id: str, payload: NodePatch, db: Session = Depends(get_db)) -> dict:
    """保存节点坐标，并支持固定、标题、正文、笔记尺寸与候选方向修改。

    - pinned：任何节点可改
    - title：写入 question（聊天卡片标题与笔记标题复用该字段）
    - content：仅笔记节点写入 answer，聊天卡片忽略
    - width/height：仅笔记节点写入（最小 280×240），聊天卡片忽略
    - suggestions：整组覆盖候选方向（撤销「换一个方向」时回写）
    """
    node = get_node_or_404(db, node_id)
    if payload.x is not None:
        node.x = payload.x
    if payload.y is not None:
        node.y = payload.y
    if payload.pinned is not None:
        node.pinned = payload.pinned
    if payload.title is not None:
        node.question = payload.title
    if payload.suggestions_consumed is not None:
        node.suggestions_consumed = payload.suggestions_consumed
    if payload.suggestions is not None:
        items = [suggestion.model_dump() for suggestion in payload.suggestions]
        # 撤销「换一个方向」时整组回写；空 id/text 属于非法内容，直接拒绝
        if any(not str(item["id"]).strip() or not str(item["text"]).strip() for item in items):
            raise HTTPException(status_code=400, detail="候选方向内容不能为空")
        node.suggestions = json.dumps(items, ensure_ascii=False)
    # 笔记专属字段：聊天卡片不接收正文与独立尺寸
    if node.node_type == "note":
        if payload.content is not None:
            node.answer = payload.content
        if payload.width is not None:
            node.width = max(NOTE_MIN_WIDTH, payload.width)
        if payload.height is not None:
            node.height = max(NOTE_MIN_HEIGHT, payload.height)
    db.commit()
    db.refresh(node)
    return node_to_dto(node)


@router.delete("/{node_id}")
def delete_node(node_id: str, db: Session = Depends(get_db)) -> dict:
    """删除节点及其全部后代；元问题卡片（根节点）不可删除，笔记卡片可删除。"""
    node = get_node_or_404(db, node_id)
    if node.parent_id is None and node.node_type != "note":
        raise HTTPException(status_code=400, detail="元问题卡片不可删除")

    node_ids = collect_subtree_ids(db, node.id)
    db.execute(delete(ConversationNode).where(ConversationNode.id.in_(node_ids)))
    db.commit()
    return {"ok": True, "deleted": len(node_ids)}


@router.post("/{node_id}/branch")
def create_branch(node_id: str, db: Session = Depends(get_db)) -> dict:
    """新增空分支卡片：仅已完成回答的卡片可以派生，坐标与普通子节点一致。"""
    parent = get_node_or_404(db, node_id)
    if parent.status != "done":
        raise HTTPException(status_code=400, detail="当前卡片还没有完成回答，无法新增分支")

    x, y = next_child_position(db, parent)
    node = ConversationNode(
        project_id=parent.project_id,
        parent_id=parent.id,
        question="",
        answer="",
        reasoning="",
        origin="user",
        status="input",
        suggestions="[]",
        x=x,
        y=y,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node_to_dto(node)


@router.post("/{node_id}/question")
def set_question(node_id: str, payload: NodeQuestion, db: Session = Depends(get_db)) -> dict:
    """写入节点问题（用于根卡片首次输入或错误重试），并置为待回答。"""
    node = get_node_or_404(db, node_id)
    if node.status not in ("input", "error"):
        raise HTTPException(status_code=400, detail="该节点已有回答，不能重复写入问题")

    node.question = payload.question.strip()
    node.status = "pending"
    db.commit()
    db.refresh(node)
    return node_to_dto(node)


@router.post("/{node_id}/answer")
def answer_node(node_id: str, db: Session = Depends(get_db)):
    """流式回答：以 SSE 推送 reasoning / delta / done / error，并把结果落库。"""
    node = get_node_or_404(db, node_id)
    question = (node.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="该节点还没有问题，请先输入问题后再请求回答")

    # 开始前置为流式状态并清空旧内容，便于前端「重新生成」时复用同一节点
    node.status = "streaming"
    node.answer = ""
    node.reasoning = ""
    node.error = None
    db.commit()
    db.refresh(node)

    # 上下文快照：路径为「根 → 当前节点」，之后生成器内不再使用请求级会话
    messages = build_messages(get_path(db, node))
    # 当前生效的模型设置（页面「设置」优先，其次 .env）；保存后立即生效
    runtime = runtime_settings.effective(db)

    if not runtime["api_key"]:
        # 未配置 Key 也返回 200 + SSE，先告知前端具体原因，并把错误态落库
        message = _no_key_message(runtime["provider"])
        _persist_answer(node_id, "", "", "error", message)

        def _no_key_stream() -> Iterator[str]:
            yield _sse("error", {"message": message})

        return StreamingResponse(
            _no_key_stream(), media_type="text/event-stream", headers=SSE_HEADERS
        )

    async def _stream() -> AsyncIterator[str]:
        """只累积文本的异步生成器；结束时用新会话一次性落库。"""
        answer = ""
        reasoning = ""
        error: str | None = None
        suggestion_items: list[dict] = []
        try:
            async for kind, text in llm.stream_chat(messages, runtime):
                if kind == "reasoning":
                    reasoning += text
                else:
                    answer += text
                yield _sse(kind, {"text": text})
            # 回答结束后生成候选方向；任何未预期异常都只记日志，不影响 done
            try:
                snapshot = SimpleNamespace(question=question, answer=answer)
                suggestion_items = await suggestions.generate_suggestions(
                    snapshot,
                    runtime["suggestion_count"],
                    runtime=runtime,
                )
            except Exception:
                logging.warning("生成候选方向时发生未预期异常，跳过 suggestions 事件", exc_info=True)
                suggestion_items = []
        except llm.LLMError as exc:
            error = str(exc) or "模型调用失败"
        except Exception as exc:  # 兜底：未预期异常也转成可读中文提示
            error = f"回答过程中发生错误：{exc}"
        finally:
            # 成功、失败或中断都落库已有内容；中断时保留已收到的部分回答
            _persist_answer(
                node_id,
                answer,
                reasoning,
                "error" if error else "done",
                error,
                # 失败时保留旧建议，成功时用本次生成的建议覆盖
                None if error else suggestion_items,
            )

        if error:
            yield _sse("error", {"message": error})
        else:
            if suggestion_items:
                yield _sse("suggestions", {"suggestions": suggestion_items})
            yield _sse("done", {"status": "done"})

    return StreamingResponse(
        _stream(), media_type="text/event-stream", headers=SSE_HEADERS
    )


@router.post("/{node_id}/suggestions")
async def regenerate_suggestions(
    node_id: str,
    payload: SuggestionRequest | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    """重新生成候选方向：保留已产生子卡片的建议（顺序在前），替换其余建议。"""
    node = get_node_or_404(db, node_id)
    if node.status != "done":
        raise HTTPException(status_code=400, detail="该节点尚未完成回答，无法生成候选方向")

    # 已使用的建议 id：由子节点的 suggestion_id 反推
    used_ids = used_suggestion_ids(db, node)
    try:
        existing = json.loads(node.suggestions or "[]")
    except ValueError:
        existing = []
    if not isinstance(existing, list):
        existing = []

    kept = [
        item
        for item in existing
        if isinstance(item, dict) and item.get("id") in used_ids
    ]
    kept_texts = [str(item.get("text") or "") for item in kept]

    # 生成数量：显式传入优先，否则用设置里的默认值
    runtime = runtime_settings.effective(db)
    count = payload.count if payload and payload.count else runtime["suggestion_count"]
    fresh = await suggestions.generate_suggestions(
        node,
        count,
        used_texts=kept_texts,
        runtime=runtime,
    )
    result = kept + fresh

    node.suggestions = json.dumps(result, ensure_ascii=False)
    # 换一批方向即开启新一轮，解除「已选」隐藏状态
    node.suggestions_consumed = False
    db.commit()
    # 与前端既有契约一致：直接返回建议数组，已用项在前
    return result
