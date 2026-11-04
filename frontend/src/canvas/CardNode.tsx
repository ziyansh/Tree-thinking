import { memo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, Pin, RefreshCw, Trash2 } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { CardNodeData, CardFlowNode } from '../store/graphStore'
import { formatModifiedTime } from '../lib/time'

/** Markdown 正文样式：颜色只取自主题令牌，避免卡片被长回答撑高 */
const MARKDOWN_CLASS = [
  'nodrag selectable-text text-body leading-[1.65] break-words',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-1',
  '[&_h1]:my-3 [&_h1]:text-[1.15em] [&_h1]:font-semibold [&_h1]:text-ink',
  '[&_h2]:my-3 [&_h2]:text-[1.05em] [&_h2]:font-semibold [&_h2]:text-ink',
  '[&_h3]:my-2 [&_h3]:text-[1em] [&_h3]:font-semibold [&_h3]:text-ink',
  '[&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.93em] [&_code]:text-ink',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-elevated [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-subtle [&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_a]:text-accent [&_a]:underline [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-subtle [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-3 [&_hr]:border-subtle',
].join(' ')

interface IconButtonProps {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  /** 高亮态：固定按钮使用主题强调色 */
  active?: boolean
  children: ReactNode
}

/** 28×28 图标按钮，悬停底色统一取 ghost-border 令牌（笔记卡片复用同一套样式） */
export function IconButton({ title, onClick, disabled, danger, active, children }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        'nodrag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'text-muted hover:bg-ghost-border hover:text-danger'
          : active
            ? 'bg-accent-dim text-accent hover:bg-accent-dim'
            : 'text-muted hover:bg-ghost-border hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** 缩放命中区：四边 + 四角（笔记卡片复用同一套命中区） */
export type ResizeEdge =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/** 四边命中区：只改单一方向尺寸 */
export const EDGE_ZONES: { edge: ResizeEdge; position: string; cursor: string }[] = [
  { edge: 'top', position: 'left-0 right-0 top-0 h-[10px]', cursor: 'cursor-ns-resize' },
  { edge: 'bottom', position: 'bottom-0 left-0 right-0 h-[10px]', cursor: 'cursor-ns-resize' },
  { edge: 'left', position: 'left-0 top-0 bottom-0 w-[10px]', cursor: 'cursor-ew-resize' },
  { edge: 'right', position: 'right-0 top-0 bottom-0 w-[10px]', cursor: 'cursor-ew-resize' },
]

/** 四角命中区：同时改宽高，小方块作为可见提示 */
export const CORNER_ZONES: { edge: ResizeEdge; position: string; cursor: string }[] = [
  { edge: 'top-left', position: 'left-0 top-0', cursor: 'cursor-nwse-resize' },
  { edge: 'top-right', position: 'right-0 top-0', cursor: 'cursor-nesw-resize' },
  { edge: 'bottom-left', position: 'bottom-0 left-0', cursor: 'cursor-nesw-resize' },
  { edge: 'bottom-right', position: 'bottom-0 right-0', cursor: 'cursor-nwse-resize' },
]

function CardNodeInner({ data }: NodeProps<CardFlowNode>) {
  const { node }: CardNodeData = data
  const regenerate = useGraphStore((state) => state.regenerate)
  const regenerateSuggestions = useGraphStore((state) => state.regenerateSuggestions)
  const removeNode = useGraphStore((state) => state.deleteNode)
  const togglePin = useGraphStore((state) => state.togglePin)
  const startQuestion = useGraphStore((state) => state.startQuestion)
  const runAnswer = useGraphStore((state) => state.runAnswer)
  const addBranchInput = useGraphStore((state) => state.addBranchInput)
  const updateNodeTitle = useGraphStore((state) => state.updateNodeTitle)
  // 全局卡片尺寸：所有画布共用，拖动边缘时实时生效
  const cardSize = useGraphStore((state) => state.cardSize)
  const setCardSize = useGraphStore((state) => state.setCardSize)
  const saveCardSize = useGraphStore((state) => state.saveCardSize)
  // 选中态以 store 为准，保证程序化切换（新建子卡片）与点击选中的视觉一致
  const isSelected = useGraphStore((state) => state.selectedNodeIds.includes(node.id))
  // 修改时间跟随设置中的时间制式，设置变更后立即重新格式化
  const timeFormat = useGraphStore((state) => state.preferences.timeFormat)
  // 标题双击编辑使用设置里的双击间隔
  const doubleClickMs = useGraphStore((state) => state.preferences.doubleClickMs)
  const modifiedTime = formatModifiedTime(node.updatedAt, timeFormat)

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 上一次点击标题的时间，用于手动判定双击 */
  const lastTitleClickRef = useRef(0)

  const isStreaming = node.status === 'streaming'
  const isError = node.status === 'error'
  const isInput = node.status === 'input'
  // 元问题卡片固定尺寸，不提供缩放手柄；笔记节点也有 parentId=null，不能当作元卡片
  const isRoot = node.parentId === null && node.nodeType === 'chat'

  const handleCopy = async () => {
    const text = [node.question, node.answer].filter(Boolean).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败，不打断阅读
    }
  }

  const handleSubmit = async () => {
    const text = draft.trim()
    if (!text || submitting) return
    setSubmitting(true)
    try {
      const targetId = await startQuestion(node.id, text)
      if (targetId) {
        setDraft('')
        await runAnswer(targetId)
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** 双击标题进入编辑，Enter/失焦提交，Esc 取消 */
  const startTitleEdit = () => {
    setTitleDraft(node.question)
    setEditingTitle(true)
  }

  /** 按设置的双击间隔手动识别标题双击，避免依赖浏览器默认间隔 */
  const handleTitlePointerUp = () => {
    const now = performance.now()
    if (lastTitleClickRef.current && now - lastTitleClickRef.current <= doubleClickMs) {
      lastTitleClickRef.current = 0
      startTitleEdit()
    } else {
      lastTitleClickRef.current = now
    }
  }

  const commitTitle = () => {
    if (!editingTitle) return
    setEditingTitle(false)
    const title = titleDraft.trim()
    // 空标题或未改动时不发请求
    if (!title || title === node.question) return
    void updateNodeTitle(node.id, title)
  }

  /**
   * 四边/四角缩放：pointer capture 让指针移出卡片后仍持续收到事件，
   * 拖动过程只改本地全局尺寸，松手后再统一持久化
   */
  const startResize =
    (edge: ResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // 阻止冒泡与默认行为，避免触发 React Flow 的节点拖动与选中
      event.preventDefault()
      event.stopPropagation()

      // 左/上边反向计算：向负方向拖动才增大尺寸
      const dirX = edge.includes('left') ? -1 : edge.includes('right') ? 1 : 0
      const dirY = edge.includes('top') ? -1 : edge.includes('bottom') ? 1 : 0

      const target = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      const startWidth = cardSize.width
      const startHeight = cardSize.height
      target.setPointerCapture(pointerId)
      setResizing(true)

      const handleMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        setCardSize(startWidth + dirX * dx, startHeight + dirY * dy)
      }

      const handleEnd = () => {
        target.removeEventListener('pointermove', handleMove)
        target.removeEventListener('pointerup', handleEnd)
        target.removeEventListener('pointercancel', handleEnd)
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
        setResizing(false)
        void saveCardSize()
      }

      target.addEventListener('pointermove', handleMove)
      target.addEventListener('pointerup', handleEnd)
      target.addEventListener('pointercancel', handleEnd)
    }

  // 选中或拖动中完全可见，未选中时仅在悬停整张卡片时浅显显示
  const handleVisible = resizing || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'

  // 卡片外发光完全由主题令牌派生：选中为强调色描边+光晕，流式为 20% 强调色描边
  const boxShadow = isError
    ? '0 2px 12px color-mix(in srgb, var(--bg-canvas) 80%, transparent)'
    : isSelected
      ? '0 0 0 1px var(--accent), 0 0 24px var(--accent-dim)'
      : isStreaming
        ? '0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 2px 12px color-mix(in srgb, var(--bg-canvas) 80%, transparent)'
        : '0 2px 10px color-mix(in srgb, var(--bg-canvas) 75%, transparent)'

  return (
    <div
      className={[
        'group card-drag-handle relative flex flex-col rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-150 ease-out',
        node.pinned ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        isError ? 'border-danger' : isSelected ? 'border-accent' : 'border-subtle',
      ].join(' ')}
      style={{ width: cardSize.width, height: cardSize.height, boxShadow }}
    >
      {/* 修改时间放在卡片外部右下角：绝对定位不撑开节点尺寸，也不拦截画布操作 */}
      {modifiedTime && (
        <span className="pointer-events-none absolute top-full right-0 mt-1 select-none text-[11px] text-muted/80">
          {modifiedTime}
        </span>
      )}

      {/* 透明连线锚点：左/右用于主链与母线，上/下用于直接分支；关闭连接能力避免遮挡点击与缩放 */}
      <Handle id="target-left" type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="target-top" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="source-right" type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="source-top" type="source" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />

      <div className="card-drag-handle flex shrink-0 items-start gap-2">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => commitTitle()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitle()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditingTitle(false)
              }
            }}
            className="nodrag nopan selectable-text min-w-0 flex-1 rounded-md border border-subtle bg-elevated px-1.5 py-0.5 font-semibold leading-snug text-accent outline-none transition-colors duration-150 focus:border-accent"
            style={{ fontSize: 'calc(var(--card-font-size) + 1px)' }}
          />
        ) : (
          <h3
            onPointerUp={handleTitlePointerUp}
            className="nodrag selectable-text min-w-0 flex-1 break-words font-semibold leading-snug text-accent"
            style={{ fontSize: 'calc(var(--card-font-size) + 1px)' }}
          >
            {node.question || <span className="text-muted">请输入你的元问题</span>}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton title="复制问题和回答" onClick={() => void handleCopy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
          <IconButton
            title="重新生成回答"
            disabled={isStreaming || isInput}
            onClick={() => void regenerate(node.id)}
          >
            <RefreshCw size={14} />
          </IconButton>
          {!isRoot && (
            <IconButton
              title="删除卡片及分支"
              danger
              disabled={isStreaming}
              onClick={() => void removeNode(node.id)}
            >
              <Trash2 size={14} />
            </IconButton>
          )}
          {/* 固定按钮放在最右侧：固定后卡片不可直接拖动，元卡片默认固定 */}
          <IconButton
            title={node.pinned ? '取消固定' : '固定卡片'}
            active={node.pinned}
            onClick={() => void togglePin(node.id)}
          >
            <Pin size={14} />
          </IconButton>
        </div>
      </div>

      {node.reasoning && (
        <div className="mt-3 shrink-0 rounded-lg bg-elevated px-3 py-2">
          <button
            type="button"
            onClick={() => setReasoningOpen((open) => !open)}
            className="nodrag flex w-full items-center gap-1 text-left text-[13px] text-muted transition-colors duration-150 hover:text-body"
          >
            {reasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{isStreaming ? '思考中…' : '思考过程'}</span>
          </button>
          {reasoningOpen && (
            <div className="nodrag nowheel selectable-text mt-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap pr-1 text-[13px] leading-[1.6] text-muted">
              {node.reasoning}
            </div>
          )}
        </div>
      )}

      {isInput ? (
        <div className="nodrag mt-3 flex min-h-0 flex-1 flex-col">
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder="输入你的元问题，Enter 提交，Shift+Enter 换行"
            className="selectable-text min-h-0 w-full flex-1 resize-none rounded-lg border border-subtle bg-elevated p-2 leading-[1.65] text-body outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent"
            style={{ fontSize: 'var(--card-font-size)' }}
          />
          <div className="mt-2 flex shrink-0 justify-end">
            <button
              type="button"
              disabled={submitting || !draft.trim()}
              onClick={() => void handleSubmit()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              发送
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 正文占据剩余高度，内容超出后内部滚动，绝不撑开卡片；
              容器留白可拖动卡片，正文本身标了 nodrag 以支持选字 */}
          <div className="nowheel mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {node.answer ? (
              <div className={MARKDOWN_CLASS} style={{ fontSize: 'var(--card-font-size)' }}>
                <Markdown remarkPlugins={[remarkGfm]}>{node.answer}</Markdown>
              </div>
            ) : (
              !isStreaming && <p className="text-[13px] text-muted">暂无回答</p>
            )}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle" />
            )}
          </div>

          {isError && (
            <div className="mt-3 flex shrink-0 items-start justify-between gap-3 rounded-lg border border-danger px-3 py-2">
              <p className="min-w-0 break-words text-[13px] leading-[1.6] text-danger">
                {node.error || '回答失败，请稍后重试'}
              </p>
              <button
                type="button"
                onClick={() => void regenerate(node.id)}
                className="nodrag flex shrink-0 items-center gap-1 rounded-lg border border-subtle px-2 py-1 text-[13px] text-body transition-colors duration-150 hover:border-strong"
              >
                <RefreshCw size={13} />
                重试
              </button>
            </div>
          )}

          {node.status === 'done' && (
            <div className="mt-2 flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void regenerateSuggestions(node.id)}
                className="nodrag flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
              >
                <RefreshCw size={12} />
                换一个方向
              </button>
              <button
                type="button"
                title="新增分支"
                aria-label="新增分支"
                onClick={() => addBranchInput(node.id)}
                className="nodrag flex items-center rounded-md px-1 py-0.5 text-muted transition-colors duration-150 hover:text-ink"
              >
                <GitBranch size={12} />
              </button>
            </div>
          )}
        </>
      )}

      {/* 四边与四角缩放命中区：仅选中或悬停时可见；根卡片同样可缩放 */}
      {EDGE_ZONES.map((zone) => (
        <div
          key={zone.edge}
          role="separator"
          aria-label="拖动调整卡片尺寸"
          onPointerDown={startResize(zone.edge)}
          // 阻止 click 冒泡，避免拖动/点击手柄改变节点选中态
          onClick={(event) => event.stopPropagation()}
          className={[
            'nodrag nopan absolute',
            zone.position,
            zone.cursor,
            'bg-accent-dim transition-opacity duration-150',
            handleVisible,
          ].join(' ')}
        />
      ))}
      {CORNER_ZONES.map((zone) => (
        <div
          key={zone.edge}
          role="separator"
          aria-label="拖动调整卡片尺寸"
          onPointerDown={startResize(zone.edge)}
          onClick={(event) => event.stopPropagation()}
          className={[
            'nodrag nopan absolute h-3 w-3',
            zone.position,
            zone.cursor,
            'rounded-sm bg-accent-dim transition-opacity duration-150',
            handleVisible,
          ].join(' ')}
        />
      ))}
    </div>
  )
}

export const CardNode = memo(CardNodeInner)
