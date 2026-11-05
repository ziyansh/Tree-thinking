import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ImageViewerProps {
  src: string
  name: string
  onClose: () => void
}

/** 缩放倍数范围 */
const MIN_SCALE = 0.2
const MAX_SCALE = 5

/** 图片查看器：全屏遮罩，支持滚轮缩放、拖动平移与 Esc 关闭 */
export function ImageViewer({ src, name, onClose }: ImageViewerProps) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  /** 供原生 wheel 监听读取的最新变换 */
  const transformRef = useRef(transform)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  /** 当前拖动状态：起点坐标与起始平移量 */
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  /** 拖动距离超过阈值后抑制随后的遮罩点击关闭 */
  const movedRef = useRef(false)

  useEffect(() => {
    transformRef.current = transform
  }, [transform])

  // Esc 关闭：捕获阶段处理，避免被画布快捷键先接管
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  // 滚轮缩放：以指针位置为中心调整平移，保证指针下的画面不漂移
  useEffect(() => {
    const element = overlayRef.current
    if (!element) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = transformRef.current
      const rect = element.getBoundingClientRect()
      const px = event.clientX - (rect.left + rect.width / 2)
      const py = event.clientY - (rect.top + rect.height / 2)
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
      if (nextScale === current.scale) return
      const ratio = nextScale / current.scale
      setTransform({
        x: px - ratio * (px - current.x),
        y: py - ratio * (py - current.y),
        scale: nextScale,
      })
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  /** 左键或中键按下开始平移（按住空格时同样是左键拖动，无需特殊区分） */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    movedRef.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.hypot(dx, dy) > 4) movedRef.current = true
    setTransform((current) => ({ ...current, x: drag.originX + dx, y: drag.originY + dy }))
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // 只有点在图片外的遮罩上、且本次没有拖动时才关闭
    if (event.target !== event.currentTarget) return
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    onClose()
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
      style={{ touchAction: 'none' }}
      onClick={handleOverlayClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <img
        src={src}
        alt={name}
        draggable={false}
        className="max-h-[90vh] max-w-[90vw] cursor-grab select-none object-contain active:cursor-grabbing"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          touchAction: 'none',
        }}
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 max-w-[80vw] -translate-x-1/2 truncate rounded-full bg-black/50 px-3 py-1 text-[12px] text-white/80">
        {name} · {Math.round(transform.scale * 100)}%
      </div>
      <button
        type="button"
        title="关闭"
        aria-label="关闭"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 transition-colors duration-150 hover:bg-black/70 hover:text-white"
      >
        <X size={18} />
      </button>
    </div>,
    document.body,
  )
}
