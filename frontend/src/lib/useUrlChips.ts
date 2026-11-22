import { useCallback, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import { composeWithUrls, mergeUrls, replaceUrl, splitUrls } from './urlChips'

/**
 * 粘贴时把链接直接转成胶囊：只把非链接文本插到光标处，返回是否已接管。
 * 供本地 state 与 store 草稿两种输入框共用。
 */
export function absorbUrlPaste(
  event: ReactClipboardEvent<HTMLTextAreaElement>,
  commit: (next: string) => void,
  takeUrls: (urls: string[]) => void,
): boolean {
  const raw = event.clipboardData?.getData('text/plain') ?? ''
  if (!raw) return false
  const result = splitUrls(raw)
  if (result.urls.length === 0) return false

  event.preventDefault()
  const element = event.currentTarget
  const start = element.selectionStart ?? element.value.length
  const end = element.selectionEnd ?? start
  commit(element.value.slice(0, start) + result.text + element.value.slice(end))
  takeUrls(result.urls)
  // 受控组件更新后再把光标放到插入文本末尾
  const caret = start + result.text.length
  window.requestAnimationFrame(() => {
    element.selectionStart = caret
    element.selectionEnd = caret
  })
  return true
}

/** 空链接列表：给 zustand selector 复用，避免每次返回新数组 */
const NO_URLS: string[] = []

/**
 * 输入框链接胶囊状态：链接从文本中抽离后单独保存，
 * 提交时再按胶囊编号顺序拼回问题末尾，输入框内不再显示链接原文。
 * initial 用于打开已有提问时把文本里已解析出的链接预先转成胶囊。
 */
export function useUrlChips(initial: string[] = NO_URLS) {
  const [urls, setUrls] = useState<string[]>(() => mergeUrls([], initial))
  // 事件回调中读取最新列表，避免闭包拿到旧值（同一 tick 内的 blur → 提交也能拿到新链接）
  const urlsRef = useRef(urls)
  const commit = useCallback((next: string[]) => {
    urlsRef.current = next
    setUrls(next)
  }, [])

  /** 把文本中已写完整的链接抽成胶囊，返回剩余文本 */
  const absorbText = useCallback(
    (raw: string): string => {
      const result = splitUrls(raw)
      if (result.urls.length > 0) {
        commit(mergeUrls(urlsRef.current, result.urls))
      }
      return result.text
    },
    [commit],
  )

  /** 粘贴时接管：链接变胶囊，其余文本插入光标处 */
  const absorbPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>, insert: (next: string) => void): boolean =>
      absorbUrlPaste(event, insert, (found) => {
        commit(mergeUrls(urlsRef.current, found))
      }),
    [commit],
  )

  /** 提交前兜底抽取：返回去掉链接的文本与用于提交的完整问题 */
  const finalize = useCallback(
    (raw: string): { text: string; question: string } => {
      const result = splitUrls(raw)
      const merged = mergeUrls(urlsRef.current, result.urls)
      if (result.urls.length > 0) commit(merged)
      return { text: result.text, question: composeWithUrls(result.text, merged) }
    },
    [commit],
  )

  const remove = useCallback(
    (url: string) => {
      commit(urlsRef.current.filter((item) => item !== url))
    },
    [commit],
  )

  /** 双击编辑胶囊：保持原编号顺序，新值不是合法链接时忽略 */
  const edit = useCallback(
    (oldUrl: string, raw: string) => {
      const next = replaceUrl(urlsRef.current, oldUrl, raw)
      if (next !== urlsRef.current) commit(next)
    },
    [commit],
  )

  /** 用给定列表整体替换（打开已有提问时把其中的链接转成胶囊） */
  const replace = useCallback(
    (next: string[]) => {
      commit(mergeUrls([], next))
    },
    [commit],
  )

  const clear = useCallback(() => commit([]), [commit])

  return { urls, absorbText, absorbPaste, finalize, remove, edit, replace, clear }
}
