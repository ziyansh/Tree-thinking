import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import type { AuthUser } from '../api/types'

/** 用户名规则：3–32 位字母、数字或下划线（与后端校验一致） */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/

/** 输入框样式，与设置弹窗保持一致 */
const INPUT_CLASS =
  'w-full rounded-lg border border-subtle bg-elevated px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent'

interface AuthPageProps {
  /** 登录/注册成功：交由 App 初始化画布并进入主界面 */
  onAuthenticated: (user: AuthUser) => void | Promise<void>
}

/** 服务器模式的登录/注册页：同一卡片内切换两种表单 */
export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 切换表单：保留用户名，清空确认密码与错误提示 */
  const switchMode = (next: 'login' | 'register') => {
    if (next === mode) return
    setMode(next)
    setConfirm('')
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setError(null)

    const name = username.trim()
    if (!USERNAME_PATTERN.test(name)) {
      setError('用户名需为 3–32 位字母、数字或下划线')
      return
    }
    if (password.length < 8 || password.length > 72) {
      setError('密码长度需为 8–72 位')
      return
    }
    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    try {
      const user = mode === 'login' ? await api.login(name, password) : await api.register(name, password)
      await onAuthenticated(user)
    } catch (err) {
      // 后端返回的中文文案直接展示在卡片内
      setError(
        err instanceof Error
          ? err.message
          : mode === 'login'
            ? '登录失败，请稍后重试'
            : '注册失败，请稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas px-4">
      <div className="auth-panel w-[360px] max-w-full rounded-xl border border-subtle bg-panel p-6 shadow-2xl">
        <h1 className="text-[16px] font-semibold text-ink">树状对话画布</h1>
        <p className="mt-1 text-[12px] text-muted">服务器模式需要登录后使用</p>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-subtle bg-elevated p-1">
          {(['login', 'register'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => switchMode(item)}
              className={[
                'rounded-md px-2 py-1.5 text-[12px] transition-colors duration-150',
                mode === item ? 'bg-accent-dim text-accent' : 'text-muted hover:text-ink',
              ].join(' ')}
            >
              {item === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">用户名</span>
            <input
              autoFocus
              value={username}
              maxLength={32}
              autoComplete="username"
              placeholder="3–32 位字母、数字或下划线"
              onChange={(event) => setUsername(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">密码</span>
            <input
              type="password"
              value={password}
              maxLength={72}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="8–72 位"
              onChange={(event) => setPassword(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          {mode === 'register' && (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">确认密码</span>
              <input
                type="password"
                value={confirm}
                maxLength={72}
                autoComplete="new-password"
                placeholder="再次输入密码"
                onChange={(event) => setConfirm(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          )}

          {error && <p className="error-in text-[12px] text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-on-accent transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '提交中…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => window.alert('暂不支持自助找回，请联系管理员')}
          className="mt-3 text-[12px] text-muted transition-colors duration-150 hover:text-ink"
        >
          忘记密码？
        </button>
      </div>
    </div>
  )
}
