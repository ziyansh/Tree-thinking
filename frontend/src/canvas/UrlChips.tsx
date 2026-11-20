import { X } from 'lucide-react'
import { extractUrls } from '../lib/urlChips'

interface UrlChipsProps {
  /** 输入框当前文本，用于解析其中的链接 */
  text: string
  /** 点击 × 时移除对应链接 */
  onRemove: (url: string) => void
}

/** 输入框下方的链接胶囊：编号 + URL + 移除按钮，无链接时不渲染 */
export function UrlChips({ text, onRemove }: UrlChipsProps) {
  const urls = extractUrls(text)
  if (urls.length === 0) return null

  return (
    <div
      className="nodrag flex shrink-0 flex-wrap items-center gap-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {urls.map((url, index) => (
        <div
          key={url}
          title={url}
          className="chip-in glass-surface flex min-w-0 items-center gap-1.5 rounded-lg border border-subtle px-1.5 py-1"
        >
          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-ghost-border px-1 text-[10px] leading-none text-muted">
            {index + 1}
          </span>
          <span className="truncate text-[11px] text-body" style={{ maxWidth: '180px' }}>
            {url}
          </span>
          <button
            type="button"
            title="取消链接"
            aria-label="取消链接"
            onClick={(event) => {
              event.stopPropagation()
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
