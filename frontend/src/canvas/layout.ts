import dagre from '@dagrejs/dagre'
import type { GraphFlowNode } from '../store/graphStore'
import { GHOST_X_GAP } from './ghosts'

/** ghost 卡片尺寸与纵向间距，与 GhostNode / GhostInputNode / Canvas 的 GHOST_SIZE 保持一致 */
const GHOST_WIDTH = 280
const GHOST_HEIGHT = 44
const GHOST_GAP = 8

/** 主干子卡片在父卡片右侧额外留出的间距（与候选方向偏移、后端创建子节点的 320 一致） */
const CHAIN_GAP = 320

/** 纵向安全间距：同列卡片之间、卡片与 ghost 组之间至少留出的高度 */
const V_GAP = 64

/** ghost 列预留宽度：候选方向左偏移 + ghost 自身宽度 */
const GHOST_COLUMN_WIDTH = GHOST_X_GAP + GHOST_WIDTH

/**
 * 相邻两列卡片之间的最小间距（dagre 的 ranksep 语义：父卡片右边界到子卡片左边界）。
 * 需要跨过 ghost 列，同时满足「卡片宽 + 320 + 320」的下限。
 */
function columnGap(size: { width: number }): number {
  return Math.max(size.width + CHAIN_GAP * 2, GHOST_COLUMN_WIDTH + CHAIN_GAP)
}

/** 节点 id → 左上角坐标；只包含聊天卡片，笔记不参与整理 */
export type LayoutPositions = Map<string, { x: number; y: number }>

/** 只保留聊天卡片：笔记卡片保持原位 */
function chatCardsOf(cards: GraphFlowNode[]): GraphFlowNode[] {
  return cards.filter((card) => card.data.node.nodeType === 'chat')
}

/** 是否需要为这张卡片预留「猜你想问」占位（与 ghosts.ts 的展示条件一致） */
function showsGhosts(card: GraphFlowNode): boolean {
  const node = card.data.node
  return node.status === 'done' && !node.suggestionsConsumed
}

/** ghost 组高度：候选方向 + 末尾输入箭头，每条 44、间距 8 */
function ghostGroupHeight(card: GraphFlowNode): number {
  const count = card.data.node.suggestions.length + 1
  return count * GHOST_HEIGHT + (count - 1) * GHOST_GAP
}

/** 布局矩形：聊天卡片或某张卡片右侧的 ghost 组 */
interface LayoutRect {
  id: string
  kind: 'card' | 'ghost'
  x: number
  y: number
  width: number
  height: number
}

/** 收集所有聊天卡片与 ghost 组的矩形，用于碰撞检查 */
function collectRects(
  positions: LayoutPositions,
  cards: GraphFlowNode[],
  size: { width: number; height: number },
): LayoutRect[] {
  const rects: LayoutRect[] = []
  for (const card of cards) {
    const position = positions.get(card.id)
    if (!position) continue

    rects.push({
      id: card.id,
      kind: 'card',
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    })

    // 猜你想问组从卡片右侧固定偏移处开始，纵向从卡片顶部向下堆叠
    if (!showsGhosts(card)) continue
    rects.push({
      id: card.id,
      kind: 'ghost',
      x: position.x + size.width + GHOST_X_GAP,
      y: position.y,
      width: GHOST_WIDTH,
      height: ghostGroupHeight(card),
    })
  }
  return rects
}

function intersects(a: LayoutRect, b: LayoutRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/** 把节点及其整棵子树整体下推，保持子树内部相对位置不变 */
function pushSubtree(
  positions: LayoutPositions,
  cards: GraphFlowNode[],
  rootId: string,
  deltaY: number,
) {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const card of cards) {
      const parentId = card.data.node.parentId
      if (parentId && ids.has(parentId) && !ids.has(card.id)) {
        ids.add(card.id)
        changed = true
      }
    }
  }

  for (const id of ids) {
    const position = positions.get(id)
    if (position) positions.set(id, { x: position.x, y: position.y + deltaY })
  }
}

/**
 * 碰撞检查：同列矩形相交时把较低的那个（含整棵子树）整体下推一个安全高度，
 * 重复直到任意卡片与卡片、卡片与 ghost 组之间都不相交。
 */
