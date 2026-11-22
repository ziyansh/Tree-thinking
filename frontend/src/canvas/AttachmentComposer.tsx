import { useCallback, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react'
import { AlertTriangle, FileText, Film, Music, X } from 'lucide-react'
import { api } from '../api/client'
import type { ArkModelInfo, AttachmentDTO } from '../api/types'
import { useGraphStore } from '../store/graphStore'

/** 单文件上限与单节点附件数量上限，与后端保持一致 */
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_FILES = 10

export interface AttachmentUploads {
  /** 已上传成功的附件 */
  items: AttachmentDTO[]
  /** 是否仍有文件在上传 */
  uploading: boolean
  addFiles: (files: File[]) => Promise<void>
  remove: (id: string) => void
  clear: () => void
}

/** 本地维护待提交的附件列表：负责大小/数量校验、逐个上传与失败提示 */
export function useAttachmentUploads(initialItems: AttachmentDTO[] = []): AttachmentUploads {
  const [items, setItems] = useState<AttachmentDTO[]>(initialItems)
  const [uploading, setUploading] = useState(false)
  /** 与 items 同步的引用，保证连续调用 addFiles 时数量判断基于最新列表 */
  const itemsRef = useRef<AttachmentDTO[]>(initialItems)
  /** 进行中的上传数量，并发上传时用计数器避免提前解除上传态 */
  const pendingRef = useRef(0)

  const syncItems = useCallback((next: AttachmentDTO[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = MAX_FILES - itemsRef.current.length
      if (room <= 0) {
        window.alert(`最多只能添加 ${MAX_FILES} 个附件`)
        return
      }

      // 先按大小过滤，超限的文件直接跳过并提示
      const accepted: File[] = []
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          window.alert(`「${file.name}」超过 20MB，已跳过`)
          continue
        }
        accepted.push(file)
      }
      if (accepted.length === 0) return
      if (accepted.length > room) {
        window.alert(`最多只能添加 ${MAX_FILES} 个附件，已忽略多出的文件`)
        accepted.length = room
      }

      pendingRef.current += accepted.length
      setUploading(true)
      for (const file of accepted) {
        try {
          const attachment = await api.uploadAttachment(file)
          syncItems([...itemsRef.current, attachment])
        } catch (err) {
          window.alert(
            `上传附件「${file.name}」失败：${err instanceof Error ? err.message : '未知错误'}`,
          )
        } finally {
          pendingRef.current -= 1
          if (pendingRef.current <= 0) setUploading(false)
        }
      }
    },
    [syncItems],
  )

  const remove = useCallback(
    (id: string) => syncItems(itemsRef.current.filter((item) => item.id !== id)),
    [syncItems],
  )

  const clear = useCallback(() => syncItems([]), [syncItems])

  return { items, uploading, addFiles, remove, clear }
}

/** 按附件类型选择图标：视频 / 音频使用媒体图标，其余（含 PDF）使用文件图标 */
function AttachmentKindIcon({ kind, size }: { kind: AttachmentDTO['kind']; size: number }) {
  // 图标随卡片字号缩放，与附件的文字大小保持一致
  const scaleClass = size <= 12 ? 'card-scale-icon-sm' : 'card-scale-icon'
  if (kind === 'video') {
    return <Film size={size} className={`shrink-0 text-muted ${scaleClass}`} />
  }
  if (kind === 'audio') {
    return <Music size={size} className={`shrink-0 text-muted ${scaleClass}`} />
  }
  return <FileText size={size} className={`shrink-0 text-muted ${scaleClass}`} />
}

/** 在新窗口打开附件原始文件：PDF / 图片由浏览器直接预览，其它类型交给系统下载或打开 */
export function openAttachment(attachment: AttachmentDTO) {
  if (!attachment.url) return
  window.open(attachment.url, '_blank', 'noopener,noreferrer')
}

/**
 * PDF 页数提示：任一 PDF 超过 30 页或合计超过 30 页时提示费用风险，
 * 只读取附件列表，不额外请求后端。
 */
export function PdfPageWarning({ items }: { items: AttachmentDTO[] }) {
  const pages = items
    .filter((item) => item.kind === 'pdf' && typeof item.pageCount === 'number')
    .map((item) => item.pageCount as number)
  if (pages.length === 0) return null

  const total = pages.reduce((sum, value) => sum + value, 0)
  if (!pages.some((value) => value > 30) && total <= 30) return null

  // 页数特别多时优先提示上下文超限风险（比费用提示更直接）
  const oversized = pages.some((value) => value > 100) || total > 100

  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-danger">
      <AlertTriangle size={12} className="shrink-0" />
      {oversized ? 'pdf页数过多，可能超出模型上下文' : 'pdf页数过多，费用可能失控'}
    </span>
  )
}

/** 附件类型 → 需要的输入模态与提示文案；PDF 依靠视觉理解，共用 image 能力 */
const ARK_CAPABILITY_CHECKS: {
  kind: AttachmentDTO['kind']
  modality: string
  label: string
}[] = [
  { kind: 'image', modality: 'image', label: '不支持图片理解' },
  { kind: 'video', modality: 'video', label: '不支持视频理解' },
  { kind: 'audio', modality: 'audio', label: '不支持音频理解' },
  { kind: 'pdf', modality: 'image', label: '可能不支持 PDF 文档理解' },
]

