import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Paperclip } from 'lucide-react'
import type { NodeDTO } from '../api/types'
import { AttachmentChips, openAttachment } from './AttachmentComposer'
import { useSpacePressed } from '../lib/spaceKey'

interface AttachmentBarProps {
  node: NodeDTO
}

/** 卡片左上角的附件条（标题行之前）；附件较多时折叠为一个入口 */
export function AttachmentBar({ node }: AttachmentBarProps) {
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  // 悬停收起带延迟：指针从入口移到浮层时不会先触发 mouseleave 而消失
  const hoverTimerRef = useRef<number | null>(null)
  const spacePressed = useSpacePressed()
  const attachments = node.attachments

  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
    },
    [],
  )

  if (attachments.length === 0) return null

  const showHover = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHover(true)
  }

  const hideHover = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null
      setHover(false)
    }, 180)
  }

  const expanded = pinned || hover

  return (
    <div
      className="nodrag relative mb-2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {attachments.length <= 3 ? (
        <AttachmentChips items={attachments} compact onOpen={openAttachment} />
      ) : (
        <>
          <button
            type="button"
            // 悬停判定只覆盖「附件 N」入口本身，不再覆盖整行空白区域
            onMouseEnter={showHover}
            onMouseLeave={hideHover}
            onClick={() => setPinned((value) => !value)}
            className="nodrag flex w-fit items-center gap-1 rounded-md px-1 py-0.5 card-scale-11 text-muted transition-colors duration-150 hover:text-ink"
          >
            <Paperclip size={12} className="card-scale-icon-sm" />
            附件 {attachments.length}
            <ChevronRight
              size={12}
              className={`card-scale-icon-sm transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
          {expanded && (
            // 外层 pt-1 作为悬停桥接，避免入口与浮层之间出现鼠标无法停留的空隙
            <div
              className="absolute top-full left-0 z-30 w-full pt-1"
              onMouseEnter={showHover}
              onMouseLeave={hideHover}
            >
              <div
                className={`glass-surface nodrag ${spacePressed ? '' : 'nowheel'} rounded-xl border border-subtle p-2 shadow-2xl`}
              >
                <AttachmentChips items={attachments} compact onOpen={openAttachment} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
