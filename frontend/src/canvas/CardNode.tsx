import { memo, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  Check,
  ChevronRight,
  Copy,
  GitBranch,
  MessageSquareText,
  Paperclip,
  Pin,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { CardNodeData, CardFlowNode } from '../store/graphStore'
import { formatModifiedTime } from '../lib/time'
import { useEscapeHandler } from '../lib/escapeStack'
import { useSpacePressed } from '../lib/spaceKey'
import { bumpUiLayer } from '../lib/uiLayers'
import { AttachmentBar } from './AttachmentBar'
import { AttachmentChips, ArkCapabilityWarning, PdfPageWarning, useAttachmentUploads, usePasteAttachments, useFileDropZone } from './AttachmentComposer'
import { WebSearchToggle } from './WebSearchToggle'
import { ThinkingToggle } from './ThinkingToggle'
import { PromptDrawer } from './PromptDrawer'
import { UrlChips } from './UrlChips'
import { removeUrl } from '../lib/urlChips'
import {
  ANSWER_LINK_DOT,
  startNoteLinkDrag,
  useNoteLinkDragSignal,
} from './noteLink'

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
  '[&_a:not(.citation-badge)]:text-accent [&_a:not(.citation-badge)]:underline [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-subtle [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-3 [&_hr]:border-subtle',
].join(' ')

/**
 * 把模型输出整理成 Markdown：
 * 1. `\(...\)` 与 `\[...\]` 统一成 `$...$` / `$$...$$`（模型常混用两种写法）；
 * 2. 把有效的 `[n]` 转成指向来源序号的链接。
 * 代码块、行内代码与公式内部不做引用替换，避免把数组下标或公式内容误转。
 */
function prepareMarkdown(answer: string, sourceCount: number): string {
  // 代码与公式片段放在捕获组里，split 后位于奇数下标
  const parts = answer.split(
    /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$)/g,
  )

  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        // 公式：统一成 remark-math 的定界符，$$ 单独成行才会渲染为块级公式
        if (part.startsWith('$$') && part.endsWith('$$')) {
          return `\n$$\n${part.slice(2, -2).trim()}\n$$\n`
        }
        if (part.startsWith('\\(') && part.endsWith('\\)')) {
          return `$${part.slice(2, -2)}$`
        }
        if (part.startsWith('\\[') && part.endsWith('\\]')) {
          return `\n$$\n${part.slice(2, -2).trim()}\n$$\n`
        }
        return part
      }

      if (sourceCount <= 0) return part
      return part.replace(/(?:\[|【)\s*(\d{1,2})\s*(?:\]|】)/g, (match, raw: string) => {
        const sourceIndex = Number(raw)
        if (sourceIndex < 1 || sourceIndex > sourceCount) return match
        return `[${sourceIndex}](#source-${sourceIndex})`
      })
    })
    .join('')
}

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