/**
 * 火山方舟能力提示：当前模型缺少附件所需的输入模态时，
 * 在输入框底部工具栏提示「该模型不支持…理解」；找不到模型信息时不提示。
 */
export function ArkCapabilityWarning({
  items,
  model,
  models,
}: {
  items: AttachmentDTO[]
  model: string
  models: ArkModelInfo[]
}) {
  const provider = useGraphStore((state) => state.preferences.provider)
  if (provider !== 'ark' || items.length === 0) return null
  const info = models.find((item) => item.id === model)
  if (!info) return null

  const modalities = new Set(info.inputModalities)
  // 同一类型只保留一条，多种类型合并成一句提示
  const missing = ARK_CAPABILITY_CHECKS.filter(
    (check) => !modalities.has(check.modality) && items.some((item) => item.kind === check.kind),
  ).map((check) => check.label)
  if (missing.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-danger">
      <AlertTriangle size={12} className="shrink-0" />
      该模型{missing.join(' / ')}
    </span>
  )
}

interface AttachmentChipsProps {
  items: AttachmentDTO[]
  onRemove?: (id: string) => void
  /** 紧凑模式：用于卡片左上角的附件条，缩略图更小 */
  compact?: boolean
  /** 点击 chip 时回调（附件条中用于在新窗口打开原始文件） */
  onOpen?: (attachment: AttachmentDTO) => void
}

/** 横向可换行的附件条：所有附件统一显示文件图标 + 文件名 */
export function AttachmentChips({ items, onRemove, compact, onOpen }: AttachmentChipsProps) {
  if (items.length === 0) return null
  return (
    <div
      className="nodrag flex flex-wrap items-center gap-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((attachment) => (
        <div
          key={attachment.id}
          title={attachment.name}
          className={[
            'chip-in flex min-w-0 items-center gap-1.5 rounded-lg border border-subtle bg-elevated px-2 py-1',
            onOpen ? 'cursor-pointer hover:border-accent' : '',
          ].join(' ')}
          onClick={() => onOpen?.(attachment)}
        >
          <AttachmentKindIcon kind={attachment.kind} size={compact ? 12 : 14} />
          <span
            className="truncate card-scale-12 text-body"
            style={{ maxWidth: 'calc(120px * var(--card-font-scale))' }}
          >
            {attachment.name}
          </span>
          {attachment.parsed === false &&
            ['image', 'pdf', 'video', 'audio'].includes(attachment.kind) && (
              <span
                title="附件未解析，模型可能看不到内容"
                aria-label="附件未解析"
                className="shrink-0 text-danger"
              >
                <AlertTriangle size={11} className="card-scale-icon-sm" />
              </span>
            )}
          {onRemove && (
            <button
              type="button"
              title="移除附件"
              aria-label="移除附件"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(attachment.id)
              }}
              className="nodrag flex h-[calc(16px*var(--card-font-scale))] w-[calc(16px*var(--card-font-scale))] shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:text-danger"
            >
              <X size={11} className="card-scale-icon-sm" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export interface FileDropZoneHandlers {
  /** 是否有文件正拖入容器上方，用于父级高亮 */
  dragOver: boolean
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
}

/** 粘贴为附件的文本长度阈值：超过该长度转成 .txt 附件，避免撑爆输入框 */
const PASTE_TEXT_LIMIT = 2000

/**
 * 剪贴板粘贴：文件（含资源管理器 / Finder 复制的文件、截图）直接上传为附件；
 * 超长文本转成 .txt 附件；普通短文本不拦截，保持浏览器默认粘贴行为。
 * 返回 true 表示已经按附件处理（调用方可跳过链接识别）。
 */
export function usePasteAttachments(uploads: AttachmentUploads) {
  return (event: ReactClipboardEvent<HTMLElement>): boolean => {
    const clipboard = event.clipboardData
    if (!clipboard) return false

    // 从文件管理器复制的文件：clipboardData.files 里是完整的 File 对象
    const files = Array.from(clipboard.files ?? [])
    // 截图等场景只有 items 里有文件，补齐后按名称 + 大小 + 时间戳去重
    for (const item of clipboard.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      const exists = files.some(
        (current) =>
          current.name === file.name &&
          current.size === file.size &&
          current.lastModified === file.lastModified,
      )
      if (!exists) files.push(file)
    }
    if (files.length > 0) {
      event.preventDefault()
      void uploads.addFiles(files)
      return true
    }

    const text = clipboard.getData('text/plain')
    if (text && text.length > PASTE_TEXT_LIMIT) {
      event.preventDefault()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new File([text], `pasted-${stamp}.txt`, { type: 'text/plain' })
      void uploads.addFiles([file])
      return true
    }
    return false
  }
}

/** 文件拖拽投放：返回高亮状态与事件处理器（仅处理拖入文件的情况） */
export function useFileDropZone(onFiles: (files: File[]) => void): FileDropZoneHandlers {
  const [dragOver, setDragOver] = useState(false)

  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    // 指针只是移动到容器内的子元素时不取消高亮
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    setDragOver(false)
  }

  const onDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  return { dragOver, onDragOver, onDragLeave, onDrop }
}
