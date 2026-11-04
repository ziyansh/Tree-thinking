import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { LayoutGrid, Maximize, Minus, Plus, Send } from 'lucide-react'
import { CardNode } from './CardNode'
import { NoteNode } from './NoteNode'
import { BranchInputNode } from './BranchInputNode'
import { GhostInputNode } from './GhostInputNode'
import { GhostNode } from './GhostNode'
import { buildBranchInputNodes, buildGhostNodes } from './ghosts'
import { computeAutoLayout } from './layout'
import { BusEdge, DirectEdge, MainEdge } from './edges'
import type { Rect } from './edges'
import { NOTE_DEFAULT_HEIGHT, NOTE_DEFAULT_WIDTH, useGraphStore } from '../store/graphStore'
import type { GraphFlowNode } from '../store/graphStore'
import { DOT_COLORS, resolveTheme } from '../lib/theme'

const nodeTypes = {
  card: CardNode,
  note: NoteNode,
  ghost: GhostNode,
  'ghost-input': GhostInputNode,
  'branch-input': BranchInputNode,
}

/** 自定义边：主链 / 直接分支 / 共用母线 */
const edgeTypes = {
  main: MainEdge,
  direct: DirectEdge,
  bus: BusEdge,
}

/** ghost 卡片尺寸，与 GhostNode / GhostInputNode 的 280×44 保持一致 */
const GHOST_SIZE = { width: 280, height: 44 }
/** 共用母线距父卡片右边的距离 */
const BUS_GUTTER_GAP = 160

/** 画布点阵颜色：按解析后的主题取值，跟随系统时监听系统深浅色切换 */
function useDotColor(): string {
  const themeMode = useGraphStore((state) => state.preferences.themeMode)
  const [theme, setTheme] = useState(() => resolveTheme(themeMode))

  useEffect(() => {
    setTheme(resolveTheme(themeMode))
    if (themeMode !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme(resolveTheme('system'))
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [themeMode])

  return DOT_COLORS[theme]
}

/** 空白画布上的指针状态：用于按漂移延迟/距离区分点击与拖动 */
interface PanePointerState {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  monitoring: boolean
  panning: boolean
  timer: number | null
}

/** 收集一组节点及其全部后代 id（去重），用于拖动时同步移动 */
function collectSubtreeIds(cards: GraphFlowNode[], rootIds: string[]): string[] {
  const ids = [...new Set(rootIds)]
  for (let index = 0; index < ids.length; index += 1) {
    const parentId = ids[index]
    for (const card of cards) {
      if (card.data.node.parentId === parentId && !ids.includes(card.id)) ids.push(card.id)
    }
  }
  return ids
}

/** Shift 吸附：网格步长与边缘对齐阈值 */
const SNAP_GRID = 20
const SNAP_THRESHOLD = 8

/** 卡片实际尺寸：笔记使用自身宽高，聊天卡片使用全局尺寸 */
function cardRectSize(
  card: GraphFlowNode,
  cardSize: { width: number; height: number },
): { width: number; height: number } {
  const node = card.data.node
  if (node.nodeType === 'note') {
    return {
      width: node.width ?? cardSize.width,
      height: node.height ?? cardSize.height,
    }
  }
  return cardSize
}

/** 在候选对齐线中找最近的偏移量；超过阈值的线忽略，无可用线时返回 0 */
function findSnapOffset(targets: number[], lines: number[]): number {
  let best: number | null = null
  for (const target of targets) {
    for (const line of lines) {
      const diff = line - target
      if (Math.abs(diff) > SNAP_THRESHOLD) continue
      if (best === null || Math.abs(diff) < Math.abs(best)) best = diff
    }
  }
  return best ?? 0
}

function ZoomPanel() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()

  return (
    <div className="mb-5 flex items-center gap-1 rounded-lg border border-subtle bg-panel p-1">
      <PanelButton title="缩小" onClick={() => void zoomOut({ duration: 150 })}>
        <Minus size={14} />
      </PanelButton>
      <span className="w-10 text-center text-[12px] tabular-nums text-muted">
        {Math.round(zoom * 100)}%
      </span>
      <PanelButton title="放大" onClick={() => void zoomIn({ duration: 150 })}>
        <Plus size={14} />
      </PanelButton>
      <span className="mx-0.5 h-5 w-px bg-subtle" />
      <PanelButton title="复位视图" onClick={() => void fitView({ padding: 0.25, maxZoom: 1, duration: 300 })}>
        <Maximize size={14} />
      </PanelButton>
    </div>
  )
}

function PanelButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
    >
      {children}
    </button>
  )
}

