import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import {
  Background,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Brain, Globe, LayoutGrid, Maximize, Minus, Plus } from 'lucide-react'
import { CardNode } from './CardNode'
import { NoteNode } from './NoteNode'
import { BranchInputNode } from './BranchInputNode'
import { GhostInputNode } from './GhostInputNode'
import { GhostNode } from './GhostNode'
import { buildBranchInputNodes, buildGhostNodes } from './ghosts'
import { computeAutoLayout, followNotesWithLinks, newCardOverlapsGhost } from './layout'
import { BusEdge, DirectEdge, MainEdge, NoteLinkEdge } from './edges'
import type { Rect } from './edges'
import {
  NOTE_LINK_START_EVENT,
  answerLinkAnchor,
  noteLinkAnchor,
  setNoteLinkDragSignal,
} from './noteLink'
import type { NoteLinkSourceKind, NoteLinkStartPayload } from './noteLink'
import { NOTE_DEFAULT_HEIGHT, NOTE_DEFAULT_WIDTH, useGraphStore } from '../store/graphStore'
import type { GraphFlowNode } from '../store/graphStore'
import { DOT_COLORS, resolveTheme } from '../lib/theme'
import { useSpacePressed } from '../lib/spaceKey'
import {
  bumpUiLayer,
  dropUiLayer,
  getFocusedInput,
  getUiLayerVersion,
  resolveLayerZ,
  subscribeUiLayer,
} from '../lib/uiLayers'

const nodeTypes = {
  card: CardNode,
  note: NoteNode,
  ghost: GhostNode,
  'ghost-input': GhostInputNode,
  'branch-input': BranchInputNode,
}

/** 自定义边：主链 / 直接分支 / 共用母线 / 笔记连接 */
const edgeTypes = {
  main: MainEdge,
  direct: DirectEdge,
  bus: BusEdge,
  'note-link': NoteLinkEdge,
}

/** ghost 卡片尺寸，与 GhostNode / GhostInputNode 的 280×44 保持一致 */
const GHOST_SIZE = { width: 280, height: 44 }

/** 点状画布的网格步长（px），Shift 平移吸附与背景点阵一致 */
const CANVAS_DOT_GAP = 24

/** 缩放范围：最大 500%，最小保持 10% */
const MAX_ZOOM = 5
const MIN_ZOOM = 0.1

/**
 * 拖入内容是否为可导入的 JSON 文件：
 * 拖拽阶段拿不到文件名，能拿到 MIME 时先排除明显的非 JSON 文件；
 * drop 时再按 .json 扩展名做最终过滤。
 */
function hasJsonDrag(dataTransfer: DataTransfer): boolean {
  if (!dataTransfer.types.includes('Files')) return false
  return Array.from(dataTransfer.items).every(
    (item) => item.kind !== 'file' || item.type === '' || item.type === 'application/json',
  )
}

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
  /** 最近一次移动的时间与坐标，用于松手时换算惯性速度 */
  lastX: number
  lastY: number
  lastTime: number
  velocityX: number
  velocityY: number
  monitoring: boolean
  panning: boolean
  timer: number | null
}

/** 笔记连线拖拽会话：起点节点、指针位置与当前吸附目标 */
interface NoteLinkDragSession {
  nodeId: string
  kind: NoteLinkSourceKind
  /** 起点连接点的画布坐标 */
  origin: { x: number; y: number }
  /** 指针的画布坐标（未吸附时的预览终点） */
  pointerFlow: { x: number; y: number }
  snappedNodeId: string | null
  snappedAnchor: { x: number; y: number } | null
}

/** 预览线：用屏幕坐标绘制，起点每次按当前视口从画布坐标换算 */
interface NoteLinkPreview {
  start: { x: number; y: number }
  end: { x: number; y: number }
  sourceKind: NoteLinkSourceKind
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

/** 卡片在画布坐标中的矩形 */
function nodeRect(
  card: GraphFlowNode,
  cardSize: { width: number; height: number },
): Rect {
  return {
    x: card.position.x,
    y: card.position.y,
    ...cardRectSize(card, cardSize),
  }
}

/** 点是否落在卡片矩形内（含边界） */
function pointInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** 连线吸附半径：屏幕像素，按当前 zoom 换算到画布坐标 */
const NOTE_LINK_SNAP_SCREEN = 24

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
  // 达到缩放上下限时禁用按钮，避免继续点击无反馈
  const atMax = zoom >= MAX_ZOOM - 0.001
  const atMin = zoom <= MIN_ZOOM + 0.001