function CardNodeInner({ data, dragging }: NodeProps<CardFlowNode>) {
  const { node }: CardNodeData = data
  const regenerate = useGraphStore((state) => state.regenerate)
  const removeNode = useGraphStore((state) => state.deleteNode)
  const removeDescendants = useGraphStore((state) => state.removeDescendants)
  const stopGeneration = useGraphStore((state) => state.stopGeneration)
  const continueGeneration = useGraphStore((state) => state.continueGeneration)
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
  // 火山方舟能力提示：当前模型与账号可见模型列表
  const arkModel = useGraphStore((state) => state.arkModel)
  const arkModels = useGraphStore((state) => state.arkModels)
  const spacePressed = useSpacePressed()
  const wheelScrollClass = wheelMode === 'scroll-card' && !spacePressed ? 'nowheel' : ''
  // 连线拖拽状态：从笔记端出发时回答端连接点可连接
  const linkDrag = useNoteLinkDragSignal()
  const linkConnectable = linkDrag.active && linkDrag.sourceKind === 'note'
  const linkSnapped = linkConnectable && linkDrag.snappedNodeId === node.id
  // 起点连接点：拖拽期间保持实心强调色，明确连线从哪里出发
  const linkSource = linkDrag.active && linkDrag.sourceNodeId === node.id
  // 回答正文是主要阅读区：始终保留原生滚动（按住空格时仍交给画布缩放）
  const answerScrollClass = spacePressed ? '' : 'nowheel'
  const modifiedTime = formatModifiedTime(node.updatedAt, timeFormat)
  /** 新建 1.2 秒内的卡片播放一次入场动画；旧卡片与项目载入不播 */
  const createdAtMs = node.createdAt ? Date.parse(node.createdAt) : Number.NaN
  const entering = !dragging && Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 1200

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  /** 抽屉拖拽中的高度比例预览，松手后清空并持久化 */
  const [sourcesPanelPreviewRatio, setSourcesPanelPreviewRatio] = useState<number | null>(null)
  /** 拖拽抽屉时禁用高度过渡，保证跟手 */
  const [sourcesDragging, setSourcesDragging] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 顶部提问抽屉：只读展示原始提问，双击进入编辑并重新提交 */
  const [promptOpen, setPromptOpen] = useState(false)
  /** 打开抽屉时是否直接进入编辑态（「重新提问」按钮） */
  const [promptEditing, setPromptEditing] = useState(false)

  /** 关闭抽屉并复位编辑态，下次打开回到只读 */
  const closePrompt = () => {
    setPromptOpen(false)
    setPromptEditing(false)
  }
  /** 上一次点击标题的时间，用于手动判定双击 */
  const lastTitleClickRef = useRef(0)
  /** 标题上按下时的坐标，用于排除拖动/选字造成的误双击 */
  const titlePointerRef = useRef<{ x: number; y: number } | null>(null)
  /** 元问题卡片输入区的待提交附件 */
  const attachments = useAttachmentUploads()
  const pasteAttachments = usePasteAttachments(attachments)
  const dropZone = useFileDropZone((files) => void attachments.addFiles(files))
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** 正文容器：抽屉高度不能超过它的实际高度 */
  const sourcesContainerRef = useRef<HTMLDivElement | null>(null)

  // 抽屉展开时统一走 Escape 栈，多浮层叠加时总是先关闭最后打开的那个
  useEscapeHandler(sourcesOpen, () => setSourcesOpen(false))
  useEscapeHandler(promptOpen, closePrompt)

  /** 抽屉高度：拖拽预览优先，其次取设置中的比例 */
  const sourcesPanelHeight = Math.round(
    cardSize.height * (sourcesPanelPreviewRatio ?? sourcesPanelRatio),
  )

  const isStreaming = node.status === 'streaming'
  const isError = node.status === 'error'
  const isInput = node.status === 'input'
  // 暂停态：有输出时停止生成，正文与思考区域模糊并显示继续/重输入口
  const isPaused = node.status === 'paused'
  // 元问题卡片固定尺寸，不提供缩放手柄；笔记节点也有 parentId=null，不能当作元卡片
  const isRoot = node.parentId === null && node.nodeType === 'chat'

  const handleCopy = async () => {
    // 复制「用户原始提问 + 模型回答」，标题改名不影响复制内容
    const text = [node.prompt || node.question, node.answer].filter(Boolean).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败，不打断阅读
    }
  }

  /** 重新生成：已有后续卡片时确认后先删除，再重新请求回答（整步可撤销） */
  const handleRegenerate = async () => {
    const state = useGraphStore.getState()
    const hasChildren = state.nodes.some((item) => item.data.node.parentId === node.id)
    if (hasChildren) {
      if (!window.confirm('重新生成将会丢失后续卡片内容，请问是否继续？')) return
      try {
        await removeDescendants(node.id)
      } catch {
        return
      }
    }
    await regenerate(node.id)
  }

  // 元问题卡片停止生成后会回到输入态，用之前的提问预填输入框
  useEffect(() => {
    if (!isInput) return
    setDraft((previous) => previous || node.prompt || '')
  }, [isInput, node.prompt])

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
    setSourcesDragging(true)
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
      setSourcesDragging(false)
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
      : dragging
        ? '0 12px 28px rgba(0, 0, 0, 0.28)'
        : isStreaming
          ? '0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 2px 12px color-mix(in srgb, var(--bg-canvas) 80%, transparent)'
          : '0 2px 10px color-mix(in srgb, var(--bg-canvas) 75%, transparent)'

  return (
    <div
      className={[
        // 拖动性能优先：只过渡边框与阴影，不对卡片做 scale / translate（大卡片易掉帧）
        'group card-drag-handle relative flex flex-col rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-150 ease-out',
        // 新建卡片播放一次入场动画
        entering ? 'card-enter' : '',
        node.pinned ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        isError
          ? 'border-danger'
          : isSelected
            ? 'border-accent'
            : 'border-subtle hover:border-accent',
      ].join(' ')}
      style={{
        width: cardSize.width,
        height: cardSize.height,
        boxShadow,
        // 拖动中关闭阴影过渡，避免每帧重绘大面积阴影
        transition: dragging ? 'none' : undefined,
      }}
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

      {/* 笔记连接点：与底部工具栏「重新提问 / 新建分支」同一行，靠近右边框 */}
      <Handle
        id="note-link-out"
        type="source"
        position={Position.Right}
        isConnectable={false}
        title="拖动连接到笔记"
        aria-label="拖动连接到笔记"
        onPointerDown={(event) => startNoteLinkDrag(event, node.id, 'answer')}
        onClick={(event) => event.stopPropagation()}
        className={[
          'note-link-handle nodrag nopan',
          linkSource ? 'is-source' : '',
          linkConnectable ? 'is-connectable' : '',
          linkSnapped ? 'is-snapped' : '',
        ].join(' ')}
        style={{
          right: ANSWER_LINK_DOT.right,
          bottom: ANSWER_LINK_DOT.bottom,
          top: 'auto',
          left: 'auto',
          transform: 'none',
        }}
      />

      {/* 提问抽屉：浮在卡片上方，展示并可重新提交用户原始提问 */}
      {promptOpen && (
        <PromptDrawer node={node} initialEditing={promptEditing} onClose={closePrompt} />
      )}

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
            className="line-clamp-2 min-w-0 flex-1 cursor-grab break-words font-semibold leading-snug text-accent active:cursor-grabbing"
            style={{ fontSize: 'calc(var(--card-font-size) + 2px)' }}
          >
            {node.question || <span className="text-muted">请输入你的元问题</span>}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            title="查看我的提问"
            onClick={() => {
              if (promptOpen) {
                closePrompt()
                return
              }
              setPromptEditing(false)
              setPromptOpen(true)
              // 抽屉随卡片整体抬升，避免被其它卡片遮挡
              bumpUiLayer(node.id)
            }}
            active={promptOpen}
          >
            <MessageSquareText size={14} />
          </IconButton>
          <IconButton title="复制问题和回答" onClick={() => void handleCopy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
          <IconButton
            title="重新生成回答"
            disabled={isStreaming || isInput}
            onClick={() => void handleRegenerate()}
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

      {/* 正文与思考区域包一层：暂停时整体模糊，并叠加毛玻璃遮罩 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className={['flex min-h-0 flex-1 flex-col', isPaused ? 'blur-[2px]' : ''].join(' ')}>
      {node.reasoning && (
        <div className="mt-3 shrink-0 rounded-lg bg-elevated px-3 py-2">
          <button
            type="button"
            onClick={() => setReasoningOpen((open) => !open)}
            className="nodrag flex w-full items-center gap-1 text-left text-[13px] text-muted transition-colors duration-150 hover:text-body"
          >
            <ChevronRight
              size={14}
              className={`transition-transform duration-200 ease-out ${reasoningOpen ? 'rotate-90' : ''}`}
            />
            <span>{isStreaming ? '思考中…' : '思考过程'}</span>
          </button>
          {/* 展开/收起用 0fr ↔ 1fr 过渡，任意时刻可再次点击打断 */}
          <div
            className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
              reasoningOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="min-h-0">
              <div className={`nodrag ${wheelScrollClass} selectable-text mt-2 inline-block max-h-[200px] max-w-full overflow-y-auto whitespace-pre-wrap pr-1 text-[13px] leading-[1.6] text-muted`}>
                {node.reasoning}
              </div>
            </div>
          </div>
        </div>
      )}

      {isInput ? (
        <div
          onDragOver={dropZone.onDragOver}
          onDragLeave={dropZone.onDragLeave}
          onDrop={dropZone.onDrop}
          className={[
            'glass-surface nodrag mt-3 flex min-h-0 flex-1 flex-col rounded-lg border p-1 transition-colors duration-150',
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
            onPaste={pasteAttachments}
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
          <UrlChips text={draft} onRemove={(url) => setDraft(removeUrl(draft, url))} />
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
              <ThinkingToggle />
              <PdfPageWarning items={attachments.items} />
              <ArkCapabilityWarning
                items={attachments.items}
                model={arkModel}
                models={arkModels}
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
            <div className={`${answerScrollClass} h-full min-h-0 overflow-y-auto pr-1 [scrollbar-gutter:stable]`}>
              {node.answer ? (
                <div className={MARKDOWN_CLASS} style={{ fontSize: 'var(--card-font-size)' }}>
                  <Markdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      // 引用角标：把 #source-n 渲染成可点击的小徽标
                      a: ({ href, children }) => {
                        const prefix = '#source-'
                        if (href?.startsWith(prefix)) {
                          const index = Number(href.slice(prefix.length))
                          const source = node.sources[index - 1]
                          if (source) {
                            return (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                title={source.title || source.url}
                                className="citation-badge"
                              >
                                {index}
                              </a>
                            )
                          }
                        }
                        return <a href={href}>{children}</a>
                      },
                    }}
                  >
                    {prepareMarkdown(node.answer, node.sources.length)}
                  </Markdown>
                </div>
              ) : (
                !isStreaming && <p className="text-[13px] text-muted">暂无回答</p>
              )}
              {isStreaming && (
                <span className="ml-0.5 streaming-caret inline-block h-4 w-[2px] bg-accent align-middle" />
              )}
            </div>

            {sourcesOpen && node.sources.length > 0 && (
              <div
                className={[
                  `nodrag ${spacePressed ? '' : 'nowheel'} drawer-in absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-lg`,
                  // 参考资料抽屉使用更通透的一档毛玻璃；拖拽或空格平移时关闭毛玻璃，避免逐帧重算背景模糊
                  sourcesDragging || spacePressed ? 'bg-panel' : 'glass-surface-airy',
                ].join(' ')}
                style={{
                  height: sourcesPanelHeight,
                  maxHeight: '100%',
                  // 拖拽时跟手，非拖拽时高度变化（打开/设置调整）用 220ms 过渡
                  transition: sourcesDragging ? 'none' : 'height 220ms var(--motion-ease-out)',
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
                  {node.sources.map((source, index) => {
                    // 优先展示网页标题，缺失时回落到站点名或链接
                    const title = source.title.trim() || source.siteName || source.url
                    return (
                      <a
                        key={`${source.url}-${index}`}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        title={source.url}
                        className="mb-2 flex items-start gap-2 text-[12px] leading-[1.5] last:mb-0"
                      >
                        <span className="w-4 shrink-0 text-right tabular-nums text-muted">
                          {index + 1}.
                        </span>
                        <span className="min-w-0 break-words text-accent hover:underline">
                          {title}
                        </span>
                      </a>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {isError && (
            <div className="error-in mt-3 flex shrink-0 items-start justify-between gap-3 rounded-lg border border-danger px-3 py-2">
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

          {node.status === 'streaming' && (
            // 右侧留出 10px：与完成态一致，避免「停止生成」贴住笔记连接点
            <div className="mt-2 flex shrink-0 items-center justify-end pr-2.5">
              <button
                type="button"
                onClick={() => void stopGeneration(node.id)}
                className="nodrag flex items-center gap-1 rounded-md border border-subtle px-2 py-0.5 text-[12px] text-danger transition-colors duration-150 hover:border-danger hover:bg-ghost-border"
              >
                <Square size={10} fill="currentColor" />
                停止生成
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
                  <ChevronRight
                    size={12}
                    // 收起时指向右，展开时指向上
                    className={`transition-transform duration-200 ease-out ${sourcesOpen ? '-rotate-90' : ''}`}
                  />
                </button>
              )}
              {/* 右侧留出 10px：让连接点周围保持清晰的可点击空间 */}
              <div className="flex items-center gap-2 pr-2.5">
                <button
                  type="button"
                  onClick={() => {
                    if (promptOpen && promptEditing) {
                      closePrompt()
                      return
                    }
                    // 直接打开抽屉并进入编辑态，由抽屉自动聚焦输入框
                    setPromptEditing(true)
                    setPromptOpen(true)
                    bumpUiLayer(node.id)
                  }}
                  className="nodrag flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
                >
                  <MessageSquareText size={12} />
                  重新提问
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
        </div>

        {/* 暂停态遮罩：正文与思考区域已模糊，中央提供继续生成 / 重新输入 */}
        {isPaused && (
          <div className="pause-in nodrag absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border border-subtle bg-panel/55 backdrop-blur-sm">
            <span className="text-[12px] text-muted">生成已暂停</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={node.webToolUsed}
                title={
                  node.webToolUsed ? '智能搜索产生的回答不支持续写，请重新输入问题' : undefined
                }
                onClick={() => void continueGeneration(node.id)}
                className={[
                  'flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-canvas transition-opacity duration-150',
                  node.webToolUsed ? 'cursor-not-allowed opacity-40' : 'hover:opacity-90',
                ].join(' ')}
              >
                <Play size={12} />
                继续生成
              </button>
              <button
                type="button"
                onClick={() => {
                  // 复用提问抽屉并直接进入编辑态，由抽屉自动聚焦输入框
                  setPromptEditing(true)
                  setPromptOpen(true)
                  bumpUiLayer(node.id)
                }}
                className="flex items-center gap-1 rounded-lg border border-subtle px-3 py-1.5 text-[12px] text-body transition-colors duration-150 hover:border-strong hover:text-ink"
              >
                <MessageSquareText size={12} />
                重新输入
              </button>
            </div>
          </div>
        )}
      </div>

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
