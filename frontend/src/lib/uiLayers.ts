/**
 * 画布内动态显示层级：同类 UI 元素之间按「最新显示 / 有状态更新 / 获焦」排序。
 * 约定见 docs/development.md；不同类型之间用固定区段区分，互不干扰。
 */

/** 各类 UI 的层级基线：同类型在基线之后按序号递增 */
export const UI_LAYER_BASE = {
  /** 聊天卡片（含卡片内部抽屉） */
  card: 10,
  /** 猜你想问（建议箭头与自定义方向输入） */
  ghost: 400,
  /** 笔记卡片：必须高于猜你想问，避免被建议组遮挡 */
  note: 800,
  /** 新建分支输入条：必须高于卡片、猜你想问与笔记 */
  branchInput: 1200,
} as const

export type UiLayerKind = keyof typeof UI_LAYER_BASE

/** 单调递增序号，越大越靠上 */
let sequence = 0
/** key → 最近一次置顶序号 */
const layers = new Map<string, number>()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

/** 把某个 UI 元素提到同类元素的最上层；已经是全局最新时直接跳过 */
export function bumpUiLayer(key: string): void {
  if (layers.get(key) === sequence) return
  sequence += 1
  layers.set(key, sequence)
  notify()
}

/** 元素卸载时清理层级记录，避免 Map 无限增长 */
export function dropUiLayer(key: string): void {
  if (layers.delete(key)) notify()
}

/** 读取层级序号，未记录按 0 处理（排在最下面） */
export function getUiLayer(key: string): number {
  return layers.get(key) ?? 0
}

/** 订阅变更，配合 useSyncExternalStore 让画布重算 zIndex */
export function subscribeUiLayer(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 供 useSyncExternalStore 使用的快照：只关心「有没有变化」 */
export function getUiLayerVersion(): number {
  return sequence
}

/** 按当前序号给同类元素分配连续的 zIndex（小的在下、大的在上） */
export function resolveLayerZ(
  kind: UiLayerKind,
  keys: string[],
): Map<string, number> {
  const sorted = [...keys].sort((a, b) => getUiLayer(a) - getUiLayer(b))
  const result = new Map<string, number>()
  sorted.forEach((key, index) => result.set(key, UI_LAYER_BASE[kind] + index))
  return result
}
