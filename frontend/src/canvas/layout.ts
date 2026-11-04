import type { GraphFlowNode } from '../store/graphStore'

/** ghost 卡片尺寸与纵向间距，与 GhostNode / GhostInputNode / Canvas 的 GHOST_SIZE 保持一致 */
const GHOST_WIDTH = 280
const GHOST_HEIGHT = 44
const GHOST_GAP = 8

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
  gap: number,
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

    // 猜你想问组从卡片右侧一个卡片间距处开始，纵向从卡片顶部向下堆叠
    if (!showsGhosts(card)) continue
    rects.push({
      id: card.id,
      kind: 'ghost',
      x: position.x + size.width + gap,
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
 * 碰撞检查：同列矩形相交时把较低的那个（含整棵子树）整体下推一个卡片间距，
 * 重复直到任意卡片与卡片、卡片与 ghost 组之间都不相交。
 */
function resolveOverlaps(
  positions: LayoutPositions,
  cards: GraphFlowNode[],
  size: { width: number; height: number },
  gap: number,
) {
  const laneStep = size.height + gap

  for (let pass = 0; pass < 300; pass += 1) {
    const rects = collectRects(positions, cards, size, gap).sort(
      (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
    )

    let pushed = false
    for (let i = 0; i < rects.length && !pushed; i += 1) {
      const upper = rects[i]
      for (let j = i + 1; j < rects.length; j += 1) {
        const lower = rects[j]
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

/** 按父节点分组子卡片，并按创建时间升序（第一个为主干，其余为分支头） */
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
 * 自动整理：两种连接方式共用「主干同线 + 分支头按 lane 堆叠」的规则。
 *
 * - 第一子卡片为主干：放在父卡片正右方，与父卡片同一 y，主干链始终是一条水平直线。
 * - 第 2、3… 子卡片为分支头：
 *   - 直接分支：落在父卡片同 x 列的正下方；
 *   - 共用母线：落在父卡片右侧下一列，与主干子卡片同列，纵向错开；
 * - 分支头自己的第一子卡片再次成为该分支的主干，继续向右延伸。
 */
function lanePositions(
  cards: GraphFlowNode[],
  size: { width: number; height: number },
  connectionStyle: 'direct' | 'bus',
  gap: number,
): LayoutPositions {
  const positions: LayoutPositions = new Map()
  const root = cards.find((card) => card.data.node.parentId === null)
  if (!root) return positions

  const groups = childrenByParent(cards)
  const stepX = size.width + gap
  const laneStep = size.height + gap
  const baseX = root.position.x
  const baseY = root.position.y

  /** 递归摆放子树，返回该子树占用到的最大 lane */
  const place = (card: GraphFlowNode, x: number, y: number, lane: number): number => {
    positions.set(card.id, { x, y })
    let maxLane = lane

    const children = groups.get(card.id) ?? []
    // 第一子卡片永远是主干，即使它是通过分支功能创建的
    const mainChild = children[0]
    if (mainChild) {
      maxLane = Math.max(maxLane, place(mainChild, x + stepX, y, lane))
    }

    for (let index = 1; index < children.length; index += 1) {
      const branch = children[index]
      const branchLane = maxLane + 1
      const branchY = baseY + branchLane * laneStep
      const branchX = connectionStyle === 'direct' ? x : x + stepX
      maxLane = Math.max(maxLane, place(branch, branchX, branchY, branchLane))
    }

    return maxLane
  }

  place(root, baseX, baseY, 0)
  return positions
}

/**
 * 自动整理入口：按连接方式计算聊天卡片最终坐标。
 * 元卡片保持当前位置作为基准，笔记卡片不参与布局。
 */
export function computeAutoLayout(
  cards: GraphFlowNode[],
  size: { width: number; height: number },
  connectionStyle: 'direct' | 'bus',
  gap: number,
): LayoutPositions {
  const chatCards = chatCardsOf(cards)
  const positions = lanePositions(chatCards, size, connectionStyle, gap)
  resolveOverlaps(positions, chatCards, size, gap)
  return positions
}