function resolveOverlaps(
  positions: LayoutPositions,
  cards: GraphFlowNode[],
  size: { width: number; height: number },
) {
  const laneStep = size.height + V_GAP

  for (let pass = 0; pass < 300; pass += 1) {
    // 按 y 升序排列：相交的矩形对中，排在后面的（y 更大）整体下移
    const rects = collectRects(positions, cards, size).sort(
      (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
    )

    let pushed = false
    for (let i = 0; i < rects.length && !pushed; i += 1) {
      const upper = rects[i]
      for (let j = i + 1; j < rects.length; j += 1) {
        const lower = rects[j]
        // 后续矩形的 y 只会更大，已不可能与 upper 在纵向相交
        if (lower.y >= upper.y + upper.height) break
        if (!intersects(upper, lower)) continue
        pushSubtree(positions, cards, lower.id, laneStep)
        pushed = true
        break
      }
    }

    if (!pushed) return
  }
}

/** 按父节点分组子卡片，并按创建时间升序（第一个为主干，其余为 fork） */
function childrenByParent(cards: GraphFlowNode[]): Map<string, GraphFlowNode[]> {
  const groups = new Map<string, GraphFlowNode[]>()
  for (const card of cards) {
    const parentId = card.data.node.parentId
    if (!parentId) continue
    const group = groups.get(parentId) ?? []
    group.push(card)
    groups.set(parentId, group)
  }
  groups.forEach((group) =>
    group.sort((a, b) =>
      (a.data.node.createdAt ?? '').localeCompare(b.data.node.createdAt ?? ''),
    ),
  )
  return groups
}

/**
 * 共用母线模式的基准布局：dagre 从左到右排列。
 * 右侧 ghost 列通过 ranksep 预留，节点间距不小于卡片高度 + 120 或最高 ghost 组高度。
 */
function dagrePositions(
  cards: GraphFlowNode[],
  size: { width: number; height: number },
): LayoutPositions {
  const positions: LayoutPositions = new Map()
  if (cards.length === 0) return positions

  // ghost 组比卡片更矮，但候选方向较多时需要按组高度撑开同列间距
  const ghostMaxHeight = cards.reduce(
    (max, card) => (showsGhosts(card) ? Math.max(max, ghostGroupHeight(card)) : max),
    0,
  )
  // ranksep 需跨过 ghost 列，保证下一列卡片不会压到「猜你想问」
  const ranksep = columnGap(size)
  const nodesep = Math.max(size.height + V_GAP, ghostMaxHeight)

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ranksep, nodesep })

  for (const card of cards) graph.setNode(card.id, { width: size.width, height: size.height })
  for (const card of cards) {
    const parentId = card.data.node.parentId
    if (parentId) graph.setEdge(parentId, card.id)
  }

  dagre.layout(graph)

  for (const card of cards) {
    // dagre 返回节点中心坐标，这里换回左上角
    const center = graph.node(card.id)
    positions.set(card.id, {
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
    })
  }
  return positions
}

/**
 * 直接分支模式：以 dagre 结果作为根基准，再按「主干链 + lane」重排。
 * 主链按当前几何位置判定：子卡片中心在父卡片中心右侧的第一个子卡片；
 * 其余子卡片（正下方、左侧）作为 fork，落在父卡片同列下方且 lane 递增。
 */
function directPositions(
  cards: GraphFlowNode[],
  size: { width: number; height: number },
  base: LayoutPositions,
): LayoutPositions {
  const positions: LayoutPositions = new Map()
  const root = cards.find((card) => card.data.node.parentId === null)
  if (!root) return positions

  const groups = childrenByParent(cards)
  // 主干子卡片落点 = 父卡片左上角 + 卡片宽 + 列间距（列间距已跨过 ghost 列）
  const stepX = size.width + columnGap(size)
  const laneStep = size.height + V_GAP

  const basePosition = base.get(root.id) ?? root.position
  const baseX = basePosition.x
  const baseY = basePosition.y

  /** 递归摆放子树，返回该子树占用到的最大 lane */
  const place = (card: GraphFlowNode, x: number, y: number, lane: number): number => {
    positions.set(card.id, { x, y })
    let maxLane = lane

    const children = groups.get(card.id) ?? []
    const current = card.position
    // 只把「当前在右侧且与父卡片同一水平带」的第一个子卡片视为主链；
    // 避免新增的下方分支、右侧错位分支被强行挪到主干
    const mainChild = children.find(
      (child) =>
        child.position.x + size.width / 2 > current.x + size.width / 2 &&
        child.position.y < current.y + size.height &&
        child.position.y + size.height > current.y,
    )

    if (mainChild) {
      maxLane = Math.max(maxLane, place(mainChild, x + stepX, y, lane))
    }

    for (const child of children) {
      if (child === mainChild) continue
      // fork：与父卡片同列、逐个向下，lane 取当前子树最大 lane + 1
      const forkLane = maxLane + 1
      const forkY = baseY + forkLane * laneStep
      maxLane = Math.max(maxLane, place(child, x, forkY, forkLane))
    }

    return maxLane
  }

  place(root, baseX, baseY, 0)
  return positions
}

/**
 * 自动整理入口：按连接方式计算聊天卡片最终坐标。
 * 两种模式都会为「猜你想问」预留独立占位列，并做碰撞下推；
 * 笔记卡片不参与布局，不会出现在返回值中。
 */
export function computeAutoLayout(
  cards: GraphFlowNode[],
  size: { width: number; height: number },
  connectionStyle: 'direct' | 'bus',
): LayoutPositions {
  const chatCards = chatCardsOf(cards)
  const base = dagrePositions(chatCards, size)
  const positions =
    connectionStyle === 'bus' ? base : directPositions(chatCards, size, base)

  resolveOverlaps(positions, chatCards, size)
  return positions
}
