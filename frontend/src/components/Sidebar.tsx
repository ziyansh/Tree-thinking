import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import type { ProjectDTO } from '../api/types'

/** 展开/收起后的固定宽度；切换宽度不做动画，避免画布内容出现大幅位移 */
const EXPANDED_WIDTH = 240
const COLLAPSED_WIDTH = 48

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

/** 左侧可折叠画布侧边栏：列出、切换、新建、重命名与删除画布，左下角提供设置入口 */
export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
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
                            'truncate pr-12 text-[13px] leading-tight',
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
