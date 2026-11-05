import { useSyncExternalStore } from 'react'

/**
 * 全局空格键状态：画布平移与滚轮逻辑都依赖它。
 * 统一在一处监听，避免每个卡片各自注册 keydown 监听。
 */
let pressed = false
const listeners = new Set<() => void>()
let installed = false

/** 输入类控件聚焦时不拦截空格，避免影响文字输入 */
function isEditing(): boolean {
  const element = document.activeElement as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  )
}

function emit(): void {
  for (const listener of listeners) listener()
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.code !== 'Space' || isEditing()) return
  // 阻止空格滚动页面
  event.preventDefault()
  if (pressed) return
  pressed = true
  emit()
}

function handleKeyUp(event: KeyboardEvent): void {
  if (event.code !== 'Space' || !pressed) return
  pressed = false
  emit()
}

// 窗口失焦时按键状态可能丢失，统一复位
function handleBlur(): void {
  if (!pressed) return
  pressed = false
  emit()
}

function install(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)
}

function uninstall(): void {
  if (!installed) return
  installed = false
  pressed = false
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', handleBlur)
}

function subscribeSpace(listener: () => void): () => void {
  install()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) uninstall()
  }
}

function getSpacePressed(): boolean {
  return pressed
}

/** 组件内读取空格是否按下 */
export function useSpacePressed(): boolean {
  return useSyncExternalStore(subscribeSpace, getSpacePressed, () => false)
}
