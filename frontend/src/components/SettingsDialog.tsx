import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { api } from '../api/client'
import type {
  ConnectionStyle,
  ModelProvider,
  ReasoningEffort,
  SettingsDTO,
  SettingsPatch,
  ThemeMode,
  TimeFormat,
} from '../api/types'
import { useGraphStore } from '../store/graphStore'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

/** 选项卡：模型服务 / 画布 / 指针 / 保存 / 外观 */
const TABS = [
  { id: 'model', label: '模型服务' },
  { id: 'canvas', label: '画布' },
  { id: 'motion', label: '指针' },
  { id: 'save', label: '保存' },
  { id: 'appearance', label: '外观' },
] as const

type TabId = (typeof TABS)[number]['id']

/** 表单草稿：apiKey 留空表示保持原值 */
interface SettingsForm {
  provider: ModelProvider
  apiKey: string
  baseUrl: string
  model: string
  thinkingEnabled: boolean
  openaiApiKey: string
  openaiBaseUrl: string
  openaiModel: string
  openaiOrganization: string
  openaiProject: string
  openaiTemperatureEnabled: boolean
  openaiTemperature: number
  openaiMaxTokens: number
  openaiReasoningEffort: ReasoningEffort
  openaiTimeoutSeconds: number
  suggestionCount: number
  connectionStyle: ConnectionStyle
  doubleClickMs: number
  dragDriftDelayMs: number
  dragDriftDistance: number
  cardFontSize: number
  autosaveMinutes: number
  undoSteps: number
  themeHue: number
  edgeWidth: number
  edgeColor: string
  themeMode: ThemeMode
  timeFormat: TimeFormat
}

/** 用后端设置初始化表单（apiKey 始终留空） */
function fromSettings(data: SettingsDTO): SettingsForm {
  return {
    provider: data.provider,
    apiKey: '',
    baseUrl: data.baseUrl,
    model: data.model,
    thinkingEnabled: data.thinkingEnabled,
    openaiApiKey: '',
    openaiBaseUrl: data.openaiBaseUrl,
    openaiModel: data.openaiModel,
    openaiOrganization: data.openaiOrganization,
    openaiProject: data.openaiProject,
    openaiTemperatureEnabled: data.openaiTemperatureEnabled,
    openaiTemperature: data.openaiTemperature,
    openaiMaxTokens: data.openaiMaxTokens,
    openaiReasoningEffort: data.openaiReasoningEffort,
    openaiTimeoutSeconds: data.openaiTimeoutSeconds,
    suggestionCount: data.suggestionCount,
    connectionStyle: data.connectionStyle,
    doubleClickMs: data.doubleClickMs,
    dragDriftDelayMs: data.dragDriftDelayMs,
    dragDriftDistance: data.dragDriftDistance,
    cardFontSize: data.cardFontSize,
    autosaveMinutes: data.autosaveMinutes,
    undoSteps: data.undoSteps,
    themeHue: data.themeHue,
    edgeWidth: data.edgeWidth,
    edgeColor: data.edgeColor,
    themeMode: data.themeMode,
    timeFormat: data.timeFormat,
  }
}

/** 输入框统一样式，颜色全部取自主题令牌 */
const INPUT_CLASS =
  'w-full rounded-lg border border-subtle bg-elevated px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent'

/** 表单每一行：左侧标题与说明，右侧控件 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-[13px] font-medium text-ink">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] leading-[1.5] text-muted">{hint}</p>}
    </div>
  )
}

/** 单选项按钮组：连接方式、主题模式与时间制式共用 */
function ChoiceGroup<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={[
              'rounded-lg border px-3 py-1.5 text-[13px] transition-colors duration-150',
              option.value === value
                ? 'border-accent bg-accent-dim text-accent'
                : 'border-subtle bg-elevated text-body hover:text-ink',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Field>
  )
}

