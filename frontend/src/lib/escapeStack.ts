import { useEffect, useRef } from 'react'

/**
 * 统一 Escape 动作栈（LIFO）：后打开浮层的处理器先入栈，
 * 按 Escape 时只触发栈顶，其余层保持打开；再次按 Escape 依次撤销。
 */
const handlers: Array<() => void> = []
/** 监听是否已安装：栈为空时摘掉，避免常驻全局监听 */
let installed = false

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = handlers[handlers.length - 1]
  if (!top) return
  event.preventDefault()
  event.stopPropagation()
  top()
}

function install(): void {
  if (installed) return
  installed = true
  // capture 阶段处理，保证先于组件内部的 Esc 逻辑与画布快捷键
  window.addEventListener('keydown', handleKeyDown, true)
}

function uninstall(): void {
  if (!installed || handlers.length > 0) return
  installed = false
  window.removeEventListener('keydown', handleKeyDown, true)
}

/** 入栈并返回注销函数（重复调用注销无副作用） */
export function pushEscapeHandler(handler: () => void): () => void {
  install()
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
    uninstall()
  }
}

/** 声明式入栈：active 为 true 时入栈，false 或卸载时出栈；handler 始终取最新引用 */
export function useEscapeHandler(active: boolean, handler: () => void): void {
  const handlerRef = useRef(handler)

  // 在 effect 中同步最新 handler，避免在渲染期写 ref
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!active) return
    return pushEscapeHandler(() => handlerRef.current())
  }, [active])
}
