import { useSyncExternalStore } from 'react'

/**
 * 自定义方向输入框的焦点协调：同一时间只有最后聚焦的输入框保持展开。
 * 点击空白画布不清空，避免用户只是移开视线就收起输入框。
 */
let activeInputId: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setActiveGhostInput(id: string | null): void {
  if (activeInputId === id) return
  activeInputId = id
  emit()
}

export function useActiveGhostInput(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => activeInputId,
    () => null,
  )
}
