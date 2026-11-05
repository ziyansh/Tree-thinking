import { useCallback, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { FileText, X } from 'lucide-react'
import { api } from '../api/client'
import type { AttachmentDTO } from '../api/types'

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
export function useAttachmentUploads(): AttachmentUploads {
  const [items, setItems] = useState<AttachmentDTO[]>([])
  const [uploading, setUploading] = useState(false)
  /** 与 items 同步的引用，保证连续调用 addFiles 时数量判断基于最新列表 */
  const itemsRef = useRef<AttachmentDTO[]>([])
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
            'flex min-w-0 items-center gap-1.5 rounded-lg border border-subtle bg-elevated px-1.5 py-1',
            onOpen ? 'cursor-pointer hover:border-accent' : '',
          ].join(' ')}
          onClick={() => onOpen?.(attachment)}
        >
          <FileText size={compact ? 12 : 14} className="shrink-0 text-muted" />
          <span className="truncate text-[11px] text-body" style={{ maxWidth: '120px' }}>
            {attachment.name}
          </span>
          {onRemove && (
            <button
              type="button"
              title="移除附件"
              aria-label="移除附件"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(attachment.id)
              }}
              className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:text-danger"
            >
              <X size={11} />
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
