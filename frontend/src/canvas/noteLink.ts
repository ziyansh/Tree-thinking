import { useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** 连接点圆点直径（px） */
export const NOTE_LINK_DOT_SIZE = 9

/** 回答卡片连接点：底部工具栏一行、靠近右边框 */
export const ANSWER_LINK_DOT = { right: 6, bottom: 26 }

/** 笔记卡片连接点：标题行最左侧、靠近左边框 */
export const NOTE_LINK_DOT = { left: 6, top: 20 }

/** 画布坐标中的节点矩形 */
export interface NoteLinkRect {
  x: number
  y: number
  width: number
  height: number
}

/** 连线端点：从哪类卡片出发 */
export type NoteLinkSourceKind = 'answer' | 'note'

/** 回答卡片连接点圆心（flow 坐标） */
export function answerLinkAnchor(rect: NoteLinkRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width - ANSWER_LINK_DOT.right - NOTE_LINK_DOT_SIZE / 2,
    y: rect.y + rect.height - ANSWER_LINK_DOT.bottom - NOTE_LINK_DOT_SIZE / 2,
  }
}

/** 笔记卡片连接点圆心（flow 坐标） */
export function noteLinkAnchor(rect: NoteLinkRect): { x: number; y: number } {
  return {
    x: rect.x + NOTE_LINK_DOT.left + NOTE_LINK_DOT_SIZE / 2,
    y: rect.y + NOTE_LINK_DOT.top + NOTE_LINK_DOT_SIZE / 2,
  }
}

/** 连接点按下的起点信息 */
export interface NoteLinkStartPayload {
  nodeId: string
  kind: NoteLinkSourceKind
  clientX: number
  clientY: number
}

/** 节点内连接点向画布广播「开始连线」的自定义事件名 */
export const NOTE_LINK_START_EVENT = 'tt:note-link-start'

/** 连接点被按下：通知画布开始绘制预览线 */
export function startNoteLinkDrag(
  event: ReactPointerEvent<HTMLElement>,
  nodeId: string,
  kind: NoteLinkSourceKind,
): void {
  // 只响应左键；阻止卡片拖动、选中与文字选择
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  window.dispatchEvent(
    new CustomEvent<NoteLinkStartPayload>(NOTE_LINK_START_EVENT, {
      detail: { nodeId, kind, clientX: event.clientX, clientY: event.clientY },
    }),
  )
}

/** 连线拖拽的全局高亮信号：供各卡片连接点自行订阅 */
export interface NoteLinkDragSignal {
  active: boolean
  sourceKind: NoteLinkSourceKind | null
  /** 起点节点 id：起点连接点显示为实心强调色 */
  sourceNodeId: string | null
  /** 当前被吸附的目标节点 id */
  snappedNodeId: string | null
}

const IDLE_SIGNAL: NoteLinkDragSignal = {
  active: false,
  sourceKind: null,
  sourceNodeId: null,
  snappedNodeId: null,
}

let signal: NoteLinkDragSignal = IDLE_SIGNAL
const listeners = new Set<() => void>()

/** 更新高亮信号：内容未变化时不触发订阅者重渲染 */
export function setNoteLinkDragSignal(next: NoteLinkDragSignal): void {
  if (
    signal.active === next.active &&
    signal.sourceKind === next.sourceKind &&
    signal.sourceNodeId === next.sourceNodeId &&
    signal.snappedNodeId === next.snappedNodeId
  ) {
    return
  }
  signal = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 卡片内读取连线拖拽状态：是否正在连线、从哪端出发、吸附在哪个节点 */
export function useNoteLinkDragSignal(): NoteLinkDragSignal {
  return useSyncExternalStore(subscribe, () => signal, () => IDLE_SIGNAL)
}
