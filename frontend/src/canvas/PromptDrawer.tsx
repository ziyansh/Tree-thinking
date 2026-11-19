import { useEffect, useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { Paperclip, RefreshCw, X } from 'lucide-react'
import type { NodeDTO } from '../api/types'
import { useGraphStore } from '../store/graphStore'
import { useEscapeHandler } from '../lib/escapeStack'
import {
  AttachmentChips,
  useAttachmentUploads,
  usePasteAttachments,
} from './AttachmentComposer'
import { ThinkingToggle } from './ThinkingToggle'
import { WebSearchToggle } from './WebSearchToggle'

interface PromptDrawerProps {
  node: NodeDTO
  /** 打开即进入编辑态并聚焦（「重新提问」按钮） */
  initialEditing?: boolean
  onClose: () => void
}

/**
 * 卡片上方的提问抽屉：默认只读展示用户原始提问，双击进入编辑；
 * 编辑态与「自定义方向」一致（多行输入 + 思考/联网开关 + 圆形提交），
 * 提交按钮语义为「重新提交」：若已有后续卡片会先确认删除。
 */
export function PromptDrawer({ node, initialEditing = false, onClose }: PromptDrawerProps) {
  const updateNodePrompt = useGraphStore((state) => state.updateNodePrompt)
  const removeDescendants = useGraphStore((state) => state.removeDescendants)
  const runAnswer = useGraphStore((state) => state.runAnswer)

  const prompt = node.prompt || node.question
  const [editing, setEditing] = useState(initialEditing)
  const [draft, setDraft] = useState(prompt)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** 抽屉容器：用于判断失焦后焦点是否仍在抽屉内 */
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** 系统文件选择框会短暂抢走窗口焦点，期间抑制失焦退出编辑 */
  const suppressBlurRef = useRef(false)
  // 重新提交时可调整附件，默认沿用该卡片已有附件
  const attachments = useAttachmentUploads(node.attachments)
  const pasteAttachments = usePasteAttachments(attachments)

  useEscapeHandler(true, onClose)

  // 外部提问变化时同步草稿（撤销、重新提交后）
  useEffect(() => {
    if (!editing) setDraft(prompt)
  }, [prompt, editing])

  // 抽屉已打开时再点「重新提问」：父级把 initialEditing 置 true，这里立即进入编辑态
  useEffect(() => {
    if (initialEditing) setEditing(true)
  }, [initialEditing])

  // 进入编辑态聚焦并把光标放到末尾
  useEffect(() => {
    if (!editing) return
    const element = textareaRef.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
  }, [editing])

  // 文件选择框关闭后清除抑制标记：选中文件（change）或取消（窗口重新获得焦点）
  useEffect(() => {
    if (!editing) return
    const clearSuppress = () => {
      suppressBlurRef.current = false
    }
    window.addEventListener('focus', clearSuppress)
    return () => window.removeEventListener('focus', clearSuppress)
  }, [editing])

  // 编辑态下窗口失焦（切换到其它应用）同样退出编辑，文件选择框打开期间跳过
  useEffect(() => {
    if (!editing) return
    const handleWindowBlur = () => {
      if (submitting || suppressBlurRef.current) return
      setEditing(false)
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [editing, submitting])

  /** 焦点移出抽屉容器且不在提交中时，放弃未提交的修改并恢复只读 */
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!editing || submitting || suppressBlurRef.current) return
    const next = event.relatedTarget as Node | null
    if (next) {
      if (containerRef.current?.contains(next)) return
      setEditing(false)
      return
    }
    // 点击非可聚焦元素时 relatedTarget 为 null，延迟确认焦点是否仍留在抽屉内
    window.setTimeout(() => {
      const active = document.activeElement
      if (active && containerRef.current?.contains(active)) return
      if (suppressBlurRef.current) return
      setEditing(false)
    }, 0)
  }

  const resubmit = async () => {
    const text = draft.trim()
    if (!text || submitting) return
    const state = useGraphStore.getState()
    const hasChildren = state.nodes.some((item) => item.data.node.parentId === node.id)
    if (hasChildren) {
      if (!window.confirm('重新提交将会丢失后续卡片内容，请问是否继续？')) return
      try {
        await removeDescendants(node.id)
      } catch {
        return
      }
    }

    setSubmitting(true)
    try {
      await updateNodePrompt(
        node.id,
        text,
        attachments.items.map((item) => item.id),
      )
      setEditing(false)
      onClose()
      await runAnswer(node.id)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      ref={containerRef}
      data-modal-open="true"
      className="glass-surface drawer-pull-up nodrag nowheel absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-subtle shadow-[0_12px_32px_rgba(0,0,0,0.24)]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlur={handleBlur}
      onDoubleClick={() => {
        if (!editing) setEditing(true)
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-3 pt-2">
        <span className="text-[11px] text-muted">我的提问</span>
        <button
          type="button"
          title="收起提问"
          aria-label="收起提问"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors duration-150 hover:text-ink"
        >
          <X size={12} />
        </button>
      </div>

      {editing ? (
        <div className="tab-panel-in flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-2">
          <span className="shrink-0 text-[10px] leading-none text-muted/70">自定义方向</span>
          <textarea
            ref={textareaRef}
            value={draft}
            disabled={submitting}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={pasteAttachments}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void resubmit()
              }
            }}
            className="selectable-text min-h-[60px] w-full resize-none rounded-md bg-transparent text-[13px] leading-5 text-body outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
          />
          {attachments.items.length > 0 && (
            <AttachmentChips
              items={attachments.items}
              onRemove={attachments.remove}
              compact
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="添加附件"
                aria-label="添加附件"
                onClick={() => {
                  // 文件选择框会短暂夺走焦点，先标记抑制失焦退出
                  suppressBlurRef.current = true
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
                  suppressBlurRef.current = false
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
              title="重新提交"
              aria-label="重新提交"
              disabled={submitting || !draft.trim()}
              onClick={() => void resubmit()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <p className="selectable-text whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-body">
            {prompt || <span className="text-muted">还没有提问</span>}
          </p>
          <p className="mt-1 text-[11px] text-muted/70">双击可修改并重新提交</p>
        </div>
      )}
    </div>
  )
}
