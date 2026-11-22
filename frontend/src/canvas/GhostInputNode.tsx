import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { Paperclip, Send } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { InputGhostNode } from './ghosts'
import { AttachmentChips, ArkCapabilityWarning, PdfPageWarning, openAttachment, useAttachmentUploads, usePasteAttachments, useFileDropZone } from './AttachmentComposer'
import { WebSearchToggle } from './WebSearchToggle'
import { ThinkingToggle } from './ThinkingToggle'
import { useSpacePressed } from '../lib/spaceKey'
import { setActiveGhostInput, useActiveGhostInput } from '../lib/ghostInputFocus'
import { bumpUiLayer, getFocusedInput, setFocusedInput } from '../lib/uiLayers'
import { UrlChips } from './UrlChips'
import { removeUrl } from '../lib/urlChips'

/**
 * 自定义方向输入箭头：收起时为单行输入，聚焦后展开为多行输入 + 附件区，
 * 提交后清空文本与附件但保留自身，可反复新增子分支。
 */
function GhostInputNodeInner({
  id,
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<InputGhostNode>) {
  const createBranch = useGraphStore((state) => state.createBranch)
  const isStreaming = useGraphStore((state) => state.isStreamingIds.length > 0)
  // 哪一个自定义输入框当前持有焦点：切换到另一个时收起当前输入框
  const activeInputId = useActiveGhostInput()

  const [focused, setFocused] = useState(() => Boolean(data.autoOpen))
  // 草稿按父卡片保存在 store 中：不同卡片的内容各自独立、收起后仍然保留
  const draft = useGraphStore((state) => state.ghostDrafts[data.parentId] ?? '')
  const setGhostDraft = useGraphStore((state) => state.setGhostDraft)
  // 火山方舟能力提示：当前模型与账号可见模型列表
  const arkModel = useGraphStore((state) => state.arkModel)
  const arkModels = useGraphStore((state) => state.arkModels)
  const [pending, setPending] = useState(false)
  const attachments = useAttachmentUploads()
  const pasteAttachments = usePasteAttachments(attachments)
  const spacePressed = useSpacePressed()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const addFiles = async (files: File[]) => {
    // 拖拽投放不会触发 focus，主动展开以显示附件条
    setFocused(true)
    await attachments.addFiles(files)
  }

  const dropZone = useFileDropZone((files) => void addFiles(files))

  // 新显示的自定义输入置顶；展开（获焦）时再次置顶
  useEffect(() => {
    bumpUiLayer(id)
  }, [id])

  /** 失焦判定（docs/lose_focus.md）：焦点移出整个容器后收起为单行，内容保留 */
  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    // 输入框失焦：退出「聚焦输入」区段
    if (getFocusedInput() === id) setFocusedInput(null)
    setFocused(false)
    setActiveGhostInput(null)
  }

  // 卸载时若仍记录为本输入框，清理聚焦状态
  useEffect(
    () => () => {
      if (getFocusedInput() === id) setFocusedInput(null)
    },
    [id],
  )

  // 展开态下只有选中卡片发生非空变化才收起（点击空白画布不收起）
  useEffect(() => {
    if (!focused) return
    return useGraphStore.subscribe((state, prev) => {
      if (state.selectedNodeId !== prev.selectedNodeId && state.selectedNodeId !== null) {
        setFocused(false)
        if (getFocusedInput() === id) setFocusedInput(null)
      }
    })
  }, [focused, id])

  // 切换到另一个自定义输入框也算切换焦点：立即收起当前输入框
  useEffect(() => {
    if (activeInputId !== null && activeInputId !== id) {
      setFocused(false)
      if (getFocusedInput() === id) setFocusedInput(null)
    }
  }, [activeInputId, id])

  /** 上一次的 autoOpen：只在 false → true（含首次挂载）时自动展开并聚焦 */
  const prevAutoOpenRef = useRef(false)
  useEffect(() => {
    const autoOpen = Boolean(data.autoOpen)
    if (!autoOpen || prevAutoOpenRef.current) return
    prevAutoOpenRef.current = true
    setFocused(true)
    setActiveGhostInput(id)
    bumpUiLayer(id)
    // 首次挂载时把预填内容写入草稿（stopGeneration 已经写入时不会覆盖）
    if (data.initialQuestion && !draft) setGhostDraft(data.parentId, data.initialQuestion)
    textareaRef.current?.focus()
  }, [data.autoOpen, data.initialQuestion, data.parentId, draft, id, setGhostDraft])

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
      setGhostDraft(data.parentId, '')
      attachments.clear()
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      onFocus={() => {
        setActiveGhostInput(id)
        // 获得焦点：进入「聚焦输入」区段，压在笔记卡片之上
        setFocusedInput(id)
        bumpUiLayer(id)
        setFocused(true)
      }}
      onBlur={handleBlur}
      onDragOver={dropZone.onDragOver}
      onDragLeave={dropZone.onDragLeave}
      onDrop={dropZone.onDrop}
      className={[
        'glass-surface relative flex rounded-lg border transition-[width,min-height,border-color,background-color] duration-200 ease-out',
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
        <div className="tab-panel-in flex min-h-0 flex-1 flex-col gap-1.5">
          <span className="shrink-0 card-scale-11 leading-none text-muted/70">自定义方向</span>
          <textarea
            ref={textareaRef}
            rows={3}
            value={draft}
            disabled={isStreaming || pending}
            onChange={(event) => setGhostDraft(data.parentId, event.target.value)}
            onPaste={pasteAttachments}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="输入问题，继续你的思考方向"
            className={[
              'nodrag selectable-text min-h-[60px] w-full resize-none bg-transparent leading-[1.65] text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60',
              spacePressed ? '' : 'nowheel',
            ].join(' ')}
            style={{ fontSize: 'var(--card-font-size)' }}
          />
          <UrlChips
            text={draft}
            onRemove={(url) => setGhostDraft(data.parentId, removeUrl(draft, url))}
          />
          {attachments.items.length > 0 && (
            <div className="mt-1">
              <AttachmentChips
                items={attachments.items}
                onRemove={attachments.remove}
                onOpen={openAttachment}
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
                onClick={() => fileInputRef.current?.click()}
                className="nodrag flex h-[calc(28px*var(--card-font-scale))] w-[calc(28px*var(--card-font-scale))] items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
              >
                <Paperclip size={13} className="card-scale-icon" />
              </button>
              {attachments.uploading && <span className="card-scale-11 text-muted">上传中…</span>}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="nodrag hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void addFiles(files)
                }}
              />
              <ThinkingToggle />
              <WebSearchToggle />
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <PdfPageWarning items={attachments.items} />
              <ArkCapabilityWarning
                items={attachments.items}
                model={arkModel}
                models={arkModels}
              />
              <button
                type="button"
                title="发送"
                aria-label="发送"
                disabled={
                  isStreaming || pending || attachments.uploading || !draft.trim()
                }
                onClick={() => void submit()}
                className="nodrag flex h-[calc(32px*var(--card-font-scale))] w-[calc(32px*var(--card-font-scale))] shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={14} className="card-scale-icon" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <span className="shrink-0 card-scale-11 leading-none text-muted/70">自定义方向</span>
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            disabled={isStreaming || pending}
            onChange={(event) => setGhostDraft(data.parentId, event.target.value)}
            onPaste={pasteAttachments}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="输入问题，继续你的思考方向"
            className={[
              'nodrag h-5 min-w-0 flex-1 resize-none bg-transparent leading-5 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60',
              spacePressed ? '' : 'nowheel',
            ].join(' ')}
            style={{ fontSize: 'var(--card-font-size)' }}
          />
        </>
      )}
    </div>
  )
}

export const GhostInputNode = memo(GhostInputNodeInner)
