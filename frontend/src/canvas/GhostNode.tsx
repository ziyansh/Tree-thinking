import { memo, useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { ChevronRight } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { SuggestionGhostNode } from './ghosts'
import { bumpUiLayer } from '../lib/uiLayers'

/** 建议箭头：点击后在原地创建子卡片，ghost 随子节点出现而消失 */
function GhostNodeInner({
  id,
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<SuggestionGhostNode>) {
  const createBranch = useGraphStore((state) => state.createBranch)
  const [pending, setPending] = useState(false)

  // 新显示的候选方向置顶
  useEffect(() => {
    bumpUiLayer(id)
  }, [id])

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
        'group glass-surface relative flex min-h-[calc(44px*var(--card-font-scale))] w-max min-w-[calc(280px*var(--card-font-scale))] max-w-[calc(420px*var(--card-font-scale))] cursor-pointer items-center gap-[calc(6px*var(--card-font-scale))] rounded-lg border border-ghost-border px-[calc(10px*var(--card-font-scale))] py-[calc(8px*var(--card-font-scale))]',
        'transition-colors duration-150 hover:border-accent',
        pending ? 'pointer-events-none opacity-60' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="shrink-0 card-scale-10 leading-none text-muted/70">猜你想问</span>
      <p className="min-w-0 flex-1 whitespace-normal break-words card-scale-13 leading-[1.45] text-muted transition-colors duration-150 group-hover:text-ink">
        {data.text}
      </p>
      <ChevronRight size={12} className="card-scale-icon-sm shrink-0 text-muted/70" />
    </div>
  )
}

export const GhostNode = memo(GhostNodeInner)
