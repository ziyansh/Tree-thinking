import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronsLeft,
  ChevronsRight,
  Download,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../api/client'
import { useGraphStore } from '../store/graphStore'
import { highlightText } from '../lib/highlight'
import type { AuthSession, ProjectDTO, SearchHit } from '../api/types'

/** 展开/收起后的固定宽度；切换宽度不做动画，避免画布内容出现大幅位移 */
const EXPANDED_WIDTH = 240
const COLLAPSED_WIDTH = 48

/** 去掉 Windows 文件名非法字符（\ / : * ? " < > |），结尾空格与点也一并清理 */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned || '画布'
}

/** 导出文件名的时间戳：yyyyMMdd-HHmm */
function fileStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('')
}

/** 搜索结果标签：区分画布名、卡片标题与正文 */
function hitLabel(hit: SearchHit): string {
  if (hit.field === 'project') return '画布'
  if (hit.field === 'title') return hit.nodeType === 'note' ? '笔记标题' : '卡片标题'
  return hit.nodeType === 'note' ? '笔记正文' : '回答'
}

interface IconButtonProps {
  title: string
  onClick: () => void
  small?: boolean
  danger?: boolean
  children: ReactNode
}

/** 图标按钮：展开态 28×28，列表项内 24×24，外观与画布工具栏按钮保持一致 */
function IconButton({ title, onClick, small, danger, children }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        // 阻止冒泡，避免点击图标时同时切换画布
        event.stopPropagation()
        onClick()
      }}
      className={[
        small ? 'h-6 w-6' : 'h-7 w-7',
        'flex shrink-0 items-center justify-center rounded-md transition-colors duration-150',
        danger
          ? 'text-muted hover:bg-ghost-border hover:text-danger'
          : 'text-muted hover:bg-ghost-border hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** 左侧可折叠画布侧边栏：列出、切换、新建、重命名、下载与删除画布，左下角提供设置与账号入口 */
export function Sidebar({
  onOpenSettings,
  session,
  onLogout,
}: {
  onOpenSettings: () => void
  session: AuthSession | null
  onLogout: () => void
}) {
  const projects = useGraphStore((state) => state.projects)
  const currentProjectId = useGraphStore((state) => state.currentProjectId)
  const openProject = useGraphStore((state) => state.openProject)
  const createProject = useGraphStore((state) => state.createProject)
  const renameProject = useGraphStore((state) => state.renameProject)
  const deleteProject = useGraphStore((state) => state.deleteProject)

  const [collapsed, setCollapsed] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  /** Esc 取消重命名时置位，避免随后的 blur 事件把草稿提交上去 */
  const skipCommitRef = useRef(false)

  // 全局搜索：跨画布搜索画布名、卡片标题与正文
  const requestFocus = useGraphStore((state) => state.requestFocus)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchTruncated, setSearchTruncated] = useState(false)
  const searchInputRef = useRef<HTMLTextAreaElement | null>(null)

  // 关键词变化后防抖请求；server 模式下后端只会返回当前用户自己的画布
  useEffect(() => {
    const term = searchQuery.trim()
    if (!term) {
      setSearchHits([])
      setSearchTruncated(false)
      setSearchError('')
      setSearchLoading(false)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      void api
        .search(term)
        .then((result) => {
          if (!alive) return
          setSearchHits(result.items)
          setSearchTruncated(result.truncated)
          setSearchError('')
        })
        .catch((err: unknown) => {
          if (!alive) return
          setSearchHits([])
          setSearchError(err instanceof Error ? err.message : '搜索失败，请稍后重试')
        })
        .finally(() => {
          if (alive) setSearchLoading(false)
        })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [searchQuery])

  /** 输入框随换行内容自动增高，避免长关键词被截断 */
  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    const input = searchInputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }

  /** 清空搜索并收起结果浮层 */
  const clearSearch = () => {
    setSearchQuery('')
    const input = searchInputRef.current
    if (input) input.style.height = 'auto'
  }

  /** 点击结果：先切换到所属画布，再移动镜头、适配缩放到合适大小并高亮闪烁命中内容 */
  const pickHit = async (hit: SearchHit) => {
    const term = searchQuery.trim()
    const state = useGraphStore.getState()
    if (hit.projectId !== state.currentProjectId) {
      try {
        await state.openProject(hit.projectId)
      } catch (err) {
        console.warn('切换画布失败', err)
        return
      }
    }
    if (hit.nodeId) {
      // 侧边栏搜索只做一次性闪烁提示，结束后恢复普通文本
      requestFocus(hit.nodeId, {
        field: hit.field,
        query: term,
        zoom: 'fit',
        flashOnly: true,
      })
    }
    clearSearch()
  }

  const startRename = (project: ProjectDTO) => {
    skipCommitRef.current = false
    setEditingId(project.id)
    setDraftName(project.name)
  }

  const finishRename = async (id: string) => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      setEditingId(null)
      return
    }
    const name = draftName.trim()
    setEditingId(null)
    if (!name) return
    try {
      await renameProject(id, name)
    } catch (err) {
      console.warn('重命名画布失败', err)
    }
  }

  const handleDelete = async (project: ProjectDTO) => {
    const wasCurrent = project.id === currentProjectId
    try {
      await deleteProject(project.id)
    } catch (err) {
      console.warn('删除画布失败', err)
      return
    }
    // 用户取消确认时当前画布仍在，不做后续切换
    const state = useGraphStore.getState()
    if (!wasCurrent || state.currentProjectId === project.id) return
    try {
      // 删掉了当前画布：优先打开列表里最近的一个，一个都不剩时新建
      if (state.projects.length > 0) await openProject(state.projects[0].id)
      else await createProject()
    } catch (err) {
      console.warn('切换画布失败', err)
    }
  }

  /** 下载画布历史文件：取 Blob → 临时 URL → a[download] → 释放 URL */
  const handleDownload = async (project: ProjectDTO) => {
    try {
      const blob = await api.exportProject(project.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeFileName(project.name)}-${fileStamp(new Date())}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.warn('下载画布失败', err)
      window.alert(err instanceof Error ? err.message : '下载失败，请稍后重试')
    }
  }

  return (
    <aside
      className="flex h-full flex-none flex-col overflow-hidden border-r border-subtle bg-panel"
      style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-1 py-2">
          <IconButton title="展开侧边栏" onClick={() => setCollapsed(false)}>
            <ChevronsRight size={14} />
          </IconButton>
          <IconButton title="新建画布" onClick={() => void createProject()}>
            <Plus size={14} />
          </IconButton>
          <div className="flex-1" />
          <IconButton title="设置" onClick={onOpenSettings}>
            <Settings size={14} />
          </IconButton>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-3 pb-2 pt-3">
            {/* 全局搜索：结果浮层覆盖画布列表，避免搜索时列表跳动 */}
            <div className="relative mb-3">
              <div className="glass-surface flex items-start gap-2 rounded-lg border border-subtle px-2 py-1.5">
                <Search size={13} className="mt-0.5 shrink-0 text-muted" />
                <textarea
                  ref={searchInputRef}
                  rows={1}
                  value={searchQuery}
                  placeholder="搜索所有画布…"
                  spellCheck={false}
                  onChange={(event) => handleSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      if (searchHits.length > 0) void pickHit(searchHits[0])
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      clearSearch()
                    }
                  }}
                  className="max-h-24 min-h-[18px] w-full resize-none overflow-y-auto bg-transparent text-[12px] leading-[1.5] text-ink outline-none placeholder:text-muted"
                />
                {searchQuery && (
                  <button
                    type="button"
                    title="清空搜索"
                    aria-label="清空搜索"
                    onClick={clearSearch}
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {searchQuery.trim() && (
                <div className="glass-surface absolute left-0 right-0 top-full z-30 mt-1 max-h-[55vh] overflow-y-auto rounded-lg border border-subtle shadow-[0_12px_32px_rgba(0,0,0,0.24)]">
                  <div className="flex items-center justify-between border-b border-subtle px-2 py-1 text-[11px] text-muted">
                    <span>
                      {searchLoading
                        ? '搜索中…'
                        : `${searchHits.length} 条结果${searchTruncated ? '（已截断）' : ''}`}
                    </span>
                    <span>Esc 清空</span>
                  </div>
                  {searchError ? (
                    <p className="px-2 py-2 text-[12px] text-danger">{searchError}</p>
                  ) : null}
                  {!searchError && !searchLoading && searchHits.length === 0 ? (
                    <p className="px-2 py-2 text-[12px] text-muted">没有匹配的内容。</p>
                  ) : null}
                  {searchHits.map((hit) => (
                    <button
                      key={`${hit.projectId}-${hit.nodeId ?? 'project'}-${hit.field}`}
                      type="button"
                      onClick={() => void pickHit(hit)}
                      className="flex w-full flex-col gap-1 border-b border-subtle px-2 py-1.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-ghost-border"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="shrink-0 rounded bg-elevated px-1 py-0.5">
                          {hitLabel(hit)}
                        </span>
                        <span className="truncate">{hit.projectName}</span>
                      </span>
                      <span className="line-clamp-2 break-words text-[12px] leading-[1.6] text-body">
                        {highlightText(hit.snippet, searchQuery.trim())}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="text-[13px] text-muted">画布</span>
            <button
              type="button"
              onClick={() => void createProject()}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-subtle bg-elevated px-2 py-1.5 text-[12px] text-body transition-colors duration-150 hover:border-strong hover:text-ink"
            >
              <Plus size={13} />
              新建画布
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {projects.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-muted">还没有画布，点上方「新建画布」</p>
            ) : (
              <div className="flex flex-col gap-1">
                {projects.map((project) => {
                  const active = project.id === currentProjectId
                  const editing = editingId === project.id
                  return (
                    <div
                      key={project.id}
                      data-project-id={project.id}
                      onClick={() => {
                        if (!editing && !active) void openProject(project.id)
                      }}
                      className={[
                        'group relative cursor-pointer rounded-lg p-2 transition-colors duration-150',
                        active ? 'bg-accent-dim' : 'hover:bg-ghost-border',
                      ].join(' ')}
                    >
                      {active && (
                        <span className="absolute left-0 top-0 h-full w-[2px] rounded-full bg-accent" />
                      )}

                      {editing ? (
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              skipCommitRef.current = true
                              event.currentTarget.blur()
                            }
                          }}
                          onBlur={() => void finishRename(project.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="w-full rounded border border-subtle bg-elevated px-1.5 py-1 text-[13px] leading-tight text-ink outline-none focus:border-accent"
                        />
                      ) : (
                        <div
                          className={[
                            // 右侧常驻三个图标（重命名/下载/删除），预留足够宽度避免标题被遮挡
                            'truncate pr-20 text-[13px] leading-tight',
                            active ? 'text-accent' : 'text-ink',
                          ].join(' ')}
                        >
                          {project.name}
                        </div>
                      )}

                      {!editing && (
                        <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                          <IconButton
                            title="重命名画布"
                            small
                            onClick={() => startRename(project)}
                          >
                            <Pencil size={12} />
                          </IconButton>
                          <IconButton
                            title="下载历史文件"
                            small
                            onClick={() => void handleDownload(project)}
                          >
                            <Download size={12} />
                          </IconButton>
                          <IconButton
                            title="删除画布"
                            small
                            danger
                            onClick={() => void handleDelete(project)}
                          >
                            <Trash2 size={12} />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-subtle p-2">
            {/* 仅 server 模式显示账号区：当前用户名与退出登录 */}
            {session?.mode === 'server' && session.user && (
              <div className="mb-1 flex items-center justify-between gap-1 px-1.5">
                <span
                  className="min-w-0 truncate text-[12px] text-muted"
                  title={session.user.username}
                >
                  {session.user.username}
                </span>
                <button
                  type="button"
                  title="退出登录"
                  aria-label="退出登录"
                  onClick={onLogout}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
                >
                  <LogOut size={12} />
                  退出登录
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                title="设置"
                aria-label="设置"
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[12px] text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
              >
                <Settings size={14} />
                设置
              </button>
              <button
                type="button"
                title="收起侧边栏"
                aria-label="收起侧边栏"
                onClick={() => setCollapsed(true)}
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[12px] text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
              >
                <ChevronsLeft size={14} />
                收起
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
