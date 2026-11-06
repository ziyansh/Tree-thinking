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
import { Globe, LayoutGrid, Maximize, Minus, Plus } from 'lucide-react'
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
import { useSpacePressed } from '../lib/spaceKey'

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

/** 点状画布的网格步长（px），Shift 平移吸附与背景点阵一致 */
const CANVAS_DOT_GAP = 24

/**
 * 以 60Hz 上限调度一次回调：高刷新率屏幕会跳过多余的帧，
 * 避免同一份状态在一帧内被重复写回。
 */
function scheduleAt60(
  callback: () => void,
  frameRef: { current: number | null },
  lastAtRef: { current: number },
): void {
  frameRef.current = window.requestAnimationFrame(() => {
    const now = performance.now()
    if (now - lastAtRef.current < 16) {
      scheduleAt60(callback, frameRef, lastAtRef)
      return
    }
    lastAtRef.current = now
    frameRef.current = null
    callback()
  })
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
  const updatePreferences = useGraphStore((state) => state.updatePreferences)
  const dotColor = useDotColor()

  const { fitView, setViewport, getViewport, screenToFlowPosition } = useReactFlow()
  const fittedProjectRef = useRef<string | null>(null)
  const viewportTimerRef = useRef<number | null>(null)
  /** 空格是否按下：由全局 spaceKey 提供，卡片滚轮逻辑也共用同一状态 */
  const spacePressed = useSpacePressed()
  /** 是否正在自定义平移：用于切换抓取光标 */
  const [isPanning, setIsPanning] = useState(false)
  /** 自动整理插值中：给节点加合成层提示，减少逐帧重绘 */
  const [layoutAnimating, setLayoutAnimating] = useState(false)
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
  /** 上一次拖动写回的时间：把更新频率限制在 60Hz */
  const dragFrameAtRef = useRef(0)
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

  // 空格按住时左键可平移（由 capture 逻辑接管）；平时只有中键平移，左键空白用于拖动/点击判定

  /** 系统减弱动态时禁用惯性滑行与自动整理插值 */
  const prefersReducedMotion = useCallback(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

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
  const ghosts = useMemo(
    () => buildGhostNodes(nodes, cardSize, preferences.cardGap),
    [nodes, cardSize, preferences.cardGap],
  )
  // 分支输入条同样跟随父卡片移动，堆叠在卡片下方
  const branchInputNodes = useMemo(
    () => buildBranchInputNodes(branchInputs, nodes, cardSize, preferences.cardGap),
    [branchInputs, nodes, cardSize, preferences.cardGap],
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

    return result
  }, [nodes, ghosts, preferences])

  // 拖拽开始：确定本次要移动的集合（自身子树或多选集合的子树），记录初始坐标
  const handleNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
    // ghost 与分支输入条不可拖动；聊天卡片与笔记都参与拖动同步
    if (node.type !== 'card' && node.type !== 'note') return
    // 用户接管：停止自动整理插值与平移惯性
    layoutCanceledRef.current = true
    stopInertia()
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
    dragPendingRef.current = null
    dragFrameAtRef.current = 0
  }, [stopInertia])

  /** 把待处理的拖动偏移写回 store；调用频率由 scheduleAt60 控制 */
  const applyDragOffset = useCallback(() => {
    dragFrameRef.current = null
    const origin = dragOriginRef.current
    const offset = dragPendingRef.current
    if (!origin || !offset) return
    useGraphStore.setState((state) => ({
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
    if (dragFrameRef.current === null) {
      scheduleAt60(() => applyDragOffset(), dragFrameRef, dragFrameAtRef)
    }
  }, [applyDragOffset])

  // 松手后批量保存本次移动的所有节点坐标
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: Node) => {
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

  // 联网搜索仅 DeepSeek 服务商支持；失败时 store 会回滚，这里只告警
  const webSearchDisabled = preferences.provider !== 'deepseek'
  const toggleWebSearch = useCallback(async () => {
    if (webSearchDisabled) return
    try {
      await updatePreferences({ webSearchEnabled: !preferences.webSearchEnabled })
    } catch (err) {
      console.warn('切换联网搜索失败', err)
    }
  }, [preferences.webSearchEnabled, updatePreferences, webSearchDisabled])

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
      if (inertiaRef.current !== null) window.cancelAnimationFrame(inertiaRef.current)
      if (layoutAnimationRef.current !== null) window.cancelAnimationFrame(layoutAnimationRef.current)
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current)
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
      // 滚轮缩放前立即停止平移惯性，避免缩放和滑行同时进行
      onWheelCapture={stopInertia}
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
        // 空格按住时卡片不可拖动，左键拖动改为平移画布
        nodesDraggable={!spacePressed}
        // 中键平移由 React Flow 负责；空格左键平移由上面的 capture 逻辑完成
        panOnDrag={[1]}
        // 删除键由 App 的全局快捷键统一处理，关闭库内部删除避免与 store 不一致
        deleteKeyCode={null}
        onNodeClick={(event, node) => {
          // ghost 与分支输入条不可选中；聊天卡片与笔记都参与选中
          if (node.type !== 'card' && node.type !== 'note') return
          // 拖拽松手后浏览器仍可能补发 click，此时保持原来的多选集合
          if (performance.now() - lastDragEndRef.current < 100) return
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
        {/* 画布样式：无 = 纯色背景；点状 = 规律点阵 */}
        {preferences.canvasStyle === 'dots' && (
          <Background gap={CANVAS_DOT_GAP} color={dotColor} size={1.5} />
        )}
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAutoLayout()}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-subtle bg-panel px-2.5 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
            >
              <LayoutGrid size={12} />
              自动重排
            </button>
            <button
              type="button"
              title={webSearchDisabled ? '仅 DeepSeek 服务商支持联网搜索' : '联网搜索'}
              aria-disabled={webSearchDisabled}
              onClick={() => void toggleWebSearch()}
              className={[
                'flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors duration-150',
                webSearchDisabled
                  ? 'cursor-not-allowed border-subtle bg-panel text-muted opacity-40'
                  : preferences.webSearchEnabled
                    ? 'border-accent bg-accent-dim text-accent'
                    : 'border-subtle bg-panel text-muted hover:text-ink',
              ].join(' ')}
            >
              <Globe size={12} />
              联网搜索
            </button>
          </div>
        </Panel>
        {selectedNodeIds.length > 1 && (
          <Panel position="top-center">
            <div className="panel-pop flex items-center gap-2 rounded-lg border border-subtle bg-panel px-3 py-1.5">
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
