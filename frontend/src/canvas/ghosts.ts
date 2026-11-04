import type { Node } from '@xyflow/react'
import type { BranchInput, GraphFlowNode } from '../store/graphStore'

/** 建议箭头的节点数据 */
export type GhostNodeData = { parentId: string; suggestionId: string; text: string }

/** 自定义输入箭头的节点数据 */
export type GhostInputNodeData = { parentId: string }

/** 分支输入条的节点数据 */
export type BranchInputNodeData = { inputId: string }

/** 建议箭头节点 */
export type SuggestionGhostNode = Node<GhostNodeData, 'ghost'>

/** 输入箭头节点 */
export type InputGhostNode = Node<GhostInputNodeData, 'ghost-input'>

/** 分支输入条节点 */
export type BranchInputFlowNode = Node<BranchInputNodeData, 'branch-input'>

/** ghost 节点的联合类型（建议箭头 + 输入箭头） */
export type GhostFlowNode = SuggestionGhostNode | InputGhostNode

/** 候选方向与父卡片之间的水平间距，与后端创建子节点时的坐标规则一致；自动整理据此预留 ghost 列 */
export const GHOST_X_GAP = 320
/** ghost 卡片自身高度，与 GhostNode / GhostInputNode 的 44px 保持一致 */
const GHOST_HEIGHT = 44
/** ghost 卡片之间的纵向间距 */
const GHOST_GAP = 8
/** 分支输入条之间的纵向堆叠间距 */
const BRANCH_INPUT_GAP = 52
/** 分支卡片与父卡片/兄弟分支之间的纵向间距，与后端 BRANCH_GAP 保持一致 */
export const BRANCH_GAP = 64

/**
 * 由卡片派生 ghost 箭头。
 * 候选方向紧凑纵向堆叠：组顶部与父卡片顶部对齐，x 位于父卡片右侧 320px。
 * 每条未被使用的建议生成一个 ghost 节点，每个已消费过滤后的卡片末尾再追加一个输入箭头。
 * 父卡片已消费候选方向（单选过一条）时整组隐藏，包括输入项。
 */
export function buildGhostNodes(
  cards: GraphFlowNode[],
  cardSize: { width: number; height: number },
): GhostFlowNode[] {
  /** 已被创建成子卡片的建议，键为「父节点 id:建议 id」 */
  const usedSuggestions = new Set<string>()

  for (const card of cards) {
    const node = card.data.node
    if (node.parentId && node.origin === 'suggestion' && node.suggestionId) {
      usedSuggestions.add(`${node.parentId}:${node.suggestionId}`)
    }
  }

  const ghosts: GhostFlowNode[] = []
  const step = GHOST_HEIGHT + GHOST_GAP

  for (const card of cards) {
    const node = card.data.node
    // 笔记不产生建议与输入箭头，直接跳过
    if (node.nodeType === 'note') continue
    // 只有已完成且未被消费建议的卡片才展示候选方向
    if (node.status !== 'done' || node.suggestionsConsumed) continue

    const x = card.position.x + cardSize.width + GHOST_X_GAP
    const seen = new Set<string>()
    let index = 0

    for (const suggestion of node.suggestions) {
      if (usedSuggestions.has(`${node.id}:${suggestion.id}`) || seen.has(suggestion.id)) continue
      seen.add(suggestion.id)
      ghosts.push({
        id: `ghost:${node.id}:${suggestion.id}`,
        type: 'ghost',
        // 坐标取拖拽后的最新 position，而非 data.node.x/y
        position: { x, y: card.position.y + index * step },
        data: { parentId: node.id, suggestionId: suggestion.id, text: suggestion.text },
        // 候选方向始终浮在卡片之上，避免重叠时被遮挡
        zIndex: 10,
        draggable: false,
        selectable: false,
        deletable: false,
        connectable: false,
      })
      index += 1
    }

    // 输入箭头排在所有候选方向之后
    ghosts.push({
      id: `ghost-input:${node.id}`,
      type: 'ghost-input',
      position: { x, y: card.position.y + index * step },
      data: { parentId: node.id },
      // 与候选方向同层，保证可点击、可输入
      zIndex: 10,
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
        y: parent.position.y + cardSize.height + BRANCH_GAP + index * BRANCH_INPUT_GAP,
      },
      data: { inputId: input.id },
      // 输入条高于卡片，与候选方向同层
      zIndex: 10,
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false,
    })
  }

  return nodes
}
