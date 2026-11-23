import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '../api/client'
import type { SearchHit } from '../api/types'
import { useEscapeHandler } from '../lib/escapeStack'
import { highlightText } from '../lib/highlight'
import { useGraphStore } from '../store/graphStore'

/** 面板尺寸记忆键：只保存宽高，不涉及任何业务数据 */
const SIZE_KEY = 'tree-thinking:canvas-search-size'
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 320
const MIN_WIDTH = 280
const MIN_HEIGHT = 180

/** 读取记忆尺寸；本地存储不可用时回落到默认值 */
function readSize(): { width: number; height: number } {
  try {
    const raw = window.localStorage.getItem(SIZE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown }
      const width = Number(parsed.width)
      const height = Number(parsed.height)
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height }
      }
    }
  } catch {
    // 隐私模式等场景读不到时直接用默认尺寸
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
}

/** 结果标签：区分画布名、卡片标题与正文 */
function fieldLabel(hit: SearchHit): string {
  if (hit.field === 'project') return '画布'
  if (hit.field === 'title') return hit.nodeType === 'note' ? '笔记标题' : '卡片标题'
  return hit.nodeType === 'note' ? '笔记正文' : '回答'
}

interface CanvasSearchProps {
  open: boolean
  onClose: () => void
}

/** 画布内搜索：Ctrl+F 打开，只搜索当前画布；点击结果居中并选中卡片 */
export function CanvasSearch({ open, onClose }: CanvasSearchProps) {
  const currentProjectId = useGraphStore((state) => state.currentProjectId)
  const requestFocus = useGraphStore((state) => state.requestFocus)
  /** 双击判定沿用设置中的间隔 */
  const doubleClickMs = useGraphStore((state) => state.preferences.doubleClickMs)

  const [query, setQuery] = useState('')
  const [hitList, setHitList] = useState<SearchHit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** 上一次点击的结果与时间：用于按设置间隔判定双击 */
  const lastPickRef = useRef<{ key: string; time: number } | null>(null)

  useEscapeHandler(open, onClose)

  // 打开时聚焦并全选，便于直接覆盖上一次的关键词
  useEffect(() => {
    if (!open) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
    // 初始高度按内容撑开，避免单行输入出现滚动条
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [open])

  // 每次打开都按记忆尺寸初始化；用户拖动原生缩放手柄后写入记忆
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const saved = readSize()
    const width = Math.min(Math.max(saved.width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - 120))
    const height = Math.min(
      Math.max(saved.height, MIN_HEIGHT),
      Math.max(MIN_HEIGHT, window.innerHeight - 160),
    )
    panel.style.width = `${width}px`
    panel.style.height = `${height}px`

    let timer: number | null = null
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          window.localStorage.setItem(
            SIZE_KEY,
            JSON.stringify({ width: panel.offsetWidth, height: panel.offsetHeight }),
          )
        } catch {
          // 无法持久化时只影响下次打开时的尺寸
        }
      }, 200)
    })
    observer.observe(panel)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [open])

  // 关键词变化后防抖请求；只保留当前画布内命中卡片的条目
  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (!term) {
      setHitList([])
      setTruncated(false)
      setError('')
      setLoading(false)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      void api
        .search(term, currentProjectId ?? undefined)
        .then((result) => {
          if (!alive) return
          // 画布名命中的结果没有卡片可跳转，画布内搜索不展示
          setHitList(result.items.filter((item) => item.nodeId !== null))
          setTruncated(result.truncated)
          setError('')
        })
        .catch((err: unknown) => {
          if (!alive) return
          setHitList([])
          setError(err instanceof Error ? err.message : '搜索失败，请稍后重试')
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, query, currentProjectId])

  /** 点击结果：选中并把镜头移到命中内容；短时间内再次点击同一结果才缩放 */
  const pick = useCallback(
    (hit: SearchHit) => {
      if (!hit.nodeId) return
      const now = performance.now()
      const key = `${hit.nodeId}:${hit.field}`
      const zoom =
        lastPickRef.current?.key === key && now - lastPickRef.current.time <= doubleClickMs
      lastPickRef.current = { key, time: now }
      requestFocus(hit.nodeId, {
        field: hit.field,
        query: query.trim(),
        zoom: zoom ? 'reset' : 'keep',
      })
    },
    [requestFocus, doubleClickMs, query],
  )

  const handleInput = useCallback((value: string) => {
    setQuery(value)
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [])

  if (!open) return null

  const term = query.trim()

  return (
    <div
      ref={panelRef}
      data-search-panel="canvas"
      className="glass-surface-airy pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-subtle shadow-[0_12px_32px_rgba(0,0,0,0.24)]"
      style={{
        resize: 'both',
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        maxWidth: 'calc(100vw - 80px)',
        maxHeight: 'calc(100vh - 120px)',
      }}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <Search size={14} className="mt-1 shrink-0 text-muted" />
        <textarea
          ref={inputRef}
          rows={1}
          value={query}
          placeholder="在当前画布内搜索…"
          spellCheck={false}
          onChange={(event) => handleInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (hitList.length > 0) pick(hitList[0])
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          className="max-h-24 min-h-[22px] w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-[1.6] text-ink outline-none placeholder:text-muted"
        />
        <button
          type="button"
          title="关闭搜索"
          aria-label="关闭搜索"
          onClick={onClose}
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-subtle">
        {error ? (
          <p className="px-3 py-2 text-[12px] text-danger">{error}</p>
        ) : null}
        {!error && !term ? (
          <p className="px-3 py-2 text-[12px] text-muted">输入关键词后开始搜索当前画布。</p>
        ) : null}
        {!error && term && !loading && hitList.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-muted">没有匹配的内容。</p>
        ) : null}
        {hitList.map((hit) => (
          <button
            key={`${hit.nodeId}-${hit.field}`}
            type="button"
            onClick={() => pick(hit)}
            className="flex w-full flex-col gap-1 border-b border-subtle px-3 py-2 text-left transition-colors duration-150 last:border-b-0 hover:bg-ghost-border"
          >
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="shrink-0 rounded bg-elevated px-1 py-0.5">{fieldLabel(hit)}</span>
              <span className="truncate">{hit.updatedAt ? hit.updatedAt.slice(0, 10) : ''}</span>
            </span>
            <span className="line-clamp-2 break-words text-[12px] leading-[1.6] text-body">
              {highlightText(hit.snippet, term)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-subtle px-3 py-1.5 text-[11px] text-muted">
        <span>
          {loading ? '搜索中…' : `${hitList.length} 条结果${truncated ? '（已截断）' : ''}`}
        </span>
        <span className="pr-3">Esc 关闭 · 拖动右下角调整大小</span>
      </div>
    </div>
  )
}
