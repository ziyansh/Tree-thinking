import type { Node } from '@xyflow/react'
import type { BranchInput, GraphFlowNode } from '../store/graphStore'

/** 建议箭头的节点数据 */
export type GhostNodeData = { parentId: string; suggestionId: string; text: string }

/** 自定义输入箭头的节点数据 */
export type GhostInputNodeData = {
  parentId: string
  /** 挂载后直接展开并聚焦（无候选方向的默认输入入口） */
  autoOpen?: boolean
  /** 展开时预填的内容，来自 store 的 ghostDrafts */
  initialQuestion?: string
}

/** 分支输入条的节点数据 */
export type BranchInputNodeData = { inputId: string; parentId: string }

/** 建议箭头节点 */
export type SuggestionGhostNode = Node<GhostNodeData, 'ghost'>

/** 输入箭头节点 */
export type InputGhostNode = Node<GhostInputNodeData, 'ghost-input'>

/** 分支输入条节点 */
export type BranchInputFlowNode = Node<BranchInputNodeData, 'branch-input'>

/** ghost 节点的联合类型（建议箭头 + 输入箭头） */
export type GhostFlowNode = SuggestionGhostNode | InputGhostNode

/** ghost 卡片预留宽度（14px 字号基准，布局与边线避让共用），与 GhostNode 的最大宽度保持一致 */
export const GHOST_WIDTH = 420

/** ghost 卡片之间的纵向间距 */
export const GHOST_GAP = 8

/** 输入箭头收起态高度，与 GhostInputNode 的 min-h-[44px] 保持一致 */
export const GHOST_INPUT_HEIGHT = 44

/** 输入箭头默认展开态高度，与 GhostInputNode 的 min-h-[120px] 保持一致 */
export const GHOST_INPUT_OPEN_HEIGHT = 120

/** 分支输入条之间的纵向堆叠间距：输入条已改为多行 composer 样式 */
const BRANCH_INPUT_GAP = 170

/**
 * 估算候选方向 ghost 的实际高度：每行约 26 个字符、行高 20px、上下内边距 12px，最小 44px，
 * 再乘以字号缩放比例；与 GhostNode 的尺寸规则保持一致，避免多行文本互相覆盖。
 */
export function suggestionGhostHeight(text: string, fontScale = 1): number {
  return Math.max(44, Math.ceil(text.length / 26) * 20 + 12) * fontScale
}

/** 每张卡片已挂载的子卡片数量与已消费的候选方向，渲染与布局共用同一份统计 */
export function collectGhostUsage(cards: GraphFlowNode[]): {
  childCount: Map<string, number>
  usedSuggestions: Set<string>
} {
  const childCount = new Map<string, number>()
  const usedSuggestions = new Set<string>()
  for (const card of cards) {
    const node = card.data.node
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1)
    if (node.parentId && node.origin === 'suggestion' && node.suggestionId) {
      usedSuggestions.add(`${node.parentId}:${node.suggestionId}`)
    }
  }
  return { childCount, usedSuggestions }
}

/**
 * 卡片是否会显示右侧提问区（建议箭头 / 输入箭头）。
 * 与下方 buildGhostNodes 的展示条件复用同一规则，避免布局避让与渲染漂移：
 * 已完成的聊天卡片，只要还有候选方向，或者自身尚无子卡片（默认展开自定义方向输入），就显示。
 */
export function showsGhostGroup(
  node: GraphFlowNode['data']['node'],
  hasChildren: boolean,
): boolean {
  if (node.nodeType !== 'chat' || node.status !== 'done') return false
  const showSuggestions = !node.suggestionsConsumed && node.suggestions.length > 0
  return !(hasChildren && !showSuggestions)
}

/** 组内仍需展示的候选方向：过滤已消费与重复 id */
export function pendingSuggestions(
  node: GraphFlowNode['data']['node'],
  usedSuggestions: Set<string>,
): GraphFlowNode['data']['node']['suggestions'] {
  const seen = new Set<string>()
  return node.suggestions.filter((suggestion) => {
    if (usedSuggestions.has(`${node.id}:${suggestion.id}`) || seen.has(suggestion.id)) return false
    seen.add(suggestion.id)
    return true
  })
}

/**
 * 估算卡片右侧提问区的总高度（含末尾输入箭头与组内间距），布局避让与检测共用。
 * 无候选方向且没有子卡片时输入箭头默认展开，按展开态高度估算。
 */
