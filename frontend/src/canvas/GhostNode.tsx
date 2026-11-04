import { memo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { ChevronRight } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { SuggestionGhostNode } from './ghosts'

/** 建议箭头：点击后在原地创建子卡片，ghost 随子节点出现而消失 */
function GhostNodeInner({
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<SuggestionGhostNode>) {
  const createBranch = useGraphStore((state) => state.createBranch)
  const [pending, setPending] = useState(false)

  const handleClick = async () => {
    // 防止连点重复创建
    if (pending) return
    setPending(true)
    try {
      await createBranch(data.parentId, {
        origin: 'suggestion',
        question: data.text,
        suggestionId: data.suggestionId,
        x: positionAbsoluteX,
        y: positionAbsoluteY,
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      onClick={() => void handleClick()}
      className={[
        'group relative flex min-h-[44px] w-[280px] cursor-pointer items-center gap-1.5 rounded-lg border border-ghost-border bg-ghost-bg px-2.5 py-1',
        'transition-colors duration-150 hover:border-accent',
        pending ? 'pointer-events-none opacity-60' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="shrink-0 text-[10px] leading-none text-muted/70">猜你想问</span>
      <p className="min-w-0 flex-1 truncate text-[13px] leading-none text-muted transition-colors duration-150 group-hover:text-ink">
        {data.text}
      </p>
      <ChevronRight size={12} className="shrink-0 text-muted/70" />
    </div>
  )
}

export const GhostNode = memo(GhostNodeInner)
