import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { Paperclip, Send } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { InputGhostNode } from './ghosts'
import { AttachmentChips, useAttachmentUploads, useFileDropZone } from './AttachmentComposer'

/**
 * 自定义方向输入箭头：收起时为单行输入，聚焦后展开为多行输入 + 附件区，
 * 提交后清空文本与附件但保留自身，可反复新增子分支。
 */
function GhostInputNodeInner({
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<InputGhostNode>) {
  const createBranch = useGraphStore((state) => state.createBranch)
  const isStreaming = useGraphStore((state) => state.isStreamingIds.length > 0)

  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const attachments = useAttachmentUploads()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** 正在打开系统文件选择框：期间失焦不收起输入框 */
  const pickingRef = useRef(false)

  const addFiles = async (files: File[]) => {
    // 拖拽投放不会触发 focus，主动展开以显示附件条
    setFocused(true)
    await attachments.addFiles(files)
    // 文件选择框关闭后组件可能已因失焦收起，上传完成后再展开一次
    setFocused(true)
  }

  const dropZone = useFileDropZone((files) => void addFiles(files))

  // 系统文件选择框关闭时窗口重新获得焦点，解除「选择中」标记
  useEffect(() => {
    const resetPicking = () => {
      pickingRef.current = false
    }
    window.addEventListener('focus', resetPicking)
    return () => window.removeEventListener('focus', resetPicking)
  }, [])

  // 展开态按内容自动增高，至少保持 3 行（60px）；收起态恢复单行高度
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    if (!focused) {
      element.style.height = ''
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.max(60, element.scrollHeight)}px`
  }, [draft, focused])

  const submit = async () => {
    const question = draft.trim()
    if (!question || pending || isStreaming || attachments.uploading) return
    setPending(true)
    try {
      await createBranch(data.parentId, {
        origin: 'user',
        question,
        attachmentIds: attachments.items.map((item) => item.id),
        x: positionAbsoluteX,
        y: positionAbsoluteY,
      })
      setDraft('')
      attachments.clear()
    } finally {
      setPending(false)
    }
  }

  /** 失焦时若输入为空且没有附件，则收回单行态；焦点仍在容器内时不收起 */
  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    // 文件选择框打开期间不收起
    if (pickingRef.current) return
    if (draft.trim() || attachments.items.length > 0 || attachments.uploading || pending) return
    setFocused(false)
  }

  return (
    <div
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
      onDragOver={dropZone.onDragOver}
      onDragLeave={dropZone.onDragLeave}
      onDrop={dropZone.onDrop}
      className={[
        'relative flex rounded-lg border bg-ghost-bg transition-colors duration-150',
        focused
          ? 'min-h-[120px] w-[460px] flex-col gap-1.5 p-2.5'
          : 'min-h-[44px] w-[280px] items-center gap-1.5 px-2.5 py-1',
        dropZone.dragOver
          ? 'border-accent bg-accent-dim'
          : focused
            ? 'border-accent'
            : 'border-ghost-border hover:border-accent',
        pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {focused ? (
        <>
          <span className="shrink-0 text-[10px] leading-none text-muted/70">自定义方向</span>
          <textarea
            ref={textareaRef}
            rows={3}
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
            className="nodrag nowheel selectable-text min-h-[60px] w-full resize-none bg-transparent text-[13px] leading-5 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
          />
          {attachments.items.length > 0 && (
            <div className="mt-1">
              <AttachmentChips
                items={attachments.items}
                onRemove={attachments.remove}
                compact
              />
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="添加附件"
                aria-label="添加附件"
                onClick={() => {
                  pickingRef.current = true
                  fileInputRef.current?.click()
                }}
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
                  pickingRef.current = false
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void addFiles(files)
                }}
              />
            </div>
            <button
              type="button"
              title="发送"
              aria-label="发送"
              disabled={
                isStreaming || pending || attachments.uploading || !draft.trim()
              }
              onClick={() => void submit()}
              className="nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="shrink-0 text-[10px] leading-none text-muted/70">自定义方向</span>
          <textarea
            ref={textareaRef}
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
        </>
      )}
    </div>
  )
}

export const GhostInputNode = memo(GhostInputNodeInner)
