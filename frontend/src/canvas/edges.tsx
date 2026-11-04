import type { CSSProperties } from 'react'
import { BaseEdge } from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'

/** 卡片矩形（画布坐标） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 边外观：颜色与粗细来自设置，dashed 用于 ghost 虚线 */
export interface EdgeStyle {
  color: string
  width: number
  dashed?: boolean
}

/** 自定义边数据：Canvas 计算障碍列表与样式后透传 */
export type RouteEdgeData = {
  obstacles?: Rect[]
  style?: EdgeStyle
  /** 共用母线的纵向 x 坐标（同一父卡片的全部分支共用） */
  gutterX?: number
  [key: string]: unknown
}

type RouteEdge = Edge<RouteEdgeData>

interface Point {
  x: number
  y: number
}

/** 与卡片边界保持的绕行间距 */
const MARGIN = 32
/** 折线圆角半径 */
const CORNER_RADIUS = 8
/** 端点落在边界上不算进入矩形，用极小阈值做严格内外判断 */
const EPS = 0.5

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x > rect.x + EPS &&
    point.x < rect.x + rect.width - EPS &&
    point.y > rect.y + EPS &&
    point.y < rect.y + rect.height - EPS
  )
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** 两条线段严格相交：端点接触与共线重叠都返回 false，避免把贴边连线误判为穿过卡片 */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** 正交折线是否穿过卡片矩形（端点及贴边视为不穿过） */
export function pathIntersectsRect(points: Point[], rect: Rect): boolean {
  for (const point of points) {
    if (pointInRect(point, rect)) return true
  }

  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    for (let corner = 0; corner < 4; corner += 1) {
      const c = corners[corner]
      const d = corners[(corner + 1) % 4]
      if (segmentsCross(a, b, c, d)) return true
    }
  }

  return false
}

/** 返回当前路径会穿过的卡片矩形 */
function blockingRects(points: Point[], obstacles: Rect[]): Rect[] {
  return obstacles.filter((rect) => pathIntersectsRect(points, rect))
}

function polylineLength(points: Point[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return total
}

/** 生成带 8px 圆角的正交折线路径 */
export function orthogonalPath(points: Point[], radius = CORNER_RADIUS): string {
  // 去掉重复点，避免出现零长度线段
  const cleaned: Point[] = []
  for (const point of points) {
    const last = cleaned[cleaned.length - 1]
    if (last && Math.abs(last.x - point.x) < EPS && Math.abs(last.y - point.y) < EPS) continue
    cleaned.push(point)
  }
  if (cleaned.length < 2) return ''

  const round = (value: number) => Math.round(value * 10) / 10
  let d = `M ${round(cleaned[0].x)} ${round(cleaned[0].y)}`

  for (let index = 1; index < cleaned.length - 1; index += 1) {
    const prev = cleaned[index - 1]
    const current = cleaned[index]
    const next = cleaned[index + 1]
    // 共线的中间点不是拐角，直接跳过
    const collinear =
      (prev.x === current.x && current.x === next.x) ||
      (prev.y === current.y && current.y === next.y)
    if (collinear) continue

    const inLength = Math.hypot(current.x - prev.x, current.y - prev.y)
    const outLength = Math.hypot(next.x - current.x, next.y - current.y)
    const r = Math.min(radius, inLength / 2, outLength / 2)
    const inDir = { x: (current.x - prev.x) / inLength, y: (current.y - prev.y) / inLength }
    const outDir = { x: (next.x - current.x) / outLength, y: (next.y - current.y) / outLength }
    const before = { x: current.x - inDir.x * r, y: current.y - inDir.y * r }
    const after = { x: current.x + outDir.x * r, y: current.y + outDir.y * r }

    d += ` L ${round(before.x)} ${round(before.y)} Q ${round(current.x)} ${round(current.y)} ${round(after.x)} ${round(after.y)}`
  }

  const last = cleaned[cleaned.length - 1]
  return `${d} L ${round(last.x)} ${round(last.y)}`
}

/** 从上方或下方整体绕行：逐次抬高/降低横向折线，直到不再穿过任何卡片 */
function detourVertical(from: Point, to: Point, obstacles: Rect[], direction: -1 | 1): Point[] {
  const top = Math.min(from.y, to.y)
  const bottom = Math.max(from.y, to.y)
  let y = direction < 0 ? top - MARGIN : bottom + MARGIN
  let path: Point[] = [from, { x: from.x, y }, { x: to.x, y }, to]

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blockers = blockingRects(path, obstacles)
    if (blockers.length === 0) break
    const nextY =
      direction < 0
        ? Math.min(...blockers.map((rect) => rect.y)) - MARGIN
        : Math.max(...blockers.map((rect) => rect.y + rect.height)) + MARGIN
    // 已没有可让的空间时停止，避免死循环
    if (nextY === y) break
    y = nextY
    path = [from, { x: from.x, y }, { x: to.x, y }, to]
  }

  return path
}

