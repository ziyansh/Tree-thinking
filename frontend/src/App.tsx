import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from './api/client'
import type { AuthSession, AuthUser } from './api/types'
import { Canvas } from './canvas/Canvas'
import { AuthPage } from './components/AuthPage'
import { Sidebar } from './components/Sidebar'
import { SettingsDialog } from './components/SettingsDialog'
import { Toast } from './components/Toast'
import { useGraphStore } from './store/graphStore'

/** 启动阶段：读取会话 → 登录页 / 画布 */
type Phase = 'loading' | 'auth' | 'canvas'

// StrictMode 下 effect 会执行两次，用模块级标记避免重复读取会话与建画布
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
  // 当前会话与启动阶段：server 模式未登录时只渲染登录页
  const [session, setSession] = useState<AuthSession | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')

  /** 初始化画布：打开最近更新的画布，一个都没有时新建第一个 */
  const initCanvas = useCallback(async () => {
    try {
      await loadProjects()
      const projects = useGraphStore.getState().projects
      if (projects.length > 0) {
        await openProject(projects[0].id)
      } else {
        await createProject()
      }
    } catch (err) {
      console.error('初始化画布失败', err)
    } finally {
      // 个人设置（主题/尺寸/外观）与画布无关，失败只告警，不影响画布渲染
      await loadPreferences()
    }
  }, [loadProjects, openProject, createProject, loadPreferences])

  // 启动：先读会话；local 直接初始化，server 未登录时只渲染登录页，不触发画布请求
  useEffect(() => {
    if (bootstrapped) return
    bootstrapped = true

    void (async () => {
      let current: AuthSession
      try {
        current = await api.getSession()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // 会话接口返回 401 视为未登录，渲染登录页
          current = { mode: 'server', user: null }
        } else {
          // 后端未启动等其他失败按本地模式继续，画布初始化会各自告警
          console.warn('读取会话失败', err)
          current = { mode: 'local', user: null }
        }
      }
      setSession(current)
      if (current.mode === 'server' && !current.user) {
        setPhase('auth')
        return
      }
      await initCanvas()
      setPhase('canvas')
    })()
  }, [initCanvas])

  /** 登录/注册成功：写入会话，初始化画布后进入主界面 */
  const handleAuthenticated = useCallback(
    async (user: AuthUser) => {
      setSession({ mode: 'server', user })
      setPhase('loading')
      await initCanvas()
      setPhase('canvas')
    },
    [initCanvas],
  )

  /** 退出登录：清空画布状态并回到登录页 */
  const handleLogout = useCallback(async () => {
    try {
      await api.logout()
    } catch (err) {
      console.warn('退出登录失败', err)
    }
    useGraphStore.getState().resetCanvas()
    setSession((current) => ({ mode: current?.mode ?? 'server', user: null }))
    setPhase('auth')
  }, [])

  /** 运行中会话过期只处理一次：并发的多个 401 会重复派发事件 */
  const unauthorizedHandledRef = useRef(false)

  // server 模式运行中收到 401：清空画布与会话并回到登录页；local 模式不监听
  useEffect(() => {
    if (session?.mode !== 'server' || !session.user) {
      unauthorizedHandledRef.current = false
      return
    }
    const handleUnauthorized = () => {
      if (unauthorizedHandledRef.current) return
      unauthorizedHandledRef.current = true
      useGraphStore.getState().resetCanvas()
      setSession({ mode: 'server', user: null })
      setPhase('auth')
    }
    window.addEventListener('tt:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('tt:unauthorized', handleUnauthorized)
  }, [session])

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

  // 读取会话期间只显示居中加载态，避免闪现登录页
  if (phase === 'loading') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas">
        <p className="text-[13px] text-muted">正在加载…</p>
      </div>
    )
  }

  // server 模式未登录：只渲染登录页，不触发任何画布请求
  if (phase === 'auth') {
    return <AuthPage onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="flex h-full w-full bg-canvas">
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        session={session}
        onLogout={() => void handleLogout()}
      />
      <div className="min-w-0 flex-1">
        <Canvas />
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toast message={toast} />
    </div>
  )
}

export default App