/** 设置悬浮窗：左侧选项卡栏 + 右侧内容区，保存后立即生效 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('model')
  const [settings, setSettings] = useState<SettingsDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const updatePreferences = useGraphStore((state) => state.updatePreferences)

  const [form, setForm] = useState<SettingsForm>({
    provider: 'deepseek',
    apiKey: '',
    baseUrl: '',
    model: '',
    thinkingEnabled: true,
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    openaiOrganization: '',
    openaiProject: '',
    openaiTemperatureEnabled: false,
    openaiTemperature: 1,
    openaiMaxTokens: 0,
    openaiReasoningEffort: 'default',
    openaiTimeoutSeconds: 60,
    suggestionCount: 3,
    connectionStyle: 'direct',
    doubleClickMs: 300,
    dragDriftDelayMs: 0,
    dragDriftDistance: 10,
    cardFontSize: 14,
    autosaveMinutes: 5,
    undoSteps: 10,
    themeHue: 173,
    edgeWidth: 1.5,
    edgeColor: '#3a3f4a',
    themeMode: 'system',
    timeFormat: '24h',
  })

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // 打开时拉取最新设置初始化全部表单，关闭时丢弃未保存的草稿
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setMessage('')
    setActiveTab('model')

    api
      .getSettings()
      .then((data) => {
        if (cancelled) return
        setSettings(data)
        setForm(fromSettings(data))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取设置失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      // 一次性提交全部字段，apiKey 留空表示保持原 Key
      const patch: SettingsPatch = {
        provider: form.provider,
        baseUrl: form.baseUrl,
        model: form.model,
        thinkingEnabled: form.thinkingEnabled,
        openaiBaseUrl: form.openaiBaseUrl,
        openaiModel: form.openaiModel,
        openaiOrganization: form.openaiOrganization,
        openaiProject: form.openaiProject,
        openaiTemperatureEnabled: form.openaiTemperatureEnabled,
        openaiTemperature: form.openaiTemperature,
        openaiMaxTokens: form.openaiMaxTokens,
        openaiReasoningEffort: form.openaiReasoningEffort,
        openaiTimeoutSeconds: form.openaiTimeoutSeconds,
        suggestionCount: form.suggestionCount,
        connectionStyle: form.connectionStyle,
        doubleClickMs: form.doubleClickMs,
        dragDriftDelayMs: form.dragDriftDelayMs,
        dragDriftDistance: form.dragDriftDistance,
        cardFontSize: form.cardFontSize,
        autosaveMinutes: form.autosaveMinutes,
        undoSteps: form.undoSteps,
        themeHue: form.themeHue,
        edgeWidth: form.edgeWidth,
        edgeColor: form.edgeColor,
        themeMode: form.themeMode,
        timeFormat: form.timeFormat,
      }
      if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim()
      if (form.openaiApiKey.trim()) patch.openaiApiKey = form.openaiApiKey.trim()

      // updatePreferences 内部完成提交、持久化，并立即应用主题与外观
      const data = await updatePreferences(patch)
      if (!data) {
        setError('保存失败，请稍后重试')
        return
      }
      setSettings(data)
      setForm(fromSettings(data))
      setMessage('已保存，立即生效')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const activeLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? '设置'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--bg-canvas) 72%, transparent)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="flex h-[520px] max-h-[calc(100vh-48px)] w-[780px] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-subtle bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="flex w-[168px] flex-none flex-col border-r border-subtle bg-card">
          <div className="px-4 pb-3 pt-4 text-[13px] font-semibold text-ink">设置</div>
          <nav className="flex flex-col gap-1 px-2">
            {TABS.map((tab) => {
              const active = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    'rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150',
                    active ? 'bg-accent-dim text-accent' : 'text-body hover:bg-ghost-border hover:text-ink',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-subtle px-5 py-3">
            <h2 className="text-[14px] font-semibold text-ink">{activeLabel}</h2>
            <button
              type="button"
              title="关闭设置"
              aria-label="关闭设置"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ghost-border hover:text-ink"
            >
              <X size={14} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <p className="py-6 text-center text-[13px] text-muted">正在读取设置…</p>
            ) : (
              <>
                {activeTab === 'model' && (
                  <>
                    <ChoiceGroup
                      label="服务商"
                      hint="切换后下一次问答立即生效；两个服务商的 Key 与模型各自保存，互不覆盖"
                      value={form.provider}
                      options={[
                        { value: 'deepseek', label: 'DeepSeek' },
                        { value: 'openai', label: 'OpenAI' },
                      ]}
                      onChange={(provider) => setForm({ ...form, provider })}
                    />

                    {form.provider === 'deepseek' && (
                      <>
                        <Field
                          label="DeepSeek API Key"
                          hint={
                            settings?.hasKey
                              ? `当前：${settings.apiKeyMasked}；留空保持不变`
                              : '尚未配置，填写后才能获得回答；Key 只保存在本地后端'
                          }
                        >
                          <input
                            type="password"
                            autoComplete="off"
                            value={form.apiKey}
                            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                            placeholder={settings?.hasKey ? '留空保持不变' : 'sk-…'}
                            className={INPUT_CLASS}
                          />
                        </Field>

                        <Field
                          label="接口地址"
                          hint="默认 https://api.deepseek.com，兼容其他 OpenAI 协议服务"
                        >
                          <input
                            type="text"
                            value={form.baseUrl}
                            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                            className={INPUT_CLASS}
                          />
                        </Field>

                        <Field label="模型" hint="留空会恢复为 .env 中的默认模型">
                          <input
                            type="text"
                            list="settings-model-options"
                            value={form.model}
                            onChange={(event) => setForm({ ...form, model: event.target.value })}
                            className={INPUT_CLASS}
                          />
                          <datalist id="settings-model-options">
                            <option value="deepseek-flash" />
                            <option value="deepseek-v4-pro" />
                          </datalist>
                        </Field>

                        <div className="mb-4 flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[13px] font-medium text-ink">思考模式</p>
                            <p className="mt-1 text-[12px] leading-[1.5] text-muted">
                              关闭后不再返回思考过程，回答更快、更省 Token
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={form.thinkingEnabled}
                            aria-label="思考模式"
                            onClick={() =>
                              setForm({ ...form, thinkingEnabled: !form.thinkingEnabled })
                            }
                            className={[
                              'relative mt-0.5 h-5 w-9 flex-none rounded-full border transition-colors duration-150',
                              form.thinkingEnabled
                                ? 'border-accent bg-accent-dim'
                                : 'border-subtle bg-elevated',
                            ].join(' ')}
                          >
                            <span
                              className={[
                                'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left,background-color] duration-150',
                                form.thinkingEnabled
                                  ? 'left-[18px] bg-accent'
                                  : 'left-0.5 bg-muted',
                              ].join(' ')}
                            />
                          </button>
                        </div>
                      </>
                    )}

                    {form.provider === 'openai' && (
                      <>
                        <Field
                          label="OpenAI API Key"
                          hint={
                            settings?.openaiHasKey
                              ? `当前：${settings.openaiApiKeyMasked}；留空保持不变`
                              : '尚未配置，填写后才能获得回答；Key 只保存在本地后端'
                          }
                        >
                          <input
                            type="password"
                            autoComplete="off"
                            value={form.openaiApiKey}
                            onChange={(event) =>
                              setForm({ ...form, openaiApiKey: event.target.value })
                            }
                            placeholder={settings?.openaiHasKey ? '留空保持不变' : 'sk-…'}
                            className={INPUT_CLASS}
                          />
                        </Field>

                        <Field
                          label="接口地址"
                          hint="默认 https://api.openai.com/v1，可填写兼容 OpenAI 协议的中转地址"
                        >
                          <input
                            type="text"
                            value={form.openaiBaseUrl}
                            onChange={(event) =>
                              setForm({ ...form, openaiBaseUrl: event.target.value })
                            }
                            className={INPUT_CLASS}
                          />
                        </Field>

                        <Field label="模型" hint="可手填任意模型名；留空恢复默认 gpt-4o-mini">
                          <input
                            type="text"
                            list="settings-openai-model-options"
                            value={form.openaiModel}
                            onChange={(event) =>
                              setForm({ ...form, openaiModel: event.target.value })
                            }
                            className={INPUT_CLASS}
                          />
                          <datalist id="settings-openai-model-options">
                            <option value="gpt-4o-mini" />
                            <option value="gpt-4o" />
                            <option value="gpt-4.1-mini" />
                          </datalist>
                        </Field>

                        <Field
                          label="Organization ID（可选）"
                          hint="仅 OpenAI 官方组织需要填写，留空表示不发送该请求头"
                        >
                          <input
                            type="text"
                            value={form.openaiOrganization}
                            onChange={(event) =>
                              setForm({ ...form, openaiOrganization: event.target.value })
                            }
                            className={INPUT_CLASS}
                          />
                        </Field>

                        <Field
                          label="Project ID（可选）"
                          hint="仅 OpenAI 官方项目需要填写，留空表示不发送该请求头"
                        >
                          <input
                            type="text"
                            value={form.openaiProject}
                            onChange={(event) =>
                              setForm({ ...form, openaiProject: event.target.value })
                            }
                            className={INPUT_CLASS}
                          />
                        </Field>

                        <Field
                          label="温度"
                          hint="默认不发送，由模型自行决定；推理模型可能不支持 temperature"
                        >
                          <div className="flex items-center gap-3">
                            <label className="flex flex-none items-center gap-2 text-[13px] text-body">
                              <input
                                type="checkbox"
                                checked={form.openaiTemperatureEnabled}
                                onChange={(event) =>
                                  setForm({
                                    ...form,
                                    openaiTemperatureEnabled: event.target.checked,
                                  })
                                }
                                className="h-4 w-4 accent-[var(--accent)]"
                              />
                              自定义温度
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={2}
                              step={0.1}
                              disabled={!form.openaiTemperatureEnabled}
                              value={form.openaiTemperature}
                              onChange={(event) =>
                                setForm({ ...form, openaiTemperature: Number(event.target.value) })
                              }
                              className={[
                                INPUT_CLASS,
                                'w-24',
                                'disabled:cursor-not-allowed disabled:opacity-40',
                              ].join(' ')}
                            />
                          </div>
                        </Field>

                        <Field
                          label="最大输出 tokens"
                          hint="0 表示不发送、交给模型默认；大于 0 时按 max_completion_tokens 传递"
                        >
                          <input
                            type="number"
                            min={0}
                            value={form.openaiMaxTokens}
                            onChange={(event) =>
                              setForm({ ...form, openaiMaxTokens: Number(event.target.value) })
                            }
                            className={[INPUT_CLASS, 'w-28'].join(' ')}
                          />
                        </Field>

                        <ChoiceGroup
                          label="推理强度"
                          hint="默认表示不发送该参数；仅推理模型（如 o 系列）支持"
                          value={form.openaiReasoningEffort}
                          options={[
                            { value: 'default', label: '默认' },
                            { value: 'low', label: '低' },
                            { value: 'medium', label: '中' },
                            { value: 'high', label: '高' },
                          ]}
                          onChange={(openaiReasoningEffort) =>
                            setForm({ ...form, openaiReasoningEffort })
                          }
                        />

                        <Field label="请求超时（秒）" hint="10–300，默认 60">
                          <input
                            type="number"
                            min={10}
                            max={300}
                            value={form.openaiTimeoutSeconds}
                            onChange={(event) =>
                              setForm({ ...form, openaiTimeoutSeconds: Number(event.target.value) })
                            }
                            className={[INPUT_CLASS, 'w-28'].join(' ')}
                          />
                        </Field>
                      </>
                    )}

                    <Field
                      label="候选方向数量"
                      hint="每张卡片回答完成后生成的建议箭头数量（2–6），另有 1 条自定义输入"
                    >
                      <input
                        type="number"
                        min={2}
                        max={6}
                        value={form.suggestionCount}
                        onChange={(event) =>
                          setForm({ ...form, suggestionCount: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-24'].join(' ')}
                      />
                    </Field>
                  </>
                )}

                {activeTab === 'canvas' && (
                  <ChoiceGroup
                    label="连接方式"
                    hint="只影响分支边：直接分支从父卡片上/下边中点连到子卡片，共用母线则先在右侧引出统一母线再分叉"
                    value={form.connectionStyle}
                    options={[
                      { value: 'direct', label: '直接分支' },
                      { value: 'bus', label: '共用母线' },
                    ]}
                    onChange={(connectionStyle) => setForm({ ...form, connectionStyle })}
                  />
                )}

                {activeTab === 'motion' && (
                  <>
                    <Field
                      label="双击间隔（最大，毫秒）"
                      hint="两次点击在这个间隔内算双击；默认 300，范围 100–1000"
                    >
                      <input
                        type="number"
                        min={100}
                        max={1000}
                        step={50}
                        value={form.doubleClickMs}
                        onChange={(event) =>
                          setForm({ ...form, doubleClickMs: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-28'].join(' ')}
                      />
                    </Field>

                    <Field
                      label="指针点击漂移延迟（毫秒）"
                      hint="按下后等待多久开始检测晃动；默认 0，范围 0–500"
                    >
                      <input
                        type="number"
                        min={0}
                        max={500}
                        step={10}
                        value={form.dragDriftDelayMs}
                        onChange={(event) =>
                          setForm({ ...form, dragDriftDelayMs: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-28'].join(' ')}
                      />
                    </Field>

                    <Field
                      label="指针点击漂移（距离，px）"
                      hint="超过该距离视为拖动，否则视为点击；默认 10，范围 0–50"
                    >
                      <input
                        type="number"
                        min={0}
                        max={50}
                        step={1}
                        value={form.dragDriftDistance}
                        onChange={(event) =>
                          setForm({ ...form, dragDriftDistance: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-28'].join(' ')}
                      />
                    </Field>
                  </>
                )}

                {activeTab === 'save' && (
                  <>
                    <Field label="自动保存间隔（分钟）" hint="默认 5 分钟；填写 0 表示关闭自动保存">
                      <input
                        type="number"
                        min={0}
                        value={form.autosaveMinutes}
                        onChange={(event) =>
                          setForm({ ...form, autosaveMinutes: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-24'].join(' ')}
                      />
                    </Field>

                    <Field label="撤销步数" hint="每张画布可回退的步数，默认 10，最小 1">
                      <input
                        type="number"
                        min={1}
                        value={form.undoSteps}
                        onChange={(event) =>
                          setForm({ ...form, undoSteps: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-24'].join(' ')}
                      />
                    </Field>
                  </>
                )}

                {activeTab === 'appearance' && (
                  <>
                    <ChoiceGroup
                      label="主题模式"
                      hint="跟随系统时，会随 Windows 深浅色设置实时切换"
                      value={form.themeMode}
                      options={[
                        { value: 'system', label: '跟随系统' },
                        { value: 'light', label: '浅色' },
                        { value: 'dark', label: '深色' },
                      ]}
                      onChange={(themeMode) => setForm({ ...form, themeMode })}
                    />

                    <Field
                      label="正文字号"
                      hint="12–24，默认 14；字号变大时卡片会自动放大，调小不会缩回"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={12}
                          max={24}
                          step={1}
                          value={form.cardFontSize}
                          onChange={(event) =>
                            setForm({ ...form, cardFontSize: Number(event.target.value) })
                          }
                          className="flex-1"
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <input
                          type="number"
                          min={12}
                          max={24}
                          step={1}
                          value={form.cardFontSize}
                          onChange={(event) =>
                            setForm({ ...form, cardFontSize: Number(event.target.value) })
                          }
                          className={[INPUT_CLASS, 'w-20 flex-none'].join(' ')}
                        />
                      </div>
                    </Field>

                    <Field label="主题色相" hint="0–360，默认 173（青色）；强调色由此色相派生">
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={360}
                          value={form.themeHue}
                          onChange={(event) =>
                            setForm({ ...form, themeHue: Number(event.target.value) })
                          }
                          className="flex-1"
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <input
                          type="number"
                          min={0}
                          max={360}
                          value={form.themeHue}
                          onChange={(event) =>
                            setForm({ ...form, themeHue: Number(event.target.value) })
                          }
                          className={[INPUT_CLASS, 'w-20 flex-none'].join(' ')}
                        />
                      </div>
                    </Field>

                    <Field label="连线粗细" hint="0.5–6，步长 0.5">
                      <input
                        type="number"
                        min={0.5}
                        max={6}
                        step={0.5}
                        value={form.edgeWidth}
                        onChange={(event) =>
                          setForm({ ...form, edgeWidth: Number(event.target.value) })
                        }
                        className={[INPUT_CLASS, 'w-24'].join(' ')}
                      />
                    </Field>

                    <Field label="连线颜色" hint="所有逻辑线统一使用该颜色">
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={form.edgeColor}
                          onChange={(event) => setForm({ ...form, edgeColor: event.target.value })}
                          className="h-9 w-14 flex-none cursor-pointer rounded-lg border border-subtle bg-elevated p-1"
                        />
                        <span className="text-[12px] tabular-nums text-muted">{form.edgeColor}</span>
                      </div>
                    </Field>

                    <ChoiceGroup
                      label="时间制式"
                      hint="卡片修改时间按此制式显示"
                      value={form.timeFormat}
                      options={[
                        { value: '24h', label: '24 小时制' },
                        { value: '12h', label: '12 小时制' },
                      ]}
                      onChange={(timeFormat) => setForm({ ...form, timeFormat })}
                    />
                  </>
                )}
              </>
            )}
          </div>

          <footer className="flex items-center justify-between gap-4 border-t border-subtle px-5 py-3">
            <p
              className={['min-w-0 break-words text-[12px]', error ? 'text-danger' : 'text-muted'].join(
                ' ',
              )}
            >
              {error || message || '保存后立即生效，设置会持久化到本地后端'}
            </p>
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void save()}
              className="flex-none rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}
