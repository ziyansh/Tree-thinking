import { useEffect, useState } from 'react'
import { Canvas } from './canvas/Canvas'
import { Sidebar } from './components/Sidebar'
import { SettingsDialog } from './components/SettingsDialog'
import { useGraphStore } from './store/graphStore'

// StrictMode 下 effect 会执行两次，用模块级标记避免重复建画布
let bootstrapped = false

function App() {
  const loadProjects = useGraphStore((state) => state.loadProjects)
  const openProject = useGraphStore((state) => state.openProject)
  const createProject = useGraphStore((state) => state.createProject)
  const loadPreferences = useGraphStore((state) => state.loadPreferences)
  // 设置以悬浮窗形式打开，与画布状态无关
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 保存与撤销所需的画布与设置状态
  const currentProjectId = useGraphStore((state) => state.currentProjectId)
  const autosaveMinutes = useGraphStore((state) => state.preferences.autosaveMinutes)
  const toast = useGraphStore((state) => state.toast)

  useEffect(() => {
    if (bootstrapped) return
    bootstrapped = true

    void (async () => {
      try {
        await loadProjects()
        const projects = useGraphStore.getState().projects
        if (projects.length > 0) {
          // 打开最近更新的画布，保证刷新后回到上次的位置
          await openProject(projects[0].id)
        } else {
          // 一个画布都没有时自动建第一个，让根卡片可见
          await createProject()
        }
      } catch (err) {
        console.error('初始化画布失败', err)
      } finally {
        // 个人设置（主题/尺寸/外观）与画布无关，失败只告警，不影响画布渲染
        await loadPreferences()
      }
    })()
  }, [loadProjects, openProject, createProject, loadPreferences])

  // 全局快捷键：Delete 删除选中卡片、Ctrl/Cmd+Z 撤销（输入类控件内交给浏览器原生撤销）、Ctrl/Cmd+S 保存
  useEffect(() => {
    const isEditable = (element: HTMLElement | null): boolean => {
      if (!element) return false
      return (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable
      )
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete') {
        // 输入中、设置打开或有模态覆盖层时不删除
        if (isEditable(document.activeElement as HTMLElement | null)) return
        if (settingsOpen) return
        if (document.querySelector('[data-modal-open="true"]')) return
        const state = useGraphStore.getState()
        if (state.selectedNodeIds.length === 0) return
        event.preventDefault()
        void state.deleteSelected()
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        // 标题/正文等输入框聚焦时保留浏览器原生撤销
        if (isEditable(document.activeElement as HTMLElement | null)) return
        event.preventDefault()
        void useGraphStore.getState().undo()
        return
      }
      if (key === 's') {
        event.preventDefault()
        void useGraphStore.getState().saveCurrentProject()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  // 自动保存：间隔按设置中的分钟数，0 或非正数不启用；切换画布时重置定时器
  useEffect(() => {
    if (!currentProjectId || !(autosaveMinutes > 0)) return
    const timer = window.setInterval(() => {
      void useGraphStore.getState().saveCurrentProject()
    }, autosaveMinutes * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [currentProjectId, autosaveMinutes])

  return (
    <div className="flex h-full w-full bg-canvas">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="min-w-0 flex-1">
        <Canvas />
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-subtle bg-panel px-4 py-1.5 text-[12px] text-ink shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

export default App
