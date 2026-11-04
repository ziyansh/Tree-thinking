import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { BranchInputFlowNode } from './ghosts'

/** 分支输入条：位于父卡片正下方，Enter 提交后才创建真正的子卡片 */
function BranchInputNodeInner({ data }: NodeProps<BranchInputFlowNode>) {
  const submitBranchInput = useGraphStore((state) => state.submitBranchInput)
  const cancelBranchInput = useGraphStore((state) => state.cancelBranchInput)
  // 与全局卡片同宽；卡片缩放后输入条实时跟随
  const cardWidth = useGraphStore((state) => state.cardSize.width)

  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 按内容重算高度：只做显示层换行，不插入实际换行符
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft, cardWidth])

  const submit = async () => {
    const question = draft.trim()
    if (!question || pending) return
    setPending(true)
    try {
      await submitBranchInput(data.inputId, question)
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={[
        'relative flex min-h-[44px] items-start gap-1.5 rounded-lg border border-ghost-border bg-ghost-bg px-2.5 py-1',
        'transition-colors duration-150 focus-within:border-accent',
        pending ? 'pointer-events-none opacity-60' : '',
      ].join(' ')}
      style={{ width: cardWidth }}
    >
      <span className="shrink-0 pt-1 text-[10px] leading-none text-muted/70">请输入你的分支问题</span>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={draft}
        disabled={pending}
        placeholder="输入后按 Enter 提交"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
          // Esc 移除当前输入条，不创建卡片
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelBranchInput(data.inputId)
          }
        }}
        className="nodrag nowheel selectable-text min-w-0 flex-1 resize-none overflow-hidden bg-transparent leading-5 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
        style={{ fontSize: 'var(--card-font-size)' }}
      />
    </div>
  )
}

export const BranchInputNode = memo(BranchInputNodeInner)