/** 从左侧或右侧横向绕行：逐次外移竖直折线，直到不再穿过任何卡片 */
function detourSide(from: Point, to: Point, obstacles: Rect[], direction: -1 | 1): Point[] {
  const top = Math.min(from.y, to.y)
  const bottom = Math.max(from.y, to.y)
  // 只考虑纵向区间附近可能挡路的卡片，避免被远处卡片带到过远的位置
  const nearby = obstacles.filter(
    (rect) => rect.y < bottom + MARGIN && rect.y + rect.height > top - MARGIN,
  )

  const build = (x: number): Point[] => [from, { x, y: from.y }, { x, y: to.y }, to]

  let x = nearby.length === 0
    ? (direction < 0 ? from.x - MARGIN : from.x + MARGIN)
    : direction < 0
      ? Math.min(...nearby.map((rect) => rect.x)) - MARGIN
      : Math.max(...nearby.map((rect) => rect.x + rect.width)) + MARGIN
  let path = build(x)

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blockers = blockingRects(path, obstacles)
    if (blockers.length === 0) break
    const nextX =
      direction < 0
        ? Math.min(...blockers.map((rect) => rect.x)) - MARGIN
        : Math.max(...blockers.map((rect) => rect.x + rect.width)) + MARGIN
    if (nextX === x) break
    x = nextX
    path = build(x)
  }

  return path
}

/** 在候选路径中优先选不穿卡片的，其次选总长度更短的 */
function chooseRoute(candidates: Point[][], obstacles: Rect[]): Point[] {
  const valid = candidates.filter((points) => blockingRects(points, obstacles).length === 0)
  const pool = valid.length > 0 ? valid : candidates
  return pool.reduce((best, points) => (polylineLength(points) < polylineLength(best) ? points : best))
}

/** 从 data.style 读取外观，缺省时退回主题令牌，避免硬编码颜色 */
function visualStyle(data: RouteEdgeData | undefined): CSSProperties {
  const style: CSSProperties = {
    stroke: data?.style?.color ?? 'var(--edge)',
    strokeWidth: data?.style?.width ?? 1.5,
  }
  if (data?.style?.dashed) style.strokeDasharray = '4 4'
  return style
}

/** 主链边：父卡片右侧中点 → 子卡片左侧中点，被遮挡时从上方或下方绕行 */
export function MainEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<RouteEdge>) {
  const from = { x: sourceX, y: sourceY }
  const to = { x: targetX, y: targetY }
  const obstacles = data?.obstacles ?? []

  // 子卡片在右侧时走两段折线（竖直段在中间），否则从父卡片右侧先拉出固定间距
  const midX = to.x > from.x ? from.x + (to.x - from.x) / 2 : from.x + MARGIN * 2
  const base = [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]
  // 优先直线折线；若穿过任意卡片（包括无关卡片），从上方或下方整体绕行
  const points = chooseRoute(
    [
      base,
      detourVertical(from, to, obstacles, -1),
      detourVertical(from, to, obstacles, 1),
    ],
    obstacles,
  )

  return <BaseEdge path={orthogonalPath(points)} style={visualStyle(data)} />
}

/** 直接分支边：父子卡片上/下边中点相连，横向错位或被遮挡时横向偏移绕行 */
export function DirectEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<RouteEdge>) {
  const from = { x: sourceX, y: sourceY }
  const to = { x: targetX, y: targetY }
  const obstacles = data?.obstacles ?? []

  const midY = from.y + (to.y - from.y) / 2
  // 上下边中点水平对齐时是直线，否则走「横—竖—横」的正交折线
  const aligned = Math.abs(from.x - to.x) < 1
  const base = aligned
    ? [from, to]
    : [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]
  const points =
    blockingRects(base, obstacles).length === 0
      ? base
      : chooseRoute(
          [
            detourSide(from, to, obstacles, -1),
            detourSide(from, to, obstacles, 1),
            // 侧向绕行仍被卡住时，再从上方/下方整体绕行
            detourVertical(from, to, obstacles, -1),
            detourVertical(from, to, obstacles, 1),
          ],
          obstacles,
        )

  return <BaseEdge path={orthogonalPath(points)} style={visualStyle(data)} />
}

/** 共用母线边：父卡片右边 → 水平引线 → 纵向母线 → 子卡片左边，母线被遮挡时右移 */
export function BusEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<RouteEdge>) {
  const from = { x: sourceX, y: sourceY }
  const to = { x: targetX, y: targetY }
  const obstacles = data?.obstacles ?? []

  const gutterX = data?.gutterX ?? from.x + 160
  const build = (x: number): Point[] => [
    from,
    { x, y: from.y },
    { x, y: to.y },
    to,
  ]

  // 母线 x 由父卡片统一给出，所有兄弟分支共用同一根竖线；
  // 只有实际穿过卡片时才整体绕行，避免不同分支各自移动母线
  const points = build(gutterX)
  const routed = chooseRoute(
    [
      points,
      detourVertical(from, to, obstacles, -1),
      detourVertical(from, to, obstacles, 1),
    ],
    obstacles,
  )

  return <BaseEdge path={orthogonalPath(routed)} style={visualStyle(data)} />
}
