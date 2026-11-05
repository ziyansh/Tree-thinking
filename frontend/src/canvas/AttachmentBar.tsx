import { useState } from 'react'
import { ChevronRight, Paperclip } from 'lucide-react'
import type { AttachmentDTO, NodeDTO } from '../api/types'
import { AttachmentChips } from './AttachmentComposer'
import { useSpacePressed } from '../lib/spaceKey'

interface AttachmentBarProps {
  node: NodeDTO
}

/** 卡片左上角的附件条（标题行之前）；附件较多时折叠为一个入口 */
export function AttachmentBar({ node }: AttachmentBarProps) {
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const spacePressed = useSpacePressed()
  const attachments = node.attachments
  if (attachments.length === 0) return null

  /** 所有附件统一在新窗口打开原始文件 */
  const open = (attachment: AttachmentDTO) =>
    window.open(attachment.url, '_blank', 'noreferrer')

  const expanded = pinned || hover

  return (
    <div
      className="nodrag relative mb-2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {attachments.length <= 3 ? (
        <AttachmentChips items={attachments} compact onOpen={open} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setPinned((value) => !value)}
            className="nodrag flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:text-ink"
          >
            <Paperclip size={12} />
            附件 {attachments.length}
            <ChevronRight size={12} className={expanded ? 'rotate-90' : ''} />
          </button>
          {expanded && (
            <div className={`nodrag ${spacePressed ? '' : 'nowheel'} absolute top-full left-0 z-30 mt-1 w-full rounded-xl border border-subtle bg-panel p-2 shadow-2xl`}>
              <AttachmentChips items={attachments} compact onOpen={open} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