/** 底部居中的全局追问输入条：绑定选中卡片，未选中时退回根卡片 */
function AskBar() {
  const nodes = useGraphStore((state) => state.nodes)
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId)
  const isStreamingIds = useGraphStore((state) => state.isStreamingIds)
  const startQuestion = useGraphStore((state) => state.startQuestion)
  const runAnswer = useGraphStore((state) => state.runAnswer)

  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const root = nodes.find(
    (item) => item.data.node.parentId === null && item.data.node.nodeType === 'chat',
  )?.data.node
  const selected = nodes.find((item) => item.id === selectedNodeId)?.data.node
  // 笔记不参与问答：选中笔记时追问条退回根卡片，避免在笔记下生成聊天分支
  const target = selected?.nodeType === 'chat' ? selected : root
  const disabled = !target || submitting || isStreamingIds.length > 0

  const placeholder = !target
    ? '先创建一个画布'
    : target.question
      ? `继续追问：${target.question.slice(0, 12)}${target.question.length > 12 ? '…' : ''}`
      : '输入你的元问题…'

  const submit = async () => {
    const text = value.trim()
    if (!text || !target || disabled) return
    setSubmitting(true)
    try {
      const targetId = await startQuestion(target.id, text)
      if (targetId) {
        setValue('')
        await runAnswer(targetId)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="flex items-center gap-2 rounded-[22px] border border-subtle bg-panel px-3 py-1.5"
      style={{ width: 'min(680px, calc(100vw - 48px))' }}
    >
      <textarea
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={placeholder}
        className="h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-6 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed"
      />
      <button
        type="button"
        title="发送"
        aria-label="发送"
        disabled={disabled || !value.trim()}
        onClick={() => void submit()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send size={14} />
      </button>
    </div>
  )
}

function CanvasInner() {
  const nodes = useGraphStore((state) => state.nodes)
  const cardSize = useGraphStore((state) => state.cardSize)
  const preferences = useGraphStore((state) => state.preferences)
  const branchInputs = useGraphStore((state) => state.branchInputs)
  const currentProjectId = useGraphStore((state) => state.currentProjectId)
  const project = useGraphStore((state) =>
    state.projects.find((item) => item.id === state.currentProjectId) ?? null,
  )
  const setSelected = useGraphStore((state) => state.setSelected)
  const toggleSelected = useGraphStore((state) => state.toggleSelected)
  const clearSelection = useGraphStore((state) => state.clearSelection)
  const deleteSelected = useGraphStore((state) => state.deleteSelected)
  const selectedNodeIds = useGraphStore((state) => state.selectedNodeIds)
  const savePosition = useGraphStore((state) => state.savePosition)
  const createNoteAt = useGraphStore((state) => state.createNoteAt)
  const dotColor = useDotColor()

  const { fitView, setViewport, getViewport, screenToFlowPosition } = useReactFlow()
  const fittedProjectRef = useRef<string | null>(null)
  const viewportTimerRef = useRef<number | null>(null)
  /** 空格是否按下：决定左键能否拖动平移 */
  const [spacePressed, setSpacePressed] = useState(false)
  /** 是否正在自定义平移：用于切换抓取光标 */
  const [isPanning, setIsPanning] = useState(false)
  /** 空白处指针状态：按下坐标、延迟计时与是否已进入平移 */
  const pointerRef = useRef<PanePointerState | null>(null)
  /** 平移开始时的视口，位移按屏幕像素累加 */
  const panStartViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  /** 平移结束后抑制随后的空白点击，避免误清空选择 */
  const suppressPaneClickRef = useRef(false)
  /** 画布外层容器，平移时在此元素上捕获指针 */
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** 上一次空白点击的时间与位置：用于按设置的双击间隔手动判定 */
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(null)
  /** 拖拽开始时的移动集合基准坐标，键为节点 id */
  const dragOriginRef = useRef<{
    rootId: string
    positions: Map<string, { x: number; y: number }>
  } | null>(null)

  // 空格按住时左键可平移（[0,1] = 左键+中键）；平时只有中键平移，左键空白用于拖动/点击判定
  useEffect(() => {
    // 输入框聚焦时不拦截空格，避免影响文字输入
    const isEditing = () => {
      const element = document.activeElement as HTMLElement | null
      if (!element) return false
      return (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable
      )
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditing()) return
      // 阻止空格滚动页面
      event.preventDefault()
      setSpacePressed(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false)
    }
    // 窗口失焦时按键状态可能丢失，统一复位
    const handleBlur = () => setSpacePressed(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // 空白处拖动：按下后经过漂移延迟开始检测，位移超过漂移距离才进入平移
  const startPan = useCallback(
    (state: PanePointerState) => {
      if (state.panning) return
      try {
        containerRef.current?.setPointerCapture(state.pointerId)
      } catch {
        // 指针已在窗口外松开时无法捕获，放弃本次平移
        pointerRef.current = null
        return
      }
      state.panning = true
      // 平移开始后清空点击记录，避免与之前的一次点击误判为双击
      lastClickRef.current = null
      panStartViewportRef.current = getViewport()
      suppressPaneClickRef.current = true
      setIsPanning(true)
    },
    [getViewport],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      suppressPaneClickRef.current = false
      if (event.button !== 0 || spacePressed) return
      // 只在真正的画布空白处启动指针判定；点到卡片/输入框时清除未完成的双击记录
      if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) {
        lastClickRef.current = null
        return
      }

      const state: PanePointerState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        // 延迟为 0 时按下即开始检测
        monitoring: preferences.dragDriftDelayMs <= 0,
        panning: false,
        timer: null,
      }

      if (preferences.dragDriftDelayMs > 0) {
        state.timer = window.setTimeout(() => {
          if (pointerRef.current !== state) return
          state.monitoring = true
          const moved = Math.hypot(
            state.currentX - state.startX,
            state.currentY - state.startY,
          )
          if (moved > preferences.dragDriftDistance) startPan(state)
        }, preferences.dragDriftDelayMs)
      }

      pointerRef.current = state
    },
    [preferences.dragDriftDelayMs, preferences.dragDriftDistance, spacePressed, startPan],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = pointerRef.current
      if (!state || event.pointerId !== state.pointerId) return

      state.currentX = event.clientX
      state.currentY = event.clientY

      if (!state.panning) {
        // 漂移延迟结束前不检测；结束后位移超过阈值即开始平移
        if (!state.monitoring) return
        const moved = Math.hypot(
          event.clientX - state.startX,
          event.clientY - state.startY,
        )
        if (moved > preferences.dragDriftDistance) startPan(state)
        return
      }

      const start = panStartViewportRef.current
      if (!start) return
      // viewport 的 x/y 为屏幕像素位移，直接叠加指针位移即可
      void setViewport(
        {
          x: start.x + (event.clientX - state.startX),
          y: start.y + (event.clientY - state.startY),
          zoom: start.zoom,
        },
        { duration: 0 },
      )
    },
    [preferences.dragDriftDistance, setViewport, startPan],
  )

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = pointerRef.current
      if (!state || event.pointerId !== state.pointerId) return
      if (state.timer !== null) window.clearTimeout(state.timer)

      const element = containerRef.current
      if (state.panning) {
        if (element?.hasPointerCapture(state.pointerId)) {
          element.releasePointerCapture(state.pointerId)
        }
        setIsPanning(false)
        suppressPaneClickRef.current = true
      } else {
        const moved = Math.hypot(
          event.clientX - state.startX,
          event.clientY - state.startY,
        )
        // 位移未超过漂移距离才视为点击；两次点击在设定间隔内则建笔记
        if (moved <= preferences.dragDriftDistance) {
          const now = performance.now()
          const last = lastClickRef.current
          if (last && now - last.time <= preferences.doubleClickMs) {
            lastClickRef.current = null
            // 避免双击触发 onPaneClick 清空刚创建的笔记选中态
            suppressPaneClickRef.current = true
            const position = screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            })
            void createNoteAt(position.x, position.y)
          } else {
            lastClickRef.current = { time: now, x: event.clientX, y: event.clientY }
          }
        }
      }

      pointerRef.current = null
    },
    [
      createNoteAt,
      preferences.doubleClickMs,
      preferences.dragDriftDistance,
      screenToFlowPosition,
    ],
  )

  // 由 parentId 派生 ghost 箭头（建议 + 自定义输入），坐标依赖当前卡片尺寸
  const ghosts = useMemo(() => buildGhostNodes(nodes, cardSize), [nodes, cardSize])
  // 分支输入条同样跟随父卡片移动，堆叠在卡片下方
  const branchInputNodes = useMemo(
    () => buildBranchInputNodes(branchInputs, nodes, cardSize),
    [branchInputs, nodes, cardSize],
  )
  const allNodes = useMemo(
    () => [
      // 固定卡片不可直接拖动；只有标题区（.card-drag-handle）作为拖动手柄
      ...nodes.map((item) => ({
        ...item,
        draggable: !item.data.node.pinned,
        dragHandle: '.card-drag-handle',
      })),
      ...ghosts,
      ...branchInputNodes,
    ],
    [nodes, ghosts, branchInputNodes],
  )

  // 卡片之间为主链/分支实线；卡片指向 ghost 的连线复用主链边并保持虚线
  const edges = useMemo<Edge[]>(() => {
    const { cardWidth, cardHeight, connectionStyle, edgeColor, edgeWidth } = preferences
    const visual = { color: edgeColor, width: edgeWidth }

    // 所有卡片矩形：聊天卡片用全局尺寸，笔记用自身尺寸，ghost 用固定尺寸
    const rects = new Map<string, Rect>()
    for (const item of nodes) {
      const node = item.data.node
      const size =
        node.nodeType === 'note'
          ? {
              width: node.width ?? NOTE_DEFAULT_WIDTH,
              height: node.height ?? NOTE_DEFAULT_HEIGHT,
            }
          : { width: cardWidth, height: cardHeight }
      rects.set(item.id, { x: item.position.x, y: item.position.y, ...size })
    }
    for (const ghost of ghosts) {
      rects.set(ghost.id, {
        x: ghost.position.x,
        y: ghost.position.y,
        width: GHOST_SIZE.width,
        height: GHOST_SIZE.height,
      })
    }

    /** 障碍列表：排除边的 source 与 target 两个节点 */
    const obstaclesOf = (sourceId: string, targetId: string): Rect[] => {
      const list: Rect[] = []
      rects.forEach((rect, id) => {
        if (id !== sourceId && id !== targetId) list.push(rect)
      })
      return list
    }

    // 按父节点分组子卡片，按创建时间升序：第一个为主链，其余为分支
    const childrenByParent = new Map<string, GraphFlowNode[]>()
    for (const item of nodes) {
      const parentId = item.data.node.parentId
      if (!parentId) continue
      const group = childrenByParent.get(parentId) ?? []
      group.push(item)
      childrenByParent.set(parentId, group)
    }

    const result: Edge[] = []

    childrenByParent.forEach((children, parentId) => {
      const parentRect = rects.get(parentId)
      if (!parentRect) return
      children.sort((a, b) =>
        (a.data.node.createdAt ?? '').localeCompare(b.data.node.createdAt ?? ''),
      )

      children.forEach((child, index) => {
        const id = `${parentId}-${child.id}`
        const obstacles = obstaclesOf(parentId, child.id)
        const childRect = rects.get(child.id)
        // 主链按位置判定：子卡片中心在父卡片右侧，且与父卡片处于同一水平带
        const isMain = childRect
          ? childRect.x + childRect.width / 2 > parentRect.x + parentRect.width / 2 &&
            childRect.y < parentRect.y + parentRect.height &&
            childRect.y + childRect.height > parentRect.y
          : index === 0

        // 共用母线：父卡片的全部子卡片共用一条母线（父右引线 → 统一纵向母线 → 子左）
        if (connectionStyle === 'bus') {
          result.push({
            id,
            source: parentId,
            target: child.id,
            type: 'bus',
            sourceHandle: 'source-right',
            targetHandle: 'target-left',
            data: {
              obstacles,
              style: visual,
              gutterX: parentRect.x + parentRect.width + BUS_GUTTER_GAP,
            },
          })
          return
        }

        // 主链：始终保持父右 → 子左
        if (isMain) {
          result.push({
            id,
            source: parentId,
            target: child.id,
            type: 'main',
            sourceHandle: 'source-right',
            targetHandle: 'target-left',
            data: { obstacles, style: visual },
          })
          return
        }

        // 直接分支：子卡片中心在父卡片上方则从上边出线，否则从下边出线
        const parentCenterY = parentRect.y + parentRect.height / 2
        const childAbove = childRect
          ? childRect.y + childRect.height / 2 <= parentCenterY
          : false
        result.push({
          id,
          source: parentId,
          target: child.id,
          type: 'direct',
          sourceHandle: childAbove ? 'source-top' : 'source-bottom',
          targetHandle: childAbove ? 'target-bottom' : 'target-top',
          data: { obstacles, style: visual },
        })
      })
    })

    for (const ghost of ghosts) {
      const parentId = ghost.data.parentId
      result.push({
        id: `${parentId}-${ghost.id}`,
        source: parentId,
        target: ghost.id,
        type: 'main',
        // ghost 只有左侧 target 锚点，不指定 targetHandle 时自动取第一个
        sourceHandle: 'source-right',
        data: {
          obstacles: obstaclesOf(parentId, ghost.id),
          style: { ...visual, dashed: true },
        },
      })
    }

    return result
  }, [nodes, ghosts, preferences])

  // 拖拽开始：确定本次要移动的集合（自身子树或多选集合的子树），记录初始坐标
  const handleNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
    // ghost 与分支输入条不可拖动；聊天卡片与笔记都参与拖动同步
    if (node.type !== 'card' && node.type !== 'note') return
    const state = useGraphStore.getState()
    const dragged = state.nodes.find((item) => item.id === node.id)?.data.node
    if (!dragged || dragged.pinned) return
    // 每次拖拽只在开始时压一次快照，避免移动过程中产生大量撤销步
    state.pushUndo('移动卡片')

    const multiSelected =
      state.selectedNodeIds.length > 1 && state.selectedNodeIds.includes(node.id)
    let moveIds: string[]

    if (multiSelected) {
      // 多选：选中卡片（固定卡片本身不参与拖动）连同各自后代一起移动
      const seeds = state.selectedNodeIds.filter((id) => {
        const card = state.nodes.find((item) => item.id === id)?.data.node
        return card ? !card.pinned : false
      })
      moveIds = collectSubtreeIds(state.nodes, seeds)
    } else {
      // 拖动未选中的卡片：先改为单选，只移动该卡片及其子树
      if (!state.selectedNodeIds.includes(node.id)) state.setSelected(node.id)
      moveIds = collectSubtreeIds(state.nodes, [node.id])
    }

    const positions = new Map<string, { x: number; y: number }>()
    for (const id of moveIds) {
      const card = state.nodes.find((item) => item.id === id)
      if (card) positions.set(id, { x: card.position.x, y: card.position.y })
    }
    dragOriginRef.current = { rootId: node.id, positions }
  }, [])

  // 拖动过程中按位移同步更新集合内全部坐标，只改本地状态，避免逐帧发请求
  const handleNodeDrag = useCallback((event: MouseEvent | TouchEvent, node: Node) => {
    const origin = dragOriginRef.current
    if (!origin || origin.rootId !== node.id) return

    const base = origin.positions.get(node.id)
    if (!base) return
    let offsetX = node.position.x - base.x
    let offsetY = node.position.y - base.y

    // 按住 Shift：先吸附到 20px 网格，再与未拖动卡片的边缘/中心线对齐
    const shiftKey = 'shiftKey' in event && event.shiftKey
    if (shiftKey) {
      offsetX = Math.round((base.x + offsetX) / SNAP_GRID) * SNAP_GRID - base.x
      offsetY = Math.round((base.y + offsetY) / SNAP_GRID) * SNAP_GRID - base.y

      const state = useGraphStore.getState()
      const rootCard = state.nodes.find((item) => item.id === node.id)
      if (rootCard) {
        const size = cardRectSize(rootCard, state.cardSize)
        const others = state.nodes.filter((item) => !origin.positions.has(item.id))
        // 其它卡片的左/中/右、上/中/下三条线都可作为对齐目标
        const xLines = others.flatMap((item) => {
          const x = item.position.x
          const width = cardRectSize(item, state.cardSize).width
          return [x, x + width / 2, x + width]
        })
        const yLines = others.flatMap((item) => {
          const y = item.position.y
          const height = cardRectSize(item, state.cardSize).height
          return [y, y + height / 2, y + height]
        })
        const left = base.x + offsetX
        const top = base.y + offsetY
        offsetX += findSnapOffset([left, left + size.width / 2, left + size.width], xLines)
        offsetY += findSnapOffset([top, top + size.height / 2, top + size.height], yLines)
      }
    }

    useGraphStore.setState((state) => ({
      nodes: state.nodes.map((item) => {
        const start = origin.positions.get(item.id)
        if (!start) return item
        // 整组施加同一偏移，保持子树内部相对位置不变
        return { ...item, position: { x: start.x + offsetX, y: start.y + offsetY } }
      }),
    }))
  }, [])

  // 松手后批量保存本次移动的所有节点坐标
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: Node) => {
      const origin = dragOriginRef.current
      dragOriginRef.current = null
      if (!origin) return

      const cards = useGraphStore.getState().nodes
      void Promise.all(
        [...origin.positions.keys()].map((id) => {
          const card = cards.find((item) => item.id === id)
          return card ? savePosition(id, card.position.x, card.position.y) : Promise.resolve()
        }),
      )
    },
    [savePosition],
  )

  // 自动重排：只在聊天卡片参与布局（ghost 跟随父卡片占位），笔记保持原位
  const handleAutoLayout = useCallback(async () => {
    const state = useGraphStore.getState()
    const positions = computeAutoLayout(
      state.nodes,
      state.cardSize,
      state.preferences.connectionStyle,
    )
    if (positions.size === 0) return
    // 整理会改变全部坐标，先压入撤销快照
    state.pushUndo('自动整理')

    // 逐节点写回坐标（并发）；savePosition 内部失败只告警，不影响其它节点
    await Promise.all(
      [...positions].map(([id, position]) => state.savePosition(id, position.x, position.y)),
    )
  }, [])

  // 仅在打开/切换画布时定位一次：有保存视口则恢复，否则 fitView
  useEffect(() => {
    if (!currentProjectId || nodes.length === 0) return
    if (fittedProjectRef.current === currentProjectId) return
    fittedProjectRef.current = currentProjectId

    const timer = window.setTimeout(() => {
      const viewport = project?.viewport
      if (viewport) {
        void setViewport(viewport, { duration: 0 })
      } else {
        // 单张卡片时限制最大缩放，避免 1 张卡片被放大到 200% 超出屏宽
        void fitView({ padding: 0.25, maxZoom: 1, duration: 0 })
      }
    }, 80)

    return () => window.clearTimeout(timer)
  }, [currentProjectId, nodes.length, project, fitView, setViewport])

  // 视口变化防抖 500ms 后保存
  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current)
      viewportTimerRef.current = window.setTimeout(() => {
        viewportTimerRef.current = null
        void useGraphStore.getState().setViewport(viewport)
      }, 500)
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={[
        'relative h-full w-full bg-canvas',
        isPanning ? 'cursor-grabbing' : spacePressed ? 'cursor-grab' : '',
      ].join(' ')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <ReactFlow
        nodes={allNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={false}
        minZoom={0.1}
        maxZoom={2}
        // 双击空白用于新建笔记，关闭默认的双击缩放
        zoomOnDoubleClick={false}
        // 关闭库自带的空格平移激活：否则按住空格滚轮会被强制改为上下平移
        panActivationKeyCode={null}
        // 卡片拖动沿用同一「漂移距离」判定
        nodeDragThreshold={preferences.dragDriftDistance}
        // 取消选中卡片自动抬升，保证 ghost 与分支输入条（zIndex 10）始终在卡片之上
        elevateNodesOnSelect={false}
        // 空格按住时左键可平移；中键始终可平移；普通左键不平移
        panOnDrag={spacePressed ? [0, 1] : [1]}
        onNodeClick={(event, node) => {
          // ghost 与分支输入条不可选中；聊天卡片与笔记都参与选中
          if (node.type !== 'card' && node.type !== 'note') return
          if (event.ctrlKey || event.metaKey) {
            toggleSelected(node.id)
          } else {
            setSelected(node.id)
          }
        }}
        onPaneClick={() => {
          // 平移刚结束的那次点击不算取消选择
          if (suppressPaneClickRef.current) {
            suppressPaneClickRef.current = false
            return
          }
          clearSelection()
        }}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
      >
        <Background gap={24} color={dotColor} />
        <Panel position="top-left">
          <button
            type="button"
            onClick={() => void handleAutoLayout()}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-subtle bg-panel px-2.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
          >
            <LayoutGrid size={12} />
            自动重排
          </button>
        </Panel>
        {selectedNodeIds.length > 1 && (
          <Panel position="top-center">
            <div className="flex items-center gap-2 rounded-lg border border-subtle bg-panel px-3 py-1.5">
              <span className="text-[12px] text-muted">已选 {selectedNodeIds.length} 张</span>
              <button
                type="button"
                onClick={() => void deleteSelected()}
                className="rounded-md px-2 py-1 text-[12px] text-danger transition-colors duration-150 hover:bg-ghost-border"
              >
                删除所选
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md px-2 py-1 text-[12px] text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
              >
                取消选择
              </button>
            </div>
          </Panel>
        )}
        <Panel position="bottom-center">
          <AskBar />
        </Panel>
        <Panel position="bottom-right">
          <ZoomPanel />
        </Panel>
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-[13px] text-muted">
            {currentProjectId ? '这张画布还没有卡片，先输入你的元问题' : '正在加载画布…'}
          </p>
        </div>
      )}
    </div>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
