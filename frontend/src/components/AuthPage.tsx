import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import type { AuthUser } from '../api/types'

/** 用户名规则：3–32 位字母、数字或下划线（与后端校验一致） */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/

/** 密码长度范围（与后端校验一致） */
const MIN_PASSWORD_LENGTH = 4
const MAX_PASSWORD_LENGTH = 12

/** 输入框样式，与设置弹窗保持一致 */
const INPUT_CLASS =
  'w-full rounded-lg border border-subtle bg-elevated px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent'

interface AuthPageProps {
  /** 登录/注册成功：交由 App 初始化画布并进入主界面 */
  onAuthenticated: (user: AuthUser) => void | Promise<void>
}

/** 各输入框的失焦错误文案；空串表示当前没有错误 */
interface FieldErrors {
  username: string
  password: string
  confirm: string
}

const EMPTY_ERRORS: FieldErrors = { username: '', password: '', confirm: '' }

/** 服务器模式的登录/注册页：同一卡片内切换两种表单 */
export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(EMPTY_ERRORS)
  const [checkingName, setCheckingName] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 只更新单个字段的错误文案 */
  const setFieldError = (field: keyof FieldErrors, message: string) => {
    setFieldErrors((current) => ({ ...current, [field]: message }))
  }

  /** 切换表单：保留用户名，清空确认密码与全部错误提示 */
  const switchMode = (next: 'login' | 'register') => {
    if (next === mode) return
    setMode(next)
    setConfirm('')
    setError(null)
    setFieldErrors(EMPTY_ERRORS)
  }

  /** 校验用户名格式；注册模式下再询问后端是否已被占用 */
  const validateUsername = async (value: string, checkRemote: boolean): Promise<boolean> => {
    const name = value.trim()
    if (!USERNAME_PATTERN.test(name)) {
      setFieldError('username', '用户名需为 3–32 位字母、数字或下划线')
      return false
    }
    if (!checkRemote) {
      setFieldError('username', '')
      return true
    }
    setCheckingName(true)
    try {
      const result = await api.checkUsername(name)
      if (!result.available) {
        setFieldError('username', result.reason || '该用户名不可用')
        return false
      }
      setFieldError('username', '')
      return true
    } catch (err) {
      // 检查接口失败时同样提示，最终仍由注册接口兜底校验
      setFieldError('username', err instanceof Error ? err.message : '用户名检查失败，请稍后重试')
      return false
    } finally {
      setCheckingName(false)
    }
  }

  /** 密码长度校验（仅在注册模式下使用） */
  const validatePassword = (value: string): boolean => {
    if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
      setFieldError('password', `密码长度需在 ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 位之间`)
      return false
    }
    setFieldError('password', '')
    return true
  }

  /** 确认密码：不能为空且必须与密码一致 */
  const validateConfirm = (value: string): boolean => {
    if (!value) {
      setFieldError('confirm', '请再次输入密码')
      return false
    }
    if (value !== password) {
      setFieldError('confirm', '两次输入的密码不一致')
      return false
    }
    setFieldError('confirm', '')
    return true
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || checkingName) return
    setError(null)

    const name = username.trim()
    if (mode === 'register') {
      // 三个输入框全部重新校验：用户名含在线查重，密码与确认密码按 4–12 位规则
      const nameOk = await validateUsername(name, true)
      const passwordOk = validatePassword(password)
      const confirmOk = validateConfirm(confirm)
      if (!nameOk || !passwordOk || !confirmOk) return
    } else {
      if (!name) {
        setFieldError('username', '请输入用户名')
        return
      }
      if (!password) {
        setFieldError('password', '请输入密码')
        return
      }
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

  /** 输入框错误样式：有错误时边框变为警示色 */
  const inputClass = (field: keyof FieldErrors) =>
    [INPUT_CLASS, fieldErrors[field] ? 'border-danger' : ''].join(' ')

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
              aria-invalid={Boolean(fieldErrors.username)}
              onChange={(event) => {
                setUsername(event.target.value)
                // 用户重新输入时先清掉旧提示，失焦后再校验
                if (fieldErrors.username) setFieldError('username', '')
              }}
              onBlur={() => {
                // 登录模式只校验必填，注册模式额外检查格式与是否重复
                if (mode === 'register') void validateUsername(username, true)
                else if (!username.trim()) setFieldError('username', '请输入用户名')
              }}
              className={inputClass('username')}
            />
            {fieldErrors.username && (
              <p className="error-in text-[12px] text-danger">{fieldErrors.username}</p>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">密码</span>
            <input
              type="password"
              value={password}
              // 不限制 maxLength，超长时才能提示「长度不合法」
              maxLength={72}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={`${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 位`}
              aria-invalid={Boolean(fieldErrors.password)}
              onChange={(event) => {
                setPassword(event.target.value)
                if (fieldErrors.password) setFieldError('password', '')
              }}
              onBlur={() => {
                if (mode === 'register') validatePassword(password)
                else if (!password) setFieldError('password', '请输入密码')
              }}
              className={inputClass('password')}
            />
            {fieldErrors.password && (
              <p className="error-in text-[12px] text-danger">{fieldErrors.password}</p>
            )}
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
                aria-invalid={Boolean(fieldErrors.confirm)}
                onChange={(event) => {
                  setConfirm(event.target.value)
                  if (fieldErrors.confirm) setFieldError('confirm', '')
                }}
                onBlur={() => validateConfirm(confirm)}
                className={inputClass('confirm')}
              />
              {fieldErrors.confirm && (
                <p className="error-in text-[12px] text-danger">{fieldErrors.confirm}</p>
              )}
            </label>
          )}

          {error && <p className="error-in text-[12px] text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting || checkingName}
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
