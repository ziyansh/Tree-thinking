import { memo, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Pin, Trash2 } from 'lucide-react'
import {
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  useGraphStore,
} from '../store/graphStore'
import type { NoteFlowNode } from '../store/graphStore'
import { CORNER_ZONES, EDGE_ZONES, IconButton } from './CardNode'
import type { ResizeEdge } from './CardNode'
import { formatModifiedTime } from '../lib/time'
import { useSpacePressed } from '../lib/spaceKey'

/** 笔记卡片：双击空白画布创建，标题/正文独立编辑，拥有自己的宽高 */
function NoteNodeInner({ data }: NodeProps<NoteFlowNode>) {
  const { node } = data
  const updateNoteTitle = useGraphStore((state) => state.updateNoteTitle)
  const updateNoteContent = useGraphStore((state) => state.updateNoteContent)
  const updateNoteSize = useGraphStore((state) => state.updateNoteSize)
  const togglePin = useGraphStore((state) => state.togglePin)
  const removeNode = useGraphStore((state) => state.deleteNode)
  // 选中态与聊天卡片共用同一份多选集合
  const isSelected = useGraphStore((state) => state.selectedNodeIds.includes(node.id))
  // 修改时间跟随设置中的时间制式，设置变更后立即重新格式化
  const timeFormat = useGraphStore((state) => state.preferences.timeFormat)
  // 双击进入编辑：沿用设置中的双击间隔与漂移距离
  const doubleClickMs = useGraphStore((state) => state.preferences.doubleClickMs)
  const dragDriftDistance = useGraphStore((state) => state.preferences.dragDriftDistance)
  // 滚轮逻辑：悬停笔记正文时滚动内容或缩放画布；按住空格时始终缩放
  const wheelMode = useGraphStore((state) => state.preferences.wheelMode)
  const spacePressed = useSpacePressed()
  const modifiedTime = formatModifiedTime(node.updatedAt, timeFormat)

  const [title, setTitle] = useState(node.question)
  const [content, setContent] = useState(node.answer)
  // 标题与正文默认只读，双击才进入编辑，单击留给拖拽与选中
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  // Esc 取消标题编辑时置位，避免随后的失焦再次提交
  const escapedRef = useRef(false)
  // Esc 取消正文编辑时置位，避免随后的失焦提交
  const skipContentCommitRef = useRef(false)
  // 双击判定：记录按下坐标与上次点击时间
  const titlePointerRef = useRef<{ x: number; y: number } | null>(null)
  const contentPointerRef = useRef<{ x: number; y: number } | null>(null)
  const lastTitleClickRef = useRef(0)
  const lastContentClickRef = useRef(0)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const contentInputRef = useRef<HTMLTextAreaElement | null>(null)
  // 缩放中的实时尺寸预览，松手后写入 store 并持久化
  const [sizeDraft, setSizeDraft] = useState<{ width: number; height: number } | null>(null)

  // 外部变化（撤销、重新载入）时同步本地草稿
  useEffect(() => setTitle(node.question), [node.question])
  useEffect(() => setContent(node.answer), [node.answer])

  const width = sizeDraft?.width ?? node.width ?? NOTE_DEFAULT_WIDTH
  const height = sizeDraft?.height ?? node.height ?? NOTE_DEFAULT_HEIGHT

  const commitTitle = () => {
    setEditingTitle(false)
    if (escapedRef.current) {
      escapedRef.current = false
      return
    }
    const next = title.trim()
    // 未改动时不发请求
    if (next === node.question) return
    void updateNoteTitle(node.id, next)
  }

  const commitContent = () => {
    setEditingContent(false)
    if (skipContentCommitRef.current) {
      skipContentCommitRef.current = false
      return
    }
    if (content === node.answer) return
    void updateNoteContent(node.id, content)
  }

  // 进入编辑后聚焦并把光标放到末尾，避免从开头插入；同时清理上一次 Esc 留下的标记
  useEffect(() => {
    if (!editingTitle) return
    escapedRef.current = false
    const element = titleInputRef.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
  }, [editingTitle])

  useEffect(() => {
    if (!editingContent) return
    skipContentCommitRef.current = false
    const element = contentInputRef.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
  }, [editingContent])

  /**
   * 双击判定：与聊天卡片标题一致，按下与松开的位移超过漂移距离视为拖动，
   * 不算点击；两次点击在设置的间隔内才进入编辑。
   */
  const handleTitlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    titlePointerRef.current = { x: event.clientX, y: event.clientY }
  }

  const handleTitlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const down = titlePointerRef.current
    titlePointerRef.current = null
    if (!down) return
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    if (moved > dragDriftDistance) {
      lastTitleClickRef.current = 0
      return
    }
    const now = performance.now()
    if (lastTitleClickRef.current && now - lastTitleClickRef.current <= doubleClickMs) {
      lastTitleClickRef.current = 0
      setEditingTitle(true)
    } else {
      lastTitleClickRef.current = now
    }
  }

  const handleContentPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    contentPointerRef.current = { x: event.clientX, y: event.clientY }
  }

  const handleContentPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const down = contentPointerRef.current
    contentPointerRef.current = null
    if (!down) return
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    if (moved > dragDriftDistance) {
      lastContentClickRef.current = 0
      return
    }
    const now = performance.now()
    if (lastContentClickRef.current && now - lastContentClickRef.current <= doubleClickMs) {
      lastContentClickRef.current = 0
      setEditingContent(true)
    } else {
      lastContentClickRef.current = now
    }
  }

  /** 正文编辑：Tab 插入 4 个空格，Esc 放弃本次修改 */
  const handleContentKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      const target = event.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const next = `${content.slice(0, start)}    ${content.slice(end)}`
      setContent(next)
      // 等 React 回写 value 后再恢复光标位置
      requestAnimationFrame(() => target.setSelectionRange(start + 4, start + 4))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      skipContentCommitRef.current = true
      setContent(node.answer)
      setEditingContent(false)
    }
  }

  /** 四边/四角缩放：只改当前笔记的独立尺寸，最小 280×240，无上限 */
  const startResize =
    (edge: ResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // 阻止冒泡，避免触发节点拖动与选中
      event.preventDefault()
      event.stopPropagation()

      // 左/上边反向计算：向负方向拖动才增大尺寸
      const dirX = edge.includes('left') ? -1 : edge.includes('right') ? 1 : 0
      const dirY = edge.includes('top') ? -1 : edge.includes('bottom') ? 1 : 0

      const target = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      const startWidth = node.width ?? NOTE_DEFAULT_WIDTH
      const startHeight = node.height ?? NOTE_DEFAULT_HEIGHT
      let latest = { width: startWidth, height: startHeight }

      target.setPointerCapture(pointerId)

      const handleMove = (moveEvent: PointerEvent) => {
        // 只对实际拖动的方向做最小尺寸夹取，避免拖右边时把默认高度 220 抬到 240
        const width =
          dirX === 0
            ? startWidth
            : Math.max(NOTE_MIN_WIDTH, Math.round(startWidth + dirX * (moveEvent.clientX - startX)))
        const height =
          dirY === 0
            ? startHeight
            : Math.max(NOTE_MIN_HEIGHT, Math.round(startHeight + dirY * (moveEvent.clientY - startY)))
        latest = { width, height }
        setSizeDraft(latest)
      }

      const handleEnd = () => {
        target.removeEventListener('pointermove', handleMove)
        target.removeEventListener('pointerup', handleEnd)
        target.removeEventListener('pointercancel', handleEnd)
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
        setSizeDraft(null)
        // 尺寸未变化时不发请求
        if (latest.width === startWidth && latest.height === startHeight) return
        void updateNoteSize(node.id, latest.width, latest.height)
      }

      target.addEventListener('pointermove', handleMove)
      target.addEventListener('pointerup', handleEnd)
      target.addEventListener('pointercancel', handleEnd)
    }

  // 选中、悬停与错误态都由卡片外边框表达，缩放命中区本身保持透明

  const boxShadow = isSelected
    ? '0 0 0 1px var(--accent), 0 0 24px var(--accent-dim)'
    : '0 2px 10px color-mix(in srgb, var(--bg-canvas) 75%, transparent)'

  return (
    <div
      className={[
        'group card-drag-handle relative flex flex-col rounded-xl border bg-card p-3 transition-[border-color,box-shadow] duration-150 ease-out',
        node.pinned ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        isSelected ? 'border-accent' : 'border-subtle hover:border-accent',
      ].join(' ')}
      style={{ width, height, boxShadow }}
    >
      {/* 修改时间放在卡片外部右下角：绝对定位不撑开节点尺寸，也不拦截画布操作 */}
      {modifiedTime && (
        <span className="pointer-events-none absolute top-full right-0 mt-1 select-none text-[11px] text-muted/80">
          {modifiedTime}
        </span>
      )}

      {/* 标题栏同时作为拖动手柄：空白处可拖动整张笔记 */}
      <div className="card-drag-handle flex shrink-0 items-start gap-2">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={title}
            placeholder="笔记标题"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                escapedRef.current = true
                setTitle(node.question)
                setEditingTitle(false)
              }
            }}
            className="nodrag nopan selectable-text min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-semibold leading-snug text-accent outline-none placeholder:text-muted focus:bg-elevated"
            style={{ fontSize: 'calc(var(--card-font-size) + 1px)' }}
          />
        ) : (
          <h3
            onPointerDown={handleTitlePointerDown}
            onPointerUp={handleTitlePointerUp}
            className="min-w-0 flex-1 select-none break-words rounded-md px-1 py-0.5 font-semibold leading-snug text-accent"
            style={{ fontSize: 'calc(var(--card-font-size) + 1px)' }}
          >
            {title || <span className="text-muted">笔记标题</span>}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton title="删除笔记" danger onClick={() => void removeNode(node.id)}>
            <Trash2 size={14} />
          </IconButton>
          <IconButton
            title={node.pinned ? '取消固定' : '固定笔记'}
            active={node.pinned}
            onClick={() => void togglePin(node.id)}
          >
            <Pin size={14} />
          </IconButton>
        </div>
      </div>

      {/* 正文：默认只读，双击进入编辑；编辑中 Tab 插入 4 个空格 */}
      {editingContent ? (
        <textarea
          ref={contentInputRef}
          value={content}
          placeholder="记录你的想法…"
          onChange={(event) => setContent(event.target.value)}
          onBlur={commitContent}
          onKeyDown={handleContentKeyDown}
          className={[
            'nodrag nopan selectable-text mt-2 min-h-0 flex-1 resize-none rounded-lg border border-subtle bg-elevated px-2 py-1.5 leading-[1.65] text-body outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent',
            spacePressed ? '' : 'nowheel',
          ].join(' ')}
          style={{ fontSize: 'var(--card-font-size)' }}
        />
      ) : (
        <div
          onPointerDown={handleContentPointerDown}
          onPointerUp={handleContentPointerUp}
          className={[
            'mt-2 min-h-0 flex-1 select-none overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-subtle px-2 py-1.5 leading-[1.65] text-body',
            wheelMode === 'scroll-card' && !spacePressed ? 'nowheel' : '',
          ].join(' ')}
          style={{ fontSize: 'var(--card-font-size)' }}
        >
          {content || <span className="text-muted">双击编辑正文</span>}
        </div>
      )}

      {/* 四边与四角缩放命中区：仅提供光标与命中，不绘制高亮 */}
      {EDGE_ZONES.map((zone) => (
        <div
          key={zone.edge}
          role="separator"
          aria-label="拖动调整笔记尺寸"
          onPointerDown={startResize(zone.edge)}
          onClick={(event) => event.stopPropagation()}
          className={['nodrag nopan absolute', zone.position, zone.cursor].join(' ')}
        />
      ))}
      {CORNER_ZONES.map((zone) => (
        <div
          key={zone.edge}
          role="separator"
          aria-label="拖动调整笔记尺寸"
          onPointerDown={startResize(zone.edge)}
          onClick={(event) => event.stopPropagation()}
          className={['nodrag nopan absolute h-3 w-3', zone.position, zone.cursor].join(' ')}
        />
      ))}
    </div>
  )
}

export const NoteNode = memo(NoteNodeInner)