  return (
    <div className="glass-surface mb-5 flex items-center gap-1 rounded-lg border border-subtle p-1">
      <PanelButton
        title="缩小"
        disabled={atMin}
        onClick={() => void zoomOut({ duration: 150 })}
      >
        <Minus size={14} />
      </PanelButton>
      <span className="w-10 text-center text-[12px] tabular-nums text-muted">
        {Math.round(zoom * 100)}%
      </span>
      <PanelButton
        title="放大"
        disabled={atMax}
        onClick={() => void zoomIn({ duration: 150 })}
      >
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
  disabled = false,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'hover:bg-ghost-border hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function CanvasInner() {
  const nodes = useGraphStore((state) => state.nodes)
  const links = useGraphStore((state) => state.links)
  const cardSize = useGraphStore((state) => state.cardSize)
  const preferences = useGraphStore((state) => state.preferences)
  const branchInputs = useGraphStore((state) => state.branchInputs)
  /** 新建分支卡片后的落点检测信号（一次性） */
  const layoutCheckNodeId = useGraphStore((state) => state.layoutCheckNodeId)
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
  const importProjectFile = useGraphStore((state) => state.importProjectFile)
  const updatePreferences = useGraphStore((state) => state.updatePreferences)
  const dotColor = useDotColor()

  const { fitView, setViewport, getViewport, screenToFlowPosition } = useReactFlow()
  const fittedProjectRef = useRef<string | null>(null)
  const viewportTimerRef = useRef<number | null>(null)
  /** 空格是否按下：由全局 spaceKey 提供，卡片滚轮逻辑也共用同一状态 */
  const spacePressed = useSpacePressed()
  /** 是否正在自定义平移：用于切换抓取光标 */
  const [isPanning, setIsPanning] = useState(false)
  /** 拖入画布文件时的强调色提示 */
  const [dragActive, setDragActive] = useState(false)
  /** 自动整理插值中：给节点加合成层提示，减少逐帧重绘 */
  const [layoutAnimating, setLayoutAnimating] = useState(false)
  /** 是否正在拖动卡片：给画布外层加 class，供样式关闭拖动期间的重效果 */
  const [isNodeDragging, setIsNodeDragging] = useState(false)
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
  /** 拖动坐标更新按帧合并：高刷新率指针事件只触发一次重渲染 */
  const dragFrameRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ x: number; y: number } | null>(null)
  /** 拖拽结束时间：抑制拖拽后的 click 把多选收缩成单选 */
  const lastDragEndRef = useRef(0)
  /** 空格手动平移：记录起始指针与按下时的视口 */
  const spacePanRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    viewport: { x: number; y: number; zoom: number }
    lastX: number
    lastY: number
    lastTime: number
    velocityX: number
    velocityY: number
  } | null>(null)
  /** 平移惯性动画帧 */
  const inertiaRef = useRef<number | null>(null)
  /** 自动整理位置动画帧与取消标记 */
  const layoutAnimationRef = useRef<number | null>(null)
  const layoutCanceledRef = useRef(false)
  /** 笔记连线预览：当前会话与淡出状态 */
  const [linkPreview, setLinkPreview] = useState<NoteLinkPreview | null>(null)
  const [linkPreviewLeaving, setLinkPreviewLeaving] = useState(false)
  const linkPreviewTimerRef = useRef<number | null>(null)
  const linkDragRef = useRef<NoteLinkDragSession | null>(null)
  /** 当前 hover 的笔记连接线 id，供 Delete 删除 */
  const hoveredLinkRef = useRef<string | null>(null)
  /** 连线拖拽结束时间：抑制随后补发的 click 改变选中态 */
  const lastLinkDragEndRef = useRef(0)

  // 空格按住时左键可平移（由 capture 逻辑接管）；平时只有中键平移，左键空白用于拖动/点击判定

  /** 系统减弱动态时禁用惯性滑行与自动整理插值 */
  const prefersReducedMotion = useCallback(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  /** 记录连接线 hover：Delete 时只删除当前悬停的那条连线 */
  const handleNoteLinkHover = useCallback((linkId: string | null) => {
    hoveredLinkRef.current = linkId
  }, [])

  // 悬停连线时按 Delete：capture 阶段拦截，避免 App 的全局 Delete 删除卡片
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const linkId = hoveredLinkRef.current
      if (event.key !== 'Delete' || !linkId) return
      const active = document.activeElement as HTMLElement | null
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      hoveredLinkRef.current = null
      const state = useGraphStore.getState()
      state.pushUndo('删除连接')
      void state.deleteNoteLink(linkId)
    }
    // capture 阶段先于 App 的 window 冒泡监听
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  /**
   * 从连接点开始一次连线拖拽：记录起点并挂载全局指针监听，
   * 预览线、吸附与松手判定都在这里完成。
   */
  const beginNoteLinkDrag = useCallback(
    (payload: NoteLinkStartPayload) => {
      if (linkDragRef.current) return
      const initialState = useGraphStore.getState()
      const card = initialState.nodes.find((item) => item.id === payload.nodeId)
      const container = containerRef.current
      if (!card || !container) return
      // 起点类型必须与卡片类型一致
      const nodeType = card.data.node.nodeType
      if (payload.kind === 'answer' ? nodeType !== 'chat' : nodeType !== 'note') return

      const rect = nodeRect(card, initialState.cardSize)
      const origin = payload.kind === 'answer' ? answerLinkAnchor(rect) : noteLinkAnchor(rect)
      const bounds = container.getBoundingClientRect()

      /** 画布坐标 → 画布容器内的屏幕坐标，按当前视口换算 */
      const toScreen = (point: { x: number; y: number }) => {
        const viewport = getViewport()
        return {
          x: point.x * viewport.zoom + viewport.x,
          y: point.y * viewport.zoom + viewport.y,
        }
      }

      /** 找指针附近最近的可连接连接点：指针落在卡片矩形内或连接点 24px 内吸附 */
      const findSnap = (
        pointerFlow: { x: number; y: number },
        zoom: number,
      ): { nodeId: string; anchor: { x: number; y: number } } | null => {
        const current = useGraphStore.getState()
        // 回答端只能连笔记，笔记端只能连回答
        const wantNote = payload.kind === 'answer'
        let best: { nodeId: string; anchor: { x: number; y: number } } | null = null
        let bestDistance = NOTE_LINK_SNAP_SCREEN + 1
        // 指针整张卡片范围内优先吸附；多张卡片重叠时取连接点最近者
        let inside: { nodeId: string; anchor: { x: number; y: number } } | null = null
        let insideDistance = Number.POSITIVE_INFINITY
        for (const item of current.nodes) {
          const isNote = item.data.node.nodeType === 'note'
          if (isNote !== wantNote) continue
          const targetRect = nodeRect(item, current.cardSize)
          const anchor = isNote ? noteLinkAnchor(targetRect) : answerLinkAnchor(targetRect)
          const distance = Math.hypot(anchor.x - pointerFlow.x, anchor.y - pointerFlow.y) * zoom
          if (distance <= NOTE_LINK_SNAP_SCREEN && distance < bestDistance) {
            bestDistance = distance
            best = { nodeId: item.id, anchor }
          }
          if (pointInRect(pointerFlow, targetRect) && distance < insideDistance) {
            insideDistance = distance
            inside = { nodeId: item.id, anchor }
          }
        }
        return inside ?? best
      }

      /** 命中任意目标类型卡片的矩形（用于松手时不需要精确落在连接点） */
      const findNodeAt = (
        pointerFlow: { x: number; y: number },
        wantNote: boolean,
      ): GraphFlowNode | null => {
        const current = useGraphStore.getState()
        // 后创建的节点通常在上层，倒序命中
        for (let index = current.nodes.length - 1; index >= 0; index -= 1) {
          const item = current.nodes[index]
          const isNote = item.data.node.nodeType === 'note'
          if (isNote !== wantNote) continue
          if (pointInRect(pointerFlow, nodeRect(item, current.cardSize))) return item
        }
        return null
      }

      linkDragRef.current = {
        nodeId: payload.nodeId,
        kind: payload.kind,
        origin,
        pointerFlow: screenToFlowPosition({ x: payload.clientX, y: payload.clientY }),
        snappedNodeId: null,
        snappedAnchor: null,
      }

      // 上一次的淡出计时未结束时先清掉，新的预览立即出现
      if (linkPreviewTimerRef.current !== null) {
        window.clearTimeout(linkPreviewTimerRef.current)
        linkPreviewTimerRef.current = null
      }
      setLinkPreviewLeaving(false)
      setLinkPreview({
        start: toScreen(origin),
        end: {
          x: payload.clientX - bounds.left,
          y: payload.clientY - bounds.top,
        },
        sourceKind: payload.kind,
      })
      setNoteLinkDragSignal({
        active: true,
        sourceKind: payload.kind,
        sourceNodeId: payload.nodeId,
        snappedNodeId: null,
      })

      const handleMove = (event: PointerEvent) => {
        const session = linkDragRef.current
        if (!session) return
        const pointerFlow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const zoom = getViewport().zoom
        const snapped = findSnap(pointerFlow, zoom)
        session.pointerFlow = pointerFlow
        session.snappedNodeId = snapped?.nodeId ?? null
        session.snappedAnchor = snapped?.anchor ?? null
        const endFlow = snapped ? snapped.anchor : pointerFlow
        setLinkPreview({
          start: toScreen(session.origin),
          end: toScreen(endFlow),
          sourceKind: session.kind,
        })
        setNoteLinkDragSignal({
          active: true,
          sourceKind: session.kind,
          sourceNodeId: session.nodeId,
          snappedNodeId: session.snappedNodeId,
        })
      }

      /** 连接切换：已存在则断开，不存在则新建 */
      const connect = (answerNodeId: string, noteNodeId: string) => {
        const current = useGraphStore.getState()
        const existing = current.links.find(
          (link) => link.answerNodeId === answerNodeId && link.noteNodeId === noteNodeId,
        )
        if (existing) {
          // 重复连接同一条线：视为断开已有连接
          current.pushUndo('删除连接')
          void current.deleteNoteLink(existing.id)
          current.showToast('已断开连接')
          return
        }
        current.pushUndo('连接笔记')
        void current.createNoteLink(answerNodeId, noteNodeId)
      }

      const finish = (event: PointerEvent | null) => {
        const session = linkDragRef.current
        if (!session) return
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        linkDragRef.current = null
        // 抑制松手后补发的 click，避免误改选中态或清空选择
        lastLinkDragEndRef.current = performance.now()

        const zoom = getViewport().zoom
        const pointerFlow = event
          ? screenToFlowPosition({ x: event.clientX, y: event.clientY })
          : session.pointerFlow
        // 松手时重新判定吸附：优先命中被吸附的连接点
        const snapped = event
          ? findSnap(pointerFlow, zoom)
          : session.snappedNodeId && session.snappedAnchor
            ? { nodeId: session.snappedNodeId, anchor: session.snappedAnchor }
            : null
        const endFlow = snapped ? snapped.anchor : pointerFlow

        // 结束高亮；预览线保留 140ms 做淡出
        setNoteLinkDragSignal({ active: false, sourceKind: null, sourceNodeId: null, snappedNodeId: null })
        setLinkPreview({
          start: toScreen(session.origin),
          end: toScreen(endFlow),
          sourceKind: session.kind,
        })
        setLinkPreviewLeaving(true)
        if (linkPreviewTimerRef.current !== null) {
          window.clearTimeout(linkPreviewTimerRef.current)
        }
        linkPreviewTimerRef.current = window.setTimeout(() => {
          linkPreviewTimerRef.current = null
          setLinkPreview(null)
          setLinkPreviewLeaving(false)
        }, 140)

        const current = useGraphStore.getState()
        if (session.kind === 'note') {
          // 从笔记端出发：命中任意回答卡片即可，未命中则取消
          const answerId = snapped?.nodeId ?? findNodeAt(pointerFlow, false)?.id ?? null
          if (answerId) connect(answerId, session.nodeId)
          return
        }

        // 从回答端出发：命中任意笔记卡片即可
        const noteId = snapped?.nodeId ?? findNodeAt(pointerFlow, true)?.id ?? null
        if (noteId) {
          connect(session.nodeId, noteId)
          return
        }
        // 未命中笔记卡片：按设置（或按住 Shift）创建空白笔记并连接
        const action = current.preferences.noteLinkReleaseAction
        const shouldCreate =
          action === 'note' || (action === 'shift-note' && (event?.shiftKey ?? false))
        if (!shouldCreate) return
        void current.createNoteLinkedTo(pointerFlow.x, pointerFlow.y, session.nodeId)
      }

      const handleUp = (event: PointerEvent) => finish(event)
      const handleCancel = () => finish(null)

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [getViewport, screenToFlowPosition],
  )

  // 节点内连接点按下后广播开始事件
  useEffect(() => {
    const handleStart = (event: Event) => {
      beginNoteLinkDrag((event as CustomEvent<NoteLinkStartPayload>).detail)
    }
    window.addEventListener(NOTE_LINK_START_EVENT, handleStart)
    return () => window.removeEventListener(NOTE_LINK_START_EVENT, handleStart)
  }, [beginNoteLinkDrag])

  /** 停止当前平移惯性动画 */
  const stopInertia = useCallback(() => {
    if (inertiaRef.current !== null) {
      window.cancelAnimationFrame(inertiaRef.current)
      inertiaRef.current = null
    }
  }, [])

  /** 松手后按指针速度继续滑行，速度指数衰减，再次按下立即停止 */
  const startInertia = useCallback(
    (velocityX: number, velocityY: number) => {
      if (!preferences.panInertiaEnabled || prefersReducedMotion()) return
      // 惯性系数缩放松手速度：越大滑行越远
      let vx = velocityX * preferences.panInertiaCoefficient
      let vy = velocityY * preferences.panInertiaCoefficient
      if (Math.hypot(vx, vy) < 0.12) return
      const viewport = getViewport()
      let x = viewport.x
      let y = viewport.y
      let last = performance.now()
      let lastFrameAt = 0
      const step = (now: number) => {
        // 高刷新率屏幕上把惯性计算限制在 60Hz，避免多余的状态写回
        if (now - lastFrameAt < 16) {
          inertiaRef.current = window.requestAnimationFrame(step)
          return
        }
        lastFrameAt = now
        const dt = Math.min(now - last, 32)
        last = now
        x += vx * dt
        y += vy * dt
        // 每 16ms 衰减到 94%，约 300ms 内停下
        const decay = Math.pow(0.94, dt / 16)
        vx *= decay
        vy *= decay
        void setViewport({ x, y, zoom: viewport.zoom }, { duration: 0 })
        if (Math.hypot(vx, vy) > 0.05) {
          inertiaRef.current = window.requestAnimationFrame(step)
        } else {
          inertiaRef.current = null
        }
      }
      inertiaRef.current = window.requestAnimationFrame(step)
    },
    [
      getViewport,
      prefersReducedMotion,
      preferences.panInertiaCoefficient,
      preferences.panInertiaEnabled,
      setViewport,
    ],
  )

  /** 点状画布 + Shift：把视口位移吸附到点阵步长，保证点阵落在整数网格 */
  const snapPan = useCallback(
    (x: number, y: number, zoom: number, shift: boolean) => {
      if (!shift || preferences.canvasStyle !== 'dots') return { x, y }
      const step = CANVAS_DOT_GAP * zoom
      if (step <= 0) return { x, y }
      return { x: Math.round(x / step) * step, y: Math.round(y / step) * step }
    },
    [preferences.canvasStyle],
  )

  /**
   * 滚轮缩放导致视口变化后重新校准平移基准：
   * 记录「当前指针位置 ↔ 最新视口」，拖动继续按增量换算，避免缩放后回弹或抖动；
   * 同时清零速度，松手时不会误触发惯性。
   */
  const recalibratePanBaseline = useCallback(
    (pointerX: number, pointerY: number) => {
      const viewport = getViewport()
      const now = performance.now()

      const spacePan = spacePanRef.current
      if (spacePan) {
        spacePan.startX = pointerX
        spacePan.startY = pointerY
        spacePan.viewport = viewport
        spacePan.lastX = pointerX
        spacePan.lastY = pointerY
        spacePan.lastTime = now
        spacePan.velocityX = 0
        spacePan.velocityY = 0
      }

      const panePan = pointerRef.current
      if (panePan?.panning) {
        panePan.startX = pointerX
        panePan.startY = pointerY
        panePan.lastX = pointerX
        panePan.lastY = pointerY
        panePan.lastTime = now
        panePan.velocityX = 0
        panePan.velocityY = 0
        panStartViewportRef.current = viewport
      }
    },
    [getViewport],
  )

  /**
   * macOS / Windows 触控板：双指滑动平移画布，捏合（浏览器会带 ctrlKey）交给 React Flow 缩放。
   * 鼠标滚轮保持「滚轮逻辑」设置中的缩放行为，因此这里只拦截步长细小的触控板事件。
   * React 的 wheel 监听是 passive 的无法 preventDefault，改用原生监听 + 捕获阶段。
   */
  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const handleWheel = (event: WheelEvent) => {
      // 缩放由 React Flow 在本次事件中完成，下一帧再按当前指针位置重设平移基准，
      // 保证拖动过程中缩放跟手、不回弹
      const recalibrateLater = () => {
        const pointerX = event.clientX
        const pointerY = event.clientY
        window.requestAnimationFrame(() => recalibratePanBaseline(pointerX, pointerY))
      }

      // 空格按住时滚轮始终缩放画布：先于 .nowheel 放行逻辑处理，
      // 阻止该区域原生滚动、停止惯性后交给 React Flow 完成缩放
      if (spacePressed) {
        event.preventDefault()
        stopInertia()
        recalibrateLater()
        return
      }

      // 未按空格：可滚动区域（卡片正文、思考过程、参考资料抽屉等）完全交给原生滚动：
      // 不 preventDefault、不缩放、不平移，滚到边界也不会冒泡成画布缩放
      const target = event.target as Element | null
      if (target?.closest('.nowheel')) return

      // 开始滚轮操作即停止正在播放的平移惯性
      stopInertia()

      // 触控板捏合：ctrlKey 由浏览器自动附带，交给 React Flow 的缩放
      if (event.ctrlKey || event.metaKey) {
        recalibrateLater()
        return
      }

      // 触控板双指滑动：deltaMode 为像素且步长细小；鼠标滚轮通常是 ±100
      const isTrackpad =
        event.deltaMode === 0 && (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 40)
      if (!isTrackpad) {
        // 鼠标滚轮缩放同样交给 React Flow
        recalibrateLater()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const viewport = getViewport()
      void setViewport(
        {
          x: viewport.x - event.deltaX,
          y: viewport.y - event.deltaY,
          zoom: viewport.zoom,
        },
        { duration: 0 },
      )
    }

    element.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => element.removeEventListener('wheel', handleWheel, { capture: true })
  }, [getViewport, recalibratePanBaseline, setViewport, spacePressed, stopInertia])

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
      // 新的按压立即终止上一次平移惯性
      stopInertia()
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
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
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
    [preferences.dragDriftDelayMs, preferences.dragDriftDistance, spacePressed, startPan, stopInertia],
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
      // 记录最近的指针速度，松手后用于惯性滑行
      const now = performance.now()
      const dt = now - state.lastTime
      if (dt > 0) {
        state.velocityX = state.velocityX * 0.6 + ((event.clientX - state.lastX) / dt) * 0.4
        state.velocityY = state.velocityY * 0.6 + ((event.clientY - state.lastY) / dt) * 0.4
      }
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.lastTime = now
      // viewport 的 x/y 为屏幕像素位移，直接叠加指针位移即可；点状画布下 Shift 吸附网格
      const target = snapPan(
        start.x + (event.clientX - state.startX),
        start.y + (event.clientY - state.startY),
        start.zoom,
        event.shiftKey,
      )
      void setViewport({ x: target.x, y: target.y, zoom: start.zoom }, { duration: 0 })
    },
    [preferences.dragDriftDistance, setViewport, snapPan, startPan],
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
        startInertia(state.velocityX, state.velocityY)
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
      startInertia,
    ],
  )

  // 空格按下时接管任意位置的指针：在 capture 阶段拦截，一律平移画布且不选字
  const handleSpacePanDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!spacePressed) return
      // 只响应左键与中键
      if (event.button !== 0 && event.button !== 1) return
      // 空格平移接管前，先停掉上一次惯性
      stopInertia()
      event.preventDefault()
      event.stopPropagation()

      const element = containerRef.current
      if (!element) return
      try {
        element.setPointerCapture(event.pointerId)
      } catch {
        // 指针已在窗口外松开时无法捕获，放弃本次平移
        return
      }

      spacePanRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        viewport: getViewport(),
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
      }
      // 清空点击记录并抑制随后的空白点击，避免误清空选择
      lastClickRef.current = null
      pointerRef.current = null
      suppressPaneClickRef.current = true
      setIsPanning(true)
    },
    [getViewport, spacePressed, stopInertia],
  )

  const handleSpacePanMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = spacePanRef.current
      if (!state || event.pointerId !== state.pointerId) return
      event.stopPropagation()
      // 记录最近的指针速度，松手后用于惯性滑行
      const now = performance.now()
      const dt = now - state.lastTime
      if (dt > 0) {
        state.velocityX = state.velocityX * 0.6 + ((event.clientX - state.lastX) / dt) * 0.4
        state.velocityY = state.velocityY * 0.6 + ((event.clientY - state.lastY) / dt) * 0.4
      }
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.lastTime = now
      // 点状画布下 Shift 吸附到点阵步长
      const target = snapPan(
        state.viewport.x + (event.clientX - state.startX),
        state.viewport.y + (event.clientY - state.startY),
        state.viewport.zoom,
        event.shiftKey,
      )
      void setViewport(
        { x: target.x, y: target.y, zoom: state.viewport.zoom },
        { duration: 0 },
      )
    },
    [setViewport, snapPan],
  )

  const handleSpacePanEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = spacePanRef.current
      if (!state || event.pointerId !== state.pointerId) return
      event.stopPropagation()
      spacePanRef.current = null
      const element = containerRef.current
      if (element?.hasPointerCapture(state.pointerId)) {
        element.releasePointerCapture(state.pointerId)
      }
      setIsPanning(false)
      startInertia(state.velocityX, state.velocityY)
    },
    [startInertia],
  )

  // 由 parentId 派生 ghost 箭头（建议 + 自定义输入），坐标依赖当前卡片尺寸
  // 草稿只在构建时按需读取：输入过程中不订阅 ghostDrafts，避免画布整体重渲染
  const ghosts = useMemo(
    () =>
      buildGhostNodes(
        nodes,
        cardSize,
        preferences.cardGap,
        (parentId) => useGraphStore.getState().ghostDrafts[parentId] ?? '',
      ),
    [nodes, cardSize, preferences.cardGap],
  )
  // 分支输入条同样跟随父卡片移动，堆叠在卡片下方
  const branchInputNodes = useMemo(
    () => buildBranchInputNodes(branchInputs, nodes, cardSize, preferences.cardGap),
    [branchInputs, nodes, cardSize, preferences.cardGap],
  )
  // 动态层级：同类元素中最新显示 / 状态更新 / 获焦者排在最上面
  const layerVersion = useSyncExternalStore(subscribeUiLayer, getUiLayerVersion)
  // 当前获得焦点的输入框：使用独立的「聚焦输入」区段，高于笔记与分支输入
  const focusedInputKey = useSyncExternalStore(subscribeUiLayer, getFocusedInput)

  // 新出现的卡片与状态变化的卡片自动置顶（流式回答的 streaming / done 都算状态更新）
  const nodeStateRef = useRef(new Map<string, string>())
  useEffect(() => {
    const alive = new Set<string>()
    nodes.forEach((item) => {
      alive.add(item.id)
      const status = item.data.node.status
      if (nodeStateRef.current.get(item.id) !== status) bumpUiLayer(item.id)
      nodeStateRef.current.set(item.id, status)
    })
    nodeStateRef.current.forEach((_, id) => {
      if (alive.has(id)) return
      nodeStateRef.current.delete(id)
      dropUiLayer(id)
    })
  }, [nodes])

  // 聊天卡片与笔记分属不同层级区段：猜你想问高于笔记，分支输入条仍在最上层
  const { cardZ, noteZ } = useMemo(() => {
    const chatIds: string[] = []
    const noteIds: string[] = []
    nodes.forEach((item) => {
      if (item.data.node.nodeType === 'note') noteIds.push(item.id)
      else chatIds.push(item.id)
    })
    return {
      cardZ: resolveLayerZ('card', chatIds),
      noteZ: resolveLayerZ('note', noteIds),
    }
    // layerVersion 变化即层级变化，节点本身未变也要重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, layerVersion])
  const ghostZ = useMemo(
    () => resolveLayerZ('ghost', ghosts.map((item) => item.id)),
    [ghosts, layerVersion],
  )
  const branchInputZ = useMemo(
    () => resolveLayerZ(
      'branchInput',
      branchInputNodes.map((item) => item.id),
    ),
    [branchInputNodes, layerVersion],
  )
  // 聚焦输入只保留一个 key，区段内序号固定从基线开始
  const focusedInputZ = useMemo(
    () =>
      focusedInputKey
        ? resolveLayerZ('focusedInput', [focusedInputKey])
        : new Map<string, number>(),
    [focusedInputKey],
  )

  const allNodes = useMemo(
    () => [
      // 固定卡片不可直接拖动；只有标题区（.card-drag-handle）作为拖动手柄
      ...nodes.map((item) => ({
        ...item,
        zIndex:
          item.data.node.nodeType === 'note' ? noteZ.get(item.id) : cardZ.get(item.id),
        draggable: !item.data.node.pinned,
        dragHandle: '.card-drag-handle',
      })),
      ...ghosts.map((item) => ({
        ...item,
        // 聚焦中的自定义输入升到「聚焦输入」区段，压在笔记卡片之上
        zIndex: focusedInputZ.get(item.id) ?? ghostZ.get(item.id),
      })),
      ...branchInputNodes.map((item) => ({
        ...item,
        zIndex: focusedInputZ.get(item.id) ?? branchInputZ.get(item.id),
      })),
    ],
    [
      nodes,
      ghosts,
      branchInputNodes,
      cardZ,
      noteZ,
      ghostZ,
      branchInputZ,
      focusedInputZ,
    ],
  )

  /** 连线拖拽中：已有 note-link 整体变淡，预览线单独绘制 */
  const noteLinkDragging = linkPreview !== null

  // 预览线路径：曲线用 bezier，直角线用 0 圆角 smoothstep；坐标已是画布容器内屏幕坐标
  const previewPath = useMemo(() => {
    if (!linkPreview) return ''
    const { start, end, sourceKind } = linkPreview
    // 回答端从右侧出线，笔记端从左侧出线
    const sourcePosition = sourceKind === 'answer' ? Position.Right : Position.Left
    const targetPosition = sourceKind === 'answer' ? Position.Left : Position.Right
    const params = {
      sourceX: start.x,
      sourceY: start.y,
      sourcePosition,
      targetX: end.x,
      targetY: end.y,
      targetPosition,
    }
    return preferences.noteLinkStyle === 'curved'
      ? getBezierPath(params)[0]
      : getSmoothStepPath({ ...params, borderRadius: 0 })[0]
  }, [linkPreview, preferences.noteLinkStyle])

  // 卡片之间为主链/分支实线；卡片指向 ghost 的连线复用主链边并保持虚线
  const edges = useMemo<Edge[]>(() => {
    const { cardWidth, cardHeight, cardGap, connectionStyle, edgeColor, edgeWidth } = preferences
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
        // 第一子卡片永远是主干（左→右、与父卡片同线）；其余为分支头
        const isMain = index === 0

        // 共用母线：主链保持直连，全部非主干分支共用同一条母线
        if (connectionStyle === 'bus' && !isMain) {
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
              // 母线位于父卡片与右侧子卡片列的中点，全部兄弟分支共用同一 x
              gutterX: parentRect.x + parentRect.width + cardGap / 2,
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

    // 回答卡片与笔记卡片之间的连接：端点由两侧卡片内的连接点 Handle 定位
    for (const link of links) {
      if (!rects.has(link.answerNodeId) || !rects.has(link.noteNodeId)) continue
      result.push({
        // 直接用后端连接 id，hover 回传后 Delete 可以按真实 id 删除
        id: link.id,
        source: link.answerNodeId,
        target: link.noteNodeId,
        type: 'note-link',
        sourceHandle: 'note-link-out',
        targetHandle: 'note-link-in',
        data: {
          linkId: link.id,
          color: preferences.noteLinkColor,
          width: preferences.noteLinkWidth,
          orthogonal: preferences.noteLinkStyle === 'orthogonal',
          dimmed: noteLinkDragging,
          onHoverChange: handleNoteLinkHover,
        },
      })
    }

    return result
  }, [nodes, ghosts, preferences, links, noteLinkDragging, handleNoteLinkHover])

  // 拖拽开始：确定本次要移动的集合（自身子树或多选集合的子树），记录初始坐标
  const handleNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
    // ghost 与分支输入条不可拖动；聊天卡片与笔记都参与拖动同步
    if (node.type !== 'card' && node.type !== 'note') return
    // 用户接管：停止自动整理插值与平移惯性
    layoutCanceledRef.current = true
    stopInertia()
    // 拖动中的卡片是当前焦点，置顶
    bumpUiLayer(node.id)
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

    // 单独拖动笔记时只移动笔记本身；其余情况让「母卡片全部在移动集合中」的笔记随动
    const singleNoteDrag = !multiSelected && dragged.nodeType === 'note'
    if (!singleNoteDrag) {
      const moving = new Set(moveIds)
      const answersByNote = new Map<string, string[]>()
      for (const link of state.links) {
        const list = answersByNote.get(link.noteNodeId) ?? []
        list.push(link.answerNodeId)
        answersByNote.set(link.noteNodeId, list)
      }
      answersByNote.forEach((answerIds, noteId) => {
        if (moving.has(noteId)) return
        // 笔记被未参与移动的另一张母卡片连接时保持原位
        if (answerIds.length === 0 || !answerIds.every((id) => moving.has(id))) return
        const note = state.nodes.find((item) => item.id === noteId)?.data.node
        if (!note || note.pinned) return
        moving.add(noteId)
        moveIds.push(noteId)
      })
    }

    const positions = new Map<string, { x: number; y: number }>()
    for (const id of moveIds) {
      const card = state.nodes.find((item) => item.id === id)
      if (card) positions.set(id, { x: card.position.x, y: card.position.y })
    }
    dragOriginRef.current = { rootId: node.id, positions }
    dragPendingRef.current = null
    setIsNodeDragging(true)
  }, [stopInertia])

  /** 把待处理的拖动偏移写回 store；每帧最多执行一次 */
  const applyDragOffset = useCallback(() => {
    dragFrameRef.current = null
    const origin = dragOriginRef.current
    const offset = dragPendingRef.current
    if (!origin || !offset) return
    useGraphStore.setState((state) => ({
      // 只替换移动集合内的卡片，其余节点保持同一引用，减少下游无谓重算
      nodes: state.nodes.map((item) => {
        const start = origin.positions.get(item.id)
        if (!start) return item
        // 整组施加同一偏移，保持子树内部相对位置不变
        return { ...item, position: { x: start.x + offset.x, y: start.y + offset.y } }
      }),
    }))
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

    dragPendingRef.current = { x: offsetX, y: offsetY }
    // 跟随 requestAnimationFrame 调度：每帧只写一次 store，不额外限制刷新率
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(applyDragOffset)
    }
  }, [applyDragOffset])

  // 松手后批量保存本次移动的所有节点坐标
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: Node) => {
      setIsNodeDragging(false)
      const origin = dragOriginRef.current
      if (!origin) return
      // 把最后一帧尚未写回的坐标补齐，再保存
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      applyDragOffset()
      dragPendingRef.current = null
      dragOriginRef.current = null
      // 记录结束时间，避免拖拽后触发的 click 把多选恢复成单选
      lastDragEndRef.current = performance.now()

      const cards = useGraphStore.getState().nodes
      void Promise.all(
        [...origin.positions.keys()].map((id) => {
          const card = cards.find((item) => item.id === id)
          return card ? savePosition(id, card.position.x, card.position.y) : Promise.resolve()
        }),
      )
    },
    [applyDragOffset, savePosition],
  )

  // 自动重排：只在聊天卡片参与布局（ghost 跟随父卡片占位），笔记保持原位
  const handleAutoLayout = useCallback(async () => {
    // 动画进行中忽略重复点击，避免两段插值互相覆盖
    if (layoutAnimationRef.current !== null) return
    const state = useGraphStore.getState()
    const positions = computeAutoLayout(
      state.nodes,
      state.cardSize,
      state.preferences.connectionStyle,
      state.preferences.cardGap,
    )
    // 笔记不参与排版，但按母卡片的平均位移跟随平移，无连接时保持原位
    followNotesWithLinks(state.nodes, state.links, positions)
    if (positions.size === 0) return
    // 整理会改变全部坐标，先压入撤销快照
    state.pushUndo('自动整理')

    // 减弱动态时直接落位，不播放位移动画
    if (prefersReducedMotion()) {
      await Promise.all(
        [...positions].map(([id, position]) => state.savePosition(id, position.x, position.y)),
      )
      return
    }

    // 记录起点：逐帧写回插值坐标，连线会跟随节点位置同步更新
    const starts = new Map<string, { x: number; y: number }>()
    for (const id of positions.keys()) {
      const card = state.nodes.find((item) => item.id === id)
      if (card) starts.set(id, { ...card.position })
    }
    layoutCanceledRef.current = false
    setLayoutAnimating(true)

    try {
      await new Promise<void>((resolve) => {
        const startedAt = performance.now()
        let lastFrameAt = 0
        const duration = 280
        const tick = (now: number) => {
          if (layoutCanceledRef.current) {
            layoutAnimationRef.current = null
            resolve()
            return
          }
          // 高刷新率屏幕上把插值计算限制在 60Hz
          if (now - lastFrameAt < 16) {
            layoutAnimationRef.current = window.requestAnimationFrame(tick)
            return
          }
          lastFrameAt = now
          const progress = Math.min(1, (now - startedAt) / duration)
          const eased = 1 - Math.pow(1 - progress, 3)
          useGraphStore.setState((current) => ({
            nodes: current.nodes.map((item) => {
              const target = positions.get(item.id)
              const start = starts.get(item.id)
              if (!target || !start) return item
              return {
                ...item,
                position: {
                  x: start.x + (target.x - start.x) * eased,
                  y: start.y + (target.y - start.y) * eased,
                },
              }
            }),
          }))
          if (progress < 1) {
            layoutAnimationRef.current = window.requestAnimationFrame(tick)
          } else {
            layoutAnimationRef.current = null
            resolve()
          }
        }
        layoutAnimationRef.current = window.requestAnimationFrame(tick)
      })

      // 被用户拖拽打断时保留当前位置，不覆盖用户操作
      if (layoutCanceledRef.current) return
      await Promise.all(
        [...positions].map(([id, position]) => state.savePosition(id, position.x, position.y)),
      )
    } finally {
      setLayoutAnimating(false)
    }
  }, [prefersReducedMotion])

  // 新建分支卡片后的落点检测：压住其它卡片的提问区时自动整理一次
  useEffect(() => {
    if (!layoutCheckNodeId) return
    // 等一帧让新卡片的坐标写回画布后再检测
    const frame = window.requestAnimationFrame(() => {
      const state = useGraphStore.getState()
      // 信号已被清空或替换（例如连续新建）时放弃本次检测
      if (state.layoutCheckNodeId !== layoutCheckNodeId) return
      const overlap = newCardOverlapsGhost(
        state.nodes,
        state.cardSize,
        state.preferences.cardGap,
        layoutCheckNodeId,
      )
      state.clearLayoutCheck()
      if (!overlap) return
      // 正在整理或用户正在拖动时跳过，避免打断用户操作
      if (layoutAnimationRef.current !== null || dragOriginRef.current !== null) return
      void handleAutoLayout()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [layoutCheckNodeId, handleAutoLayout])

  // 联网搜索仅 DeepSeek 服务商支持；失败时 store 会回滚，这里只告警
  const webSearchDisabled = preferences.provider !== 'deepseek'
  // 搜索方式弹窗：悬停按钮或弹窗时显示，移出后隐藏
  const [webSearchPanelOpen, setWebSearchPanelOpen] = useState(false)
  const forcedSearch = preferences.webSearchMode === 'forced'
  const toggleForcedSearch = useCallback(async () => {
    if (webSearchDisabled) return
    try {
      await updatePreferences({ webSearchMode: forcedSearch ? 'smart' : 'forced' })
    } catch (err) {
      // store 已回滚，这里只告警
      console.warn('切换搜索方式失败', err)
    }
  }, [forcedSearch, updatePreferences, webSearchDisabled])
  const toggleWebSearch = useCallback(async () => {
    if (webSearchDisabled) return
    try {
      await updatePreferences({ webSearchEnabled: !preferences.webSearchEnabled })
    } catch (err) {
      console.warn('切换联网搜索失败', err)
    }
  }, [preferences.webSearchEnabled, updatePreferences, webSearchDisabled])

  // 思考模式同样仅 DeepSeek 支持，与卡片、设置里的开关共用同一字段
  const thinkingDisabled = preferences.provider !== 'deepseek'
  const toggleThinking = useCallback(async () => {
    if (thinkingDisabled) return
    try {
      await updatePreferences({ thinkingEnabled: !preferences.thinkingEnabled })
    } catch (err) {
      console.warn('切换思考模式失败', err)
    }
  }, [preferences.thinkingEnabled, thinkingDisabled, updatePreferences])

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

  // 拖入 JSON 文件：输入框与 .nodrag 区域交给原有附件拖拽逻辑，其余位置按画布导入处理
  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('textarea, input, .nodrag')) return
    if (!hasJsonDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    // 只在真正离开容器时收起提示，子元素之间移动不闪烁
    const related = event.relatedTarget
    if (related instanceof Element && event.currentTarget.contains(related)) return
    setDragActive(false)
  }, [])

  const handleDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest('textarea, input, .nodrag')) return
      const file = Array.from(event.dataTransfer.files).find((item) =>
        item.name.toLowerCase().endsWith('.json'),
      )
      if (!file) return
      event.preventDefault()
      setDragActive(false)
      // 导入成功由 store 给出 toast，失败时弹出可读错误
      await importProjectFile(file)
    },
    [importProjectFile],
  )

  useEffect(() => {
    return () => {
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current)
      if (inertiaRef.current !== null) window.cancelAnimationFrame(inertiaRef.current)
      if (layoutAnimationRef.current !== null) window.cancelAnimationFrame(layoutAnimationRef.current)
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current)
      if (linkPreviewTimerRef.current !== null) window.clearTimeout(linkPreviewTimerRef.current)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={[
        'relative h-full w-full bg-canvas',
        // 空格按住期间全局禁止选中文字
        spacePressed ? 'space-panning' : '',
        isPanning ? 'cursor-grabbing' : spacePressed ? 'cursor-grab' : '',
        layoutAnimating ? 'layout-animating' : '',
        // 拖动期间由样式层关闭毛玻璃/阴影等重效果
        isNodeDragging ? 'is-node-dragging' : '',
      ].join(' ')}
      // 空格按下时在 capture 阶段接管指针，卡片/输入框上的拖动也一律平移画布
      onPointerDownCapture={handleSpacePanDown}
      onPointerMoveCapture={handleSpacePanMove}
      onPointerUpCapture={handleSpacePanEnd}
      onPointerCancelCapture={handleSpacePanEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      <ReactFlow
        nodes={allNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // 双击空白用于新建笔记，关闭默认的双击缩放
        zoomOnDoubleClick={false}
        // 关闭库自带的空格平移激活：否则按住空格滚轮会被强制改为上下平移
        panActivationKeyCode={null}
        // 空格按住时换成不存在的类名，让 .nowheel 内部的滚轮也交由 React Flow 缩放；
        // 普通状态下保留 .nowheel 的原生滚动放行
        noWheelClassName={spacePressed ? 'nowheel-space-zoom' : 'nowheel'}
        // 卡片拖动沿用同一「漂移距离」判定
        nodeDragThreshold={preferences.dragDriftDistance}
        // 取消库内选中自动抬升，层级统一交给 lib/uiLayers 的动态分配器
        elevateNodesOnSelect={false}
        // 连线始终在卡片之下：禁止选中边或转发节点的层级把边抬到卡片上方
        elevateEdgesOnSelect={false}
        // 空格按住时卡片不可拖动，左键拖动改为平移画布
        nodesDraggable={!spacePressed}
        // 中键平移由 React Flow 负责；空格左键平移由上面的 capture 逻辑完成
        panOnDrag={[1]}
        // 删除键由 App 的全局快捷键统一处理，关闭库内部删除避免与 store 不一致
        deleteKeyCode={null}
        onNodeClick={(event, node) => {
          // ghost 与分支输入条不可选中；聊天卡片与笔记都参与选中
          if (node.type !== 'card' && node.type !== 'note') return
          // 获焦卡片置顶，避免被其它卡片或输入浮层遮挡
          bumpUiLayer(node.id)
          // 拖拽松手后浏览器仍可能补发 click，此时保持原来的多选集合
          if (performance.now() - lastDragEndRef.current < 100) return
          // 连线拖拽结束后同样忽略补发的 click
          if (performance.now() - lastLinkDragEndRef.current < 150) return
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
          // 连线拖拽松手后补发的点击同样不取消选择
          if (performance.now() - lastLinkDragEndRef.current < 150) return
          clearSelection()
        }}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
      >
        {/* 画布样式：无 = 纯色背景；点状 = 规律点阵 */}
        {preferences.canvasStyle === 'dots' && (
          <Background gap={CANVAS_DOT_GAP} color={dotColor} size={1.5} />
        )}
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAutoLayout()}
              className="glass-surface flex h-7 items-center gap-1.5 rounded-lg border border-subtle px-2.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
            >
              <LayoutGrid size={12} />
              自动重排
            </button>
            <button
              type="button"
              title={thinkingDisabled ? '仅 DeepSeek 服务商支持思考模式' : '深度思考'}
              aria-disabled={thinkingDisabled}
              aria-pressed={preferences.thinkingEnabled}
              onClick={() => void toggleThinking()}
              className={[
                'flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors duration-150',
                thinkingDisabled
                  ? 'glass-surface cursor-not-allowed border-subtle text-muted opacity-40'
                  : preferences.thinkingEnabled
                    ? 'glass-surface border-accent bg-accent-dim text-accent'
                    : 'glass-surface border-subtle text-muted hover:text-ink',
              ].join(' ')}
            >
              <Brain size={12} />
              深度思考
            </button>
            <div
              className="relative"
              onMouseEnter={() => setWebSearchPanelOpen(true)}
              onMouseLeave={() => setWebSearchPanelOpen(false)}
            >
              <button
                type="button"
                title={webSearchDisabled ? '仅 DeepSeek 服务商支持联网搜索' : '联网搜索'}
                aria-disabled={webSearchDisabled}
                onClick={() => void toggleWebSearch()}
                className={[
                  'flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors duration-150',
                  webSearchDisabled
                    ? 'glass-surface cursor-not-allowed border-subtle text-muted opacity-40'
                    : preferences.webSearchEnabled
                      ? 'glass-surface border-accent bg-accent-dim text-accent'
                      : 'glass-surface border-subtle text-muted hover:text-ink',
                ].join(' ')}
              >
                <Globe size={12} />
                联网搜索
              </button>

              {/* 悬停弹窗：外层留出 8px 内边距，鼠标从按钮移入弹窗时不闪烁 */}
              {webSearchPanelOpen && (
                <div className="absolute left-0 top-full z-30 pt-2">
                  <div className="glass-surface panel-pop w-[240px] rounded-lg border border-subtle p-3 shadow-lg">
                    <p className="mb-2 text-[12px] font-medium text-ink">搜索方式</p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-body">强制搜索</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={forcedSearch}
                        aria-label="强制搜索"
                        disabled={webSearchDisabled}
                        onClick={() => void toggleForcedSearch()}
                        className={[
                          'relative h-5 w-9 flex-none rounded-full border transition-colors duration-150',
                          forcedSearch ? 'border-accent bg-accent-dim' : 'border-subtle bg-elevated',
                          webSearchDisabled ? 'cursor-not-allowed opacity-40' : '',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left,background-color] duration-150',
                            forcedSearch ? 'left-[18px] bg-accent' : 'left-0.5 bg-muted',
                          ].join(' ')}
                        />
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] leading-[1.5] text-muted">
                      关闭时使用智能搜索（模型自主判断是否联网）
                    </p>
                    {webSearchDisabled && (
                      <p className="mt-1 text-[11px] leading-[1.5] text-muted">仅支持 DeepSeek</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Panel>
        {selectedNodeIds.length > 1 && (
          <Panel position="top-center">
            <div className="glass-surface panel-pop flex items-center gap-2 rounded-lg border border-subtle px-3 py-1.5">
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
        <Panel position="bottom-right">
          <ZoomPanel />
        </Panel>
      </ReactFlow>

      {/* 连线预览：画布容器内屏幕坐标，随视口换算并随手势实时更新 */}
      {linkPreview && (
        <svg
          className={['note-link-preview', linkPreviewLeaving ? 'is-leaving' : ''].join(' ')}
          aria-hidden="true"
        >
          <path
            d={previewPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={preferences.noteLinkWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* 拖入 JSON 文件时的高亮提示：始终挂载，用透明度做 150ms 过渡 */}
      <div
        className={[
          'pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-accent bg-accent-dim transition-opacity duration-150',
          dragActive ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-hidden={!dragActive}
      >
        <p className="glass-surface rounded-lg border border-subtle px-3 py-1.5 text-[12px] text-accent">
          松开以导入画布文件
        </p>
      </div>

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
