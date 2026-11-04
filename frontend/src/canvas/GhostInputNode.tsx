import { memo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { InputGhostNode } from './ghosts'

/** 输入箭头：内嵌单行输入框，提交后清空文本但保留自身，可反复新增子分支 */
function GhostInputNodeInner({
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<InputGhostNode>) {
  const createBranch = useGraphStore((state) => state.createBranch)
  const isStreaming = useGraphStore((state) => state.isStreamingIds.length > 0)

  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)

  const submit = async () => {
    const question = draft.trim()
    if (!question || pending || isStreaming) return
    setPending(true)
    try {
      await createBranch(data.parentId, {
        origin: 'user',
        question,
        x: positionAbsoluteX,
        y: positionAbsoluteY,
      })
      setDraft('')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="relative flex min-h-[44px] w-[280px] items-center gap-1.5 rounded-lg border border-ghost-border bg-ghost-bg px-2.5 py-1 transition-colors duration-150 focus-within:border-accent">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="shrink-0 text-[10px] leading-none text-muted/70">自定义方向</span>
      <textarea
        rows={1}
        value={draft}
        disabled={isStreaming || pending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder="输入问题，继续你的思考方向"
        className="nodrag h-5 min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-5 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  )
}

export const GhostInputNode = memo(GhostInputNodeInner)
