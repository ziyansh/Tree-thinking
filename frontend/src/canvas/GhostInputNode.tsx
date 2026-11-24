import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  ClipboardEvent as ReactClipboardEvent,
  FocusEvent as ReactFocusEvent,
} from 'react'
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
import { composeWithUrls, mergeUrls, replaceUrl, splitUrls } from '../lib/urlChips'
import { absorbUrlPaste } from '../lib/useUrlChips'

/** 空链接列表：store 中未记录时复用，避免 selector 每次返回新数组 */
const EMPTY_URLS: string[] = []

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
  // 链接胶囊同样按父卡片保存在 store 中：链接从输入框抽离，提交时再拼回问题末尾
  const urls = useGraphStore((state) => state.ghostUrlChips[data.parentId] ?? EMPTY_URLS)
  const setGhostUrlChips = useGraphStore((state) => state.setGhostUrlChips)
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
    // 失焦时把草稿中已写完整的链接转成胶囊
    const result = splitUrls(draft)
    if (result.urls.length > 0) {
      setGhostDraft(data.parentId, result.text)
      setGhostUrlChips(data.parentId, mergeUrls(urls, result.urls))
    }
    // 输入框失焦：退出「聚焦输入」区段
    if (getFocusedInput() === id) setFocusedInput(null)
    setFocused(false)
    setActiveGhostInput(null)
  }

  /** 粘贴：文件交给附件处理，链接直接抽成胶囊，其余文本正常插入 */
  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (pasteAttachments(event)) return
    absorbUrlPaste(
      event,
      (next) => setGhostDraft(data.parentId, next),
      (found) => setGhostUrlChips(data.parentId, mergeUrls(urls, found)),
    )
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
    // 提交前兜底：把仍留在文本里的链接抽成胶囊，再按编号拼回问题末尾
    const result = splitUrls(draft)
    const merged = mergeUrls(urls, result.urls)
    const question = composeWithUrls(result.text, merged)
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
      setGhostUrlChips(data.parentId, [])
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
          ? 'min-h-[calc(120px*var(--card-font-scale))] w-[calc(460px*var(--card-font-scale))] flex-col gap-1.5 p-[calc(10px*var(--card-font-scale))]'
          : 'min-h-[calc(44px*var(--card-font-scale))] w-[calc(280px*var(--card-font-scale))] items-center gap-[calc(6px*var(--card-font-scale))] px-[calc(10px*var(--card-font-scale))] py-[calc(4px*var(--card-font-scale))]',
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
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="输入问题，继续你的思考方向"
            className={[
              'nodrag selectable-text min-h-[calc(60px*var(--card-font-scale))] w-full resize-none bg-transparent leading-[1.65] text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60',
              spacePressed ? '' : 'nowheel',
            ].join(' ')}
            style={{ fontSize: 'var(--card-font-size)' }}
          />
          <UrlChips
            urls={urls}
            onRemove={(url) =>
              setGhostUrlChips(
                data.parentId,
                urls.filter((item) => item !== url),
              )
            }
            onEdit={(oldUrl, nextUrl) =>
              setGhostUrlChips(
                data.parentId,
                replaceUrl(urls, oldUrl, nextUrl),
              )
            }
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
                  isStreaming ||
                  pending ||
                  attachments.uploading ||
                  (!draft.trim() && urls.length === 0)
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
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="输入问题，继续你的思考方向"
            className={[
              'nodrag h-[calc(20px*var(--card-font-scale))] min-w-0 flex-1 resize-none bg-transparent leading-[calc(20px*var(--card-font-scale))] text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60',
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
