import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Paperclip, Send } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { BranchInputFlowNode } from './ghosts'
import { useSpacePressed } from '../lib/spaceKey'
import { bumpUiLayer, dropUiLayer, getFocusedInput, setFocusedInput } from '../lib/uiLayers'
import {
  AttachmentChips,
  useAttachmentUploads,
  useFileDropZone,
  usePasteAttachments,
} from './AttachmentComposer'
import { ThinkingToggle } from './ThinkingToggle'
import { WebSearchToggle } from './WebSearchToggle'

/** 失焦收起的动画时长，与 theme.css 的 composer-out 保持一致 */
const CLOSE_ANIM_MS = 160

/**
 * 分支输入条：位于父卡片正下方，样式与「自定义方向」一致（多行输入 + 附件 + 开关）。
 * 失焦（focusout / 切窗口）后播放收起动画再移除；Enter 提交。
 */
function BranchInputNodeInner({ data }: NodeProps<BranchInputFlowNode>) {
  const submitBranchInput = useGraphStore((state) => state.submitBranchInput)
  const cancelBranchInput = useGraphStore((state) => state.cancelBranchInput)
  // 草稿按父卡片保存在 store 中：切换输入条后再打开，各自的内容仍然保留
  const draft = useGraphStore((state) => state.branchDrafts[data.parentId] ?? '')
  const setBranchDraft = useGraphStore((state) => state.setBranchDraft)
  // 与全局卡片同宽；卡片缩放后输入条实时跟随
  const cardWidth = useGraphStore((state) => state.cardSize.width)
  // 按住空格时滚轮交给画布缩放
  const spacePressed = useSpacePressed()

  const [pending, setPending] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** 失焦回调里读取最新草稿，避免绑定过期闭包 */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const attachments = useAttachmentUploads()
  const pasteAttachments = usePasteAttachments(attachments)
  const dropZone = useFileDropZone((files) => void attachments.addFiles(files))

  /** 带收起动画地移除输入条 */
  const closeWithAnimation = useCallback(() => {
    if (closing) return
    // 输入条即将消失：同步退出「聚焦输入」区段
    if (getFocusedInput() === data.inputId) setFocusedInput(null)
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      cancelBranchInput(data.inputId)
    }, CLOSE_ANIM_MS)
  }, [closing, cancelBranchInput, data.inputId])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  // 失焦判定（docs/lose_focus.md）：焦点移到容器外、切窗口、打开弹窗都会触发；
  // 已输入内容时保留输入条，避免误点画布丢失草稿
  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    // 焦点已离开容器：退出「聚焦输入」区段（是否保留输入条另按草稿判断）
    if (getFocusedInput() === data.inputId) setFocusedInput(null)
    if (draftRef.current.trim()) return
    closeWithAnimation()
  }

  useEffect(() => {
    const onWindowBlur = () => {
      if (draftRef.current.trim()) return
      closeWithAnimation()
    }
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [closeWithAnimation])

  // 新显示的分支输入条置顶（层级高于卡片与猜你想问）
  useEffect(() => {
    bumpUiLayer(data.inputId)
    return () => {
      dropUiLayer(data.inputId)
      // 卸载时若仍记录为本输入条，清理聚焦状态
      if (getFocusedInput() === data.inputId) setFocusedInput(null)
    }
  }, [data.inputId])

  // 按内容重算高度：只做显示层换行，不插入实际换行符
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.max(60, element.scrollHeight)}px`
  }, [draft, cardWidth])

  const submit = async () => {
    const question = draft.trim()
    if (!question || pending) return
    setPending(true)
    try {
      await submitBranchInput(
        data.inputId,
        question,
        attachments.items.map((item) => item.id),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      onFocus={() => {
        // 获得焦点：进入「聚焦输入」区段，压在笔记卡片之上
        setFocusedInput(data.inputId)
        bumpUiLayer(data.inputId)
      }}
      onBlur={handleBlur}
      onDragOver={dropZone.onDragOver}
      onDragLeave={dropZone.onDragLeave}
      onDrop={dropZone.onDrop}
      className={[
        'glass-surface relative flex flex-col gap-1.5 rounded-lg border p-2.5 transition-colors duration-150',
        closing ? 'composer-out' : '',
        dropZone.dragOver
          ? 'border-accent bg-accent-dim'
          : 'border-ghost-border focus-within:border-accent',
        pending ? 'pointer-events-none opacity-60' : '',
      ].join(' ')}
      style={{ width: cardWidth }}
    >
      <span className="shrink-0 text-[10px] leading-none text-muted/70">分支问题</span>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={2}
        value={draft}
        disabled={pending}
        placeholder="输入问题，继续你的思考方向"
        onChange={(event) => setBranchDraft(data.parentId, event.target.value)}
        onPaste={pasteAttachments}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
          // Esc 移除当前输入条，不创建卡片
          if (event.key === 'Escape') {
            event.preventDefault()
            closeWithAnimation()
          }
        }}
        className={[
          'nodrag selectable-text min-h-[60px] w-full resize-none bg-transparent text-[13px] leading-5 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60',
          spacePressed ? '' : 'nowheel',
        ].join(' ')}
      />

      {attachments.items.length > 0 && (
        <AttachmentChips items={attachments.items} onRemove={attachments.remove} compact />
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="添加附件"
            aria-label="添加附件"
            onClick={() => fileInputRef.current?.click()}
            className="nodrag flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
          >
            <Paperclip size={13} />
          </button>
          {attachments.uploading && <span className="text-[11px] text-muted">上传中…</span>}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="nodrag hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void attachments.addFiles(files)
            }}
          />
          <ThinkingToggle />
          <WebSearchToggle />
        </div>
        <button
          type="button"
          title="发送"
          aria-label="发送"
          disabled={pending || attachments.uploading || !draft.trim()}
          onClick={() => void submit()}
          className="nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

export const BranchInputNode = memo(BranchInputNodeInner)
