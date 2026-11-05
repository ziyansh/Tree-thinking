import { memo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranch,
  Paperclip,
  Pin,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { CardNodeData, CardFlowNode } from '../store/graphStore'
import { formatModifiedTime } from '../lib/time'
import { useEscapeHandler } from '../lib/escapeStack'
import { useSpacePressed } from '../lib/spaceKey'
import { AttachmentBar } from './AttachmentBar'
import { AttachmentChips, useAttachmentUploads, useFileDropZone } from './AttachmentComposer'
import { WebSearchToggle } from './WebSearchToggle'

/** Markdown 正文样式：颜色只取自主题令牌，避免卡片被长回答撑高 */
const MARKDOWN_CLASS = [
  // 文字容器按内容收缩，只有文字本身优先选中；周围留白仍可拖动卡片
  'nodrag selectable-text inline-block max-w-full align-top text-left text-body leading-[1.65] break-words',
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
  // 参考资料抽屉高度比例与设置更新入口
  const sourcesPanelRatio = useGraphStore((state) => state.preferences.sourcesPanelRatio)
  const updatePreferences = useGraphStore((state) => state.updatePreferences)
  // 标题双击编辑使用设置里的双击间隔与漂移距离
  const doubleClickMs = useGraphStore((state) => state.preferences.doubleClickMs)
  const dragDriftDistance = useGraphStore((state) => state.preferences.dragDriftDistance)
  // 滚轮逻辑：悬停卡片时滚动内容或缩放画布；按住空格时始终让滚轮缩放画布
  const wheelMode = useGraphStore((state) => state.preferences.wheelMode)
  const spacePressed = useSpacePressed()
  const wheelScrollClass = wheelMode === 'scroll-card' && !spacePressed ? 'nowheel' : ''
  const modifiedTime = formatModifiedTime(node.updatedAt, timeFormat)

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  /** 抽屉拖拽中的高度比例预览，松手后清空并持久化 */
  const [sourcesPanelPreviewRatio, setSourcesPanelPreviewRatio] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 上一次点击标题的时间，用于手动判定双击 */
  const lastTitleClickRef = useRef(0)
  /** 标题上按下时的坐标，用于排除拖动/选字造成的误双击 */
  const titlePointerRef = useRef<{ x: number; y: number } | null>(null)
  /** 元问题卡片输入区的待提交附件 */
  const attachments = useAttachmentUploads()
  const dropZone = useFileDropZone((files) => void attachments.addFiles(files))
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** 正文容器：抽屉高度不能超过它的实际高度 */
  const sourcesContainerRef = useRef<HTMLDivElement | null>(null)

  // 抽屉展开时统一走 Escape 栈，多浮层叠加时总是先关闭最后打开的那个
  useEscapeHandler(sourcesOpen, () => setSourcesOpen(false))

  /** 抽屉高度：拖拽预览优先，其次取设置中的比例 */
  const sourcesPanelHeight = Math.round(
    cardSize.height * (sourcesPanelPreviewRatio ?? sourcesPanelRatio),
  )

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
      const targetId = await startQuestion(
        node.id,
        text,
        attachments.items.map((item) => item.id),
      )
      if (targetId) {
        setDraft('')
        attachments.clear()
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

  /** 按设置的双击间隔手动识别标题双击；拖动时不算点击 */
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
      // 每次拖动只压一次快照，撤销可整体恢复卡片尺寸
      useGraphStore.getState().pushUndo('调整卡片大小')
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
        void saveCardSize()
      }

      target.addEventListener('pointermove', handleMove)
      target.addEventListener('pointerup', handleEnd)
      target.addEventListener('pointercancel', handleEnd)
    }

  /**
   * 参考资料抽屉拖拽条：向上拖增大、向下拖减小，
   * 范围限定在卡片高度的 15%–70%，且不超过正文容器高度；松手后持久化比例
   */
  const startSourcesDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // 阻止触发卡片拖动与选中
    event.preventDefault()
    event.stopPropagation()

    const target = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = Math.round(cardSize.height * sourcesPanelRatio)
    const containerHeight = sourcesContainerRef.current?.clientHeight ?? cardSize.height
    let latestHeight = startHeight

    const clampHeight = (height: number) =>
      Math.max(
        cardSize.height * 0.15,
        Math.min(cardSize.height * 0.7, Math.min(containerHeight, height)),
      )

    target.setPointerCapture(pointerId)

    const handleMove = (moveEvent: PointerEvent) => {
      latestHeight = Math.round(clampHeight(startHeight + (startY - moveEvent.clientY)))
      setSourcesPanelPreviewRatio(latestHeight / cardSize.height)
    }

    const handleEnd = () => {
      target.removeEventListener('pointermove', handleMove)
      target.removeEventListener('pointerup', handleEnd)
      target.removeEventListener('pointercancel', handleEnd)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      setSourcesPanelPreviewRatio(null)
      // 折算成比例写入设置，失败时 store 回滚，这里只告警
      void updatePreferences({ sourcesPanelRatio: latestHeight / cardSize.height }).catch((err) =>
        console.warn('保存参考资料抽屉高度失败', err),
      )
    }

    target.addEventListener('pointermove', handleMove)
    target.addEventListener('pointerup', handleEnd)
    target.addEventListener('pointercancel', handleEnd)
  }

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
        isError
          ? 'border-danger'
          : isSelected
            ? 'border-accent'
            : 'border-subtle hover:border-accent',
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

      {/* 附件条固定在标题行之前 */}
      <AttachmentBar node={node} />

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
            style={{ fontSize: 'calc(var(--card-font-size) + 2px)' }}
          />
        ) : (
          <h3
            onPointerDown={handleTitlePointerDown}
            onPointerUp={handleTitlePointerUp}
            className="min-w-0 flex-1 cursor-grab break-words font-semibold leading-snug text-accent active:cursor-grabbing"
            style={{ fontSize: 'calc(var(--card-font-size) + 2px)' }}
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
            <div className={`nodrag ${wheelScrollClass} selectable-text mt-2 inline-block max-h-[200px] max-w-full overflow-y-auto whitespace-pre-wrap pr-1 text-[13px] leading-[1.6] text-muted`}>
              {node.reasoning}
            </div>
          )}
        </div>
      )}

      {isInput ? (
        <div
          onDragOver={dropZone.onDragOver}
          onDragLeave={dropZone.onDragLeave}
          onDrop={dropZone.onDrop}
          className={[
            'nodrag mt-3 flex min-h-0 flex-1 flex-col rounded-lg border p-1 transition-colors duration-150',
            dropZone.dragOver ? 'border-accent bg-accent-dim' : 'border-transparent',
          ].join(' ')}
        >
          {attachments.items.length > 0 && (
            <div className="mb-1">
              <AttachmentChips items={attachments.items} onRemove={attachments.remove} />
            </div>
          )}
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
          <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="添加附件"
                aria-label="添加附件"
                onClick={() => fileInputRef.current?.click()}
                className="nodrag flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
              >
                <Paperclip size={14} />
              </button>
              {attachments.uploading && <span className="text-[11px] text-muted">上传中…</span>}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="nodrag hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void attachments.addFiles(files)
                }}
              />
              <WebSearchToggle />
            </div>
            <button
              type="button"
              disabled={submitting || attachments.uploading || !draft.trim()}
              onClick={() => void handleSubmit()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              发送
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 正文容器同时承载参考资料抽屉：抽屉绝对定位在底部，不撑开卡片也不覆盖操作行 */}
          <div ref={sourcesContainerRef} className="relative mt-3 min-h-0 flex-1">
            {/* 正文占据剩余高度，内容超出后内部滚动，绝不撑开卡片；
                容器留白可拖动卡片，正文本身标了 nodrag 以支持选字 */}
            <div className={`${wheelScrollClass} h-full overflow-y-auto pr-1`}>
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

            {sourcesOpen && node.sources.length > 0 && (
              <div
                className={`nodrag ${spacePressed ? '' : 'nowheel'} absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-lg`}
                style={{
                  height: sourcesPanelHeight,
                  maxHeight: '100%',
                  background: 'color-mix(in srgb, var(--bg-panel) 82%, transparent)',
                  backdropFilter: 'blur(10px)',
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {/* 拖拽条：上下拖动调整抽屉高度 */}
                <div
                  onPointerDown={startSourcesDrag}
                  className="flex h-3 shrink-0 cursor-ns-resize items-center justify-center"
                >
                  <span className="h-1 w-10 rounded-full bg-strong" />
                </div>
                <p className="shrink-0 px-3 pb-1 text-[11px] text-muted">
                  参考资料 · {node.sources.length} 篇
                </p>
                <div className={`${spacePressed ? '' : 'nowheel'} min-h-0 flex-1 overflow-y-auto px-3 pb-3`}>
                  {node.sources.map((source, index) => (
                    <a
                      key={`${source.url}-${index}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-2 block break-all text-[12px] leading-[1.5] text-accent hover:underline last:mb-0"
                    >
                      {source.url}
                    </a>
                  ))}
                </div>
              </div>
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
            <div
              className={[
                'mt-2 flex shrink-0 items-center gap-2',
                node.sources.length > 0 ? 'justify-between' : 'justify-end',
              ].join(' ')}
            >
              {node.sources.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSourcesOpen((open) => !open)}
                  className="nodrag flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
                >
                  参考 {node.sources.length} 篇资料
                  <ChevronRight size={12} className={sourcesOpen ? 'rotate-90' : ''} />
                </button>
              )}
              <div className="flex items-center gap-2">
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
                  title="新建分支"
                  aria-label="新建分支"
                  onClick={() => addBranchInput(node.id)}
                  className="nodrag flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
                >
                  <GitBranch size={12} />
                  新建分支
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 四边与四角缩放命中区：仅提供光标与命中，不绘制高亮；根卡片同样可缩放 */}
      {EDGE_ZONES.map((zone) => (
        <div
          key={zone.edge}
          role="separator"
          aria-label="拖动调整卡片尺寸"
          onPointerDown={startResize(zone.edge)}
          // 阻止 click 冒泡，避免拖动/点击手柄改变节点选中态
          onClick={(event) => event.stopPropagation()}
          className={['nodrag nopan absolute', zone.position, zone.cursor].join(' ')}
        />
      ))}
      {CORNER_ZONES.map((zone) => (
        <div
          key={zone.edge}
          role="separator"
          aria-label="拖动调整卡片尺寸"
          onPointerDown={startResize(zone.edge)}
          onClick={(event) => event.stopPropagation()}
          className={['nodrag nopan absolute h-3 w-3', zone.position, zone.cursor].join(' ')}
        />
      ))}
    </div>
  )
}

export const CardNode = memo(CardNodeInner)
