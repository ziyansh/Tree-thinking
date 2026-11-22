import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FocusEvent as ReactFocusEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Paperclip, Send } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { BranchInputFlowNode } from './ghosts'
import { useSpacePressed } from '../lib/spaceKey'
import { bumpUiLayer, dropUiLayer, getFocusedInput, setFocusedInput } from '../lib/uiLayers'
import {
  ArkCapabilityWarning,
  AttachmentChips,
  PdfPageWarning,
  openAttachment,
  useAttachmentUploads,
  useFileDropZone,
  usePasteAttachments,
} from './AttachmentComposer'
import { ThinkingToggle } from './ThinkingToggle'
import { WebSearchToggle } from './WebSearchToggle'
import { UrlChips } from './UrlChips'
import { composeWithUrls, mergeUrls, replaceUrl, splitUrls } from '../lib/urlChips'
import { absorbUrlPaste } from '../lib/useUrlChips'

/** 空链接列表：store 中未记录时复用，避免 selector 每次返回新数组 */
const EMPTY_URLS: string[] = []

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
  // 链接胶囊同样按父卡片保存在 store 中：链接从输入框抽离，提交时再拼回问题末尾
  const urls = useGraphStore((state) => state.branchUrlChips[data.parentId] ?? EMPTY_URLS)
  const setBranchUrlChips = useGraphStore((state) => state.setBranchUrlChips)
  // 与全局卡片同宽；卡片缩放后输入条实时跟随
  const cardWidth = useGraphStore((state) => state.cardSize.width)
  // 火山方舟能力提示：当前模型与账号可见模型列表
  const arkModel = useGraphStore((state) => state.arkModel)
  const arkModels = useGraphStore((state) => state.arkModels)
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
  /** 失焦回调里读取最新链接胶囊，只有链接时也要保留输入条 */
  const urlsRef = useRef(urls)
  urlsRef.current = urls
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
  // 已输入内容或已有链接胶囊时保留输入条，避免误点画布丢失草稿
  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    // 焦点已离开容器：退出「聚焦输入」区段（是否保留输入条另按草稿判断）
    if (getFocusedInput() === data.inputId) setFocusedInput(null)
    // 失焦时把草稿中已写完整的链接转成胶囊
    const result = splitUrls(draftRef.current)
    if (result.urls.length > 0) {
      setBranchDraft(data.parentId, result.text)
      setBranchUrlChips(data.parentId, mergeUrls(urlsRef.current, result.urls))
    }
    if (result.text.trim() || result.urls.length > 0 || urlsRef.current.length > 0) return
    closeWithAnimation()
  }

  useEffect(() => {
    const onWindowBlur = () => {
      if (draftRef.current.trim() || urlsRef.current.length > 0) return
      closeWithAnimation()
    }
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [closeWithAnimation])

  /** 粘贴：文件交给附件处理，链接直接抽成胶囊，其余文本正常插入 */
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (pasteAttachments(event)) return
    absorbUrlPaste(
      event,
      (next) => setBranchDraft(data.parentId, next),
      (found) => setBranchUrlChips(data.parentId, mergeUrls(urls, found)),
    )
  }

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
    // 提交前兜底：把仍留在文本里的链接抽成胶囊，再按编号拼回问题末尾
    const result = splitUrls(draft)
    const merged = mergeUrls(urls, result.urls)
    const question = composeWithUrls(result.text, merged)
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
      <span className="shrink-0 card-scale-11 leading-none text-muted/70">分支问题</span>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={2}
        value={draft}
        disabled={pending}
        placeholder="输入问题，继续你的思考方向"
        onChange={(event) => setBranchDraft(data.parentId, event.target.value)}
        onPaste={handlePaste}
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
          'nodrag selectable-text min-h-[60px] w-full resize-none bg-transparent leading-[1.65] text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60',
          spacePressed ? '' : 'nowheel',
        ].join(' ')}
        style={{ fontSize: 'var(--card-font-size)' }}
      />

      <UrlChips
        urls={urls}
        onRemove={(url) =>
          setBranchUrlChips(
            data.parentId,
            urls.filter((item) => item !== url),
          )
        }
        onEdit={(oldUrl, nextUrl) =>
          setBranchUrlChips(
            data.parentId,
            replaceUrl(urls, oldUrl, nextUrl),
          )
        }
      />

      {attachments.items.length > 0 && (
        <AttachmentChips
          items={attachments.items}
          onRemove={attachments.remove}
          onOpen={openAttachment}
          compact
        />
      )}

      <div className="flex items-center justify-between gap-2">
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
              void attachments.addFiles(files)
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
            disabled={pending || attachments.uploading || (!draft.trim() && urls.length === 0)}
            onClick={() => void submit()}
            className="nodrag flex h-[calc(32px*var(--card-font-scale))] w-[calc(32px*var(--card-font-scale))] shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={14} className="card-scale-icon" />
          </button>
        </div>
      </div>
    </div>
  )
}

export const BranchInputNode = memo(BranchInputNodeInner)
