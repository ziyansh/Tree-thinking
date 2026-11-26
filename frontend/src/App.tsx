import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/client'
import type { AuthSession, AuthUser } from './api/types'
import { Canvas } from './canvas/Canvas'
import { AuthPage } from './components/AuthPage'
import { NoticeDialog } from './components/NoticeDialog'
import { Sidebar } from './components/Sidebar'
import { SettingsDialog } from './components/SettingsDialog'
import { Toast } from './components/Toast'
import {
  NOTICE_SWITCHES,
  WIP_NOTICE,
  detectCompatibilityNotice,
  type NoticeContent,
} from './lib/notices'
import { useGraphStore } from './store/graphStore'

/** 启动阶段：读取会话 → 登录页 / 画布 / 连接失败 */
type Phase = 'loading' | 'auth' | 'canvas' | 'error'

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
  // 服务器模式首次登录的开发中提示；按账号记录，同一浏览器只弹一次
  const [wipOpen, setWipOpen] = useState(false)
  // 设备 / 运行模式的兼容性提示；按浏览器记录，关闭后不再提示
  const [compatNotice, setCompatNotice] = useState<NoticeContent | null>(null)
  // 启动失败原因：无法确认运行模式时展示重试页，绝不回落到画布
  const [bootError, setBootError] = useState('')
  // StrictMode 会重复执行 effect，用 ref 保证一次挂载只读取一次会话
  const bootStartedRef = useRef(false)
  // 重试计数：递增后重新触发启动流程
  const [bootAttempt, setBootAttempt] = useState(0)

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
    if (bootStartedRef.current) return
    bootStartedRef.current = true

    void (async () => {
      let current: AuthSession
      try {
        current = await api.getSession()
      } catch (err) {
        // 无法确认运行模式时不能当作 local 进入画布，否则服务器模式会绕过登录页
        console.error('读取会话失败', err)
        setBootError(err instanceof Error ? err.message : '无法连接后端服务')
        setPhase('error')
        return
      }
      setSession(current)
      if (current.mode === 'server' && !current.user) {
        setPhase('auth')
        return
      }
      await initCanvas()
      setPhase('canvas')
    })()
  }, [initCanvas, bootAttempt])

  /** 启动失败后重试：重置标记并重新读取会话 */
  const retryBoot = useCallback(() => {
    bootStartedRef.current = false
    setBootError('')
    setPhase('loading')
    setBootAttempt((count) => count + 1)
  }, [])

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

  // 服务器模式登录后（含刷新恢复会话）检查该账号是否已看过开发中提示
  useEffect(() => {
    if (!NOTICE_SWITCHES.wip || session?.mode !== 'server' || !session.user) {
      setWipOpen(false)
      return
    }
    const key = `tree-thinking:wip-notice:${session.user.id}`
    try {
      setWipOpen(window.localStorage.getItem(key) !== '1')
    } catch {
      // 隐私模式等禁用 localStorage 时仍提示一次，不影响主流程
      setWipOpen(true)
    }
  }, [session])

  /** 关闭开发中提示，并记录该账号已确认 */
  const closeWipNotice = useCallback(() => {
    if (session?.user) {
      try {
        window.localStorage.setItem(`tree-thinking:wip-notice:${session.user.id}`, '1')
      } catch {
        // 无法持久化时只关闭当前弹窗
      }
    }
    setWipOpen(false)
  }, [session])

  // 登录后检查设备 / 运行模式的兼容性提示；同一浏览器只提示一次
  useEffect(() => {
    if (!NOTICE_SWITCHES.compatibility) {
      setCompatNotice(null)
      return
    }
    const notice = detectCompatibilityNotice(
      session?.mode ?? 'local',
      window.navigator.userAgent,
    )
    if (!notice) {
      setCompatNotice(null)
      return
    }
    try {
      if (window.localStorage.getItem('tree-thinking:compatibility-notice') === '1') return
    } catch {
      // 隐私模式等禁用 localStorage 时仍提示一次，不影响主流程
    }
    setCompatNotice(notice)
  }, [session])

  /** 关闭兼容性提示，并在当前浏览器记录 */
  const closeCompatNotice = useCallback(() => {
    try {
      window.localStorage.setItem('tree-thinking:compatibility-notice', '1')
    } catch {
      // 无法持久化时只关闭当前弹窗
    }
    setCompatNotice(null)
  }, [])

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

  // 启动失败：无法确认运行模式时只提供重试，绝不进入画布
  if (phase === 'error') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas px-4">
        <div className="w-[360px] max-w-full rounded-xl border border-subtle bg-panel p-6 shadow-2xl">
          <h1 className="text-[16px] font-semibold text-ink">无法连接后端</h1>
          <p className="mt-2 text-[12px] text-body">{bootError}</p>
          <p className="mt-2 text-[12px] text-muted">
            请确认后端已启动，并检查前端代理或服务器 /api 反向代理配置。
          </p>
          <button
            type="button"
            onClick={retryBoot}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-on-accent transition-opacity duration-150 hover:opacity-90"
          >
            重试
          </button>
        </div>
      </div>
    )
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
      <NoticeDialog open={wipOpen} onClose={closeWipNotice} {...WIP_NOTICE} />
      {compatNotice && (
        // 开发中提示关闭后再展示，保证首次登录的提示顺序
        <NoticeDialog open={!wipOpen} onClose={closeCompatNotice} {...compatNotice} />
      )}
      <Toast message={toast} />
    </div>
  )
}

export default App