export function ghostGroupHeight(
  node: GraphFlowNode['data']['node'],
  hasChildren: boolean,
  usedSuggestions: Set<string>,
  fontScale = 1,
): number {
  let height = 0
  for (const suggestion of pendingSuggestions(node, usedSuggestions)) {
    height += suggestionGhostHeight(suggestion.text, fontScale) + GHOST_GAP
  }
  const showSuggestions = !node.suggestionsConsumed && node.suggestions.length > 0
  const open = !hasChildren && !showSuggestions
  return height + (open ? GHOST_INPUT_OPEN_HEIGHT : GHOST_INPUT_HEIGHT) * fontScale + GHOST_GAP
}

/**
 * 由卡片派生 ghost 箭头。
 * 候选方向紧凑纵向堆叠：组顶部与父卡片顶部对齐，x 位于父卡片右侧一个卡片间距处。
 * 每条未被使用的建议生成一个 ghost 节点，每张卡片末尾再追加一个输入箭头（同一父卡片最多一个）。
 * 没有子卡片时输入箭头默认展开：候选方向组隐藏时直接展开，候选方向仍然显示时仅在
 * 有预填草稿（停止生成删除子卡片）的情况下展开。
 */
export function buildGhostNodes(
  cards: GraphFlowNode[],
  cardSize: { width: number; height: number },
  cardGap: number,
  getGhostDraft: (parentId: string) => string = () => '',
  fontScale = 1,
): GhostFlowNode[] {
  /** 已被创建成子卡片的建议与每个父卡片的子卡片数量：与布局共用同一份统计 */
  const { childCount, usedSuggestions } = collectGhostUsage(cards)

  const ghosts: GhostFlowNode[] = []

  for (const card of cards) {
    const node = card.data.node
    const hasChildren = (childCount.get(node.id) ?? 0) > 0
    // 展示条件与布局避让共用同一规则（排除笔记、未完成与已消费且有子卡片的情况）
    if (!showsGhostGroup(node, hasChildren)) continue

    const showSuggestions = !node.suggestionsConsumed && node.suggestions.length > 0

    const x = card.position.x + cardSize.width + cardGap
    /** 已排入的 ghost 累计高度：按每条候选的实际估算高度向下累加 */
    let offset = 0

    if (showSuggestions) {
      for (const suggestion of pendingSuggestions(node, usedSuggestions)) {
        ghosts.push({
          id: `ghost:${node.id}:${suggestion.id}`,
          type: 'ghost',
          // 坐标取拖拽后的最新 position，而非 data.node.x/y
          position: { x, y: card.position.y + offset },
          data: { parentId: node.id, suggestionId: suggestion.id, text: suggestion.text },
          // zIndex 由 Canvas 的动态层级分配器统一设置
          draggable: false,
          selectable: false,
          deletable: false,
          connectable: false,
        })
        offset += suggestionGhostHeight(suggestion.text, fontScale) + GHOST_GAP
      }
    }

    const draft = getGhostDraft(node.id)
    // 输入箭头排在所有候选方向之后，每个父卡片只生成一次
    ghosts.push({
      id: `ghost-input:${node.id}`,
      type: 'ghost-input',
      position: { x, y: card.position.y + offset },
      data: {
        parentId: node.id,
        // 没有子卡片且候选方向组不显示（或有预填内容）时默认展开
        autoOpen: !hasChildren && (!showSuggestions || draft.trim().length > 0),
        initialQuestion: draft,
      },
      // zIndex 由 Canvas 的动态层级分配器统一设置
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false,
    })
  }

  return ghosts
}

/**
 * 由分支输入条派生节点：位于父卡片正下方，同父多条按 52px 向下堆叠。
 * 坐标取拖拽后的最新 position，保证输入条跟随卡片移动。
 */
export function buildBranchInputNodes(
  inputs: BranchInput[],
  cards: GraphFlowNode[],
  cardSize: { width: number; height: number },
  cardGap: number,
): BranchInputFlowNode[] {
  const nodes: BranchInputFlowNode[] = []
  /** 每个父卡片已排入的输入条数量，用于计算堆叠序号 */
  const stacked = new Map<string, number>()

  for (const input of inputs) {
    const parent = cards.find((item) => item.id === input.parentId)
    if (!parent) continue
    const index = stacked.get(input.parentId) ?? 0
    stacked.set(input.parentId, index + 1)
    nodes.push({
      id: input.id,
      type: 'branch-input',
      position: {
        x: parent.position.x,
        y: parent.position.y + cardSize.height + cardGap + index * BRANCH_INPUT_GAP,
      },
      data: { inputId: input.id, parentId: input.parentId },
      // zIndex 由 Canvas 的动态层级分配器统一设置（分支输入条区段最高）
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false,
    })
  }

  return nodes
}
