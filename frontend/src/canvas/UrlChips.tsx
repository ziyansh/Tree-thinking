import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface UrlChipsProps {
  /** 已从输入框抽离的链接列表（按编号顺序） */
  urls: string[]
  /** 点击 × 时移除对应链接 */
  onRemove: (url: string) => void
  /** 双击后提交新链接：调用方负责校验、去重与保持编号顺序 */
  onEdit: (oldUrl: string, nextUrl: string) => void
}

/** 单击打开链接：裸域名（如 github.com/owner/repo）自动补 https:// */
function openUrl(url: string) {
  const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`
  window.open(target, '_blank', 'noopener,noreferrer')
}

/** 输入框下方的链接胶囊：单击访问、双击编辑、× 移除；无链接时不渲染 */
export function UrlChips({ urls, onRemove, onEdit }: UrlChipsProps) {
  /** 正在编辑的链接（双击进入），同一时刻只编辑一条 */
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 单击打开链接的延时器：双击时取消，避免先打开新标签再进入编辑 */
  const clickTimerRef = useRef<number | null>(null)

  // 卸载时清理未执行的单击定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    }
  }, [])

  // 编辑中的链接被外部移除时按未编辑处理，避免残留输入框
  const activeEditing = editing !== null && urls.includes(editing) ? editing : null

  /** 单击：延迟打开；双击会在延时内取消该定时器 */
  const handleClick = (url: string) => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      openUrl(url)
    }, 220)
  }

  /** 双击：取消单击打开，进入内联编辑并全选原文 */
  const startEdit = (url: string) => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    setEditing(url)
    setDraft(url)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  /** Enter 或失焦保存：新值与原值不同时交给调用方归一化 */
  const commitEdit = () => {
    if (activeEditing === null) return
    const next = draft.trim()
    if (next && next !== activeEditing) onEdit(activeEditing, next)
    setEditing(null)
  }

  const cancelEdit = () => setEditing(null)

  if (urls.length === 0) return null

  return (
    <div
      className="nodrag flex shrink-0 flex-wrap items-center gap-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {urls.map((url, index) => (
        <div
          key={url}
          title={
            activeEditing === url
              ? '编辑链接后按 Enter 保存，Esc 取消'
              : '单击访问链接，双击编辑'
          }
          className="chip-in glass-surface flex min-w-0 items-center gap-1.5 rounded-lg border border-subtle px-1.5 py-1"
          onClick={() => {
            if (activeEditing === null) handleClick(url)
          }}
          onDoubleClick={() => {
            if (activeEditing !== url) startEdit(url)
          }}
        >
          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-ghost-border px-1 text-[10px] leading-none text-muted">
            {index + 1}
          </span>
          {activeEditing === url ? (
            <input
              ref={inputRef}
              value={draft}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitEdit()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEdit()
                }
              }}
              onBlur={commitEdit}
              className="w-[150px] rounded bg-canvas px-1 text-[11px] text-body outline-none"
            />
          ) : (
            <span className="truncate text-[11px] text-body" style={{ maxWidth: '180px' }}>
              {url}
            </span>
          )}
          <button
            type="button"
            title="取消链接"
            aria-label="取消链接"
            // 编辑中点击 × 时阻止输入框先失焦提交，再按删除处理
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              setEditing(null)
              onRemove(url)
            }}
            className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-danger/10 hover:text-danger"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
