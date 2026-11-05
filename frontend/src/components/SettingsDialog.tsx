import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { RotateCcw, X } from 'lucide-react'
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

/** 选项卡：模型服务 / 画布（含保存） / 外观 */
const TABS = [
  { id: 'model', label: '模型服务' },
  { id: 'canvas', label: '画布' },
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
  cardGap: number
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
    cardGap: data.cardGap,
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

/** 文本输入统一样式，宽度由外层容器限制在 380px 内 */
const INPUT_CLASS =
  'rounded-lg border border-subtle bg-elevated px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent'

/** 数值归一化：空值还原、整数截断、按 step 四舍五入，最后夹到 [min,max] */
function normalizeNumber(
  raw: string,
  fallback: number,
  min: number,
  max?: number,
  step?: number,
): number {
  const parsed = raw.trim() === '' ? Number.NaN : Number(raw)
  let next = Number.isFinite(parsed) ? parsed : fallback
  if (step === undefined || Number.isInteger(step)) {
    next = Math.trunc(next)
  } else {
    const factor = Math.round(1 / step)
    next = Math.round(next * factor) / factor
  }
  if (max !== undefined) next = Math.min(max, next)
  return Math.max(min, next)
}

/** 数字输入框：编辑时保留草稿，失焦时归一化并提交 */
function NumberBox({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  className,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
}) {
  // draft 为 null 时直接展示外部值，编辑期间保留用户输入
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? String(value)

  const commit = () => {
    const next = normalizeNumber(display, value, min, max, step)
    setDraft(null)
    onChange(next)
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={display}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      className={className}
    />
  )
}

/** 滑块 + 数字框：两者共用同一归一化提交逻辑 */
function SliderNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-subtle bg-elevated px-2.5 py-1.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(normalizeNumber(event.target.value, value, min, max, step))}
        className="w-[140px] flex-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        style={{ accentColor: 'var(--accent)' }}
      />
      <NumberBox
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-[66px] rounded-md border border-strong bg-canvas px-2 py-1 text-center text-[13px] text-ink outline-none transition-colors duration-150 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  )
}

/** 仅数字框：同样使用胶囊容器 */
function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max?: number
  step?: number
}) {
  return (
    <div className="flex w-[110px] items-center rounded-lg border border-subtle bg-elevated px-2.5 py-1.5">
      <NumberBox
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        className="w-full rounded-md border border-strong bg-canvas px-2 py-1 text-center text-[13px] text-ink outline-none transition-colors duration-150 focus:border-accent"
      />
    </div>
  )
}

/** 下拉框：原生 select，宽度 200px，不占整行 */
function SelectRow<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={`${INPUT_CLASS} w-[200px] cursor-pointer`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** 单选项按钮组：连接方式、推理强度、主题模式与时间制式共用 */
function ChoiceGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
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
  )
}

/** 开关：沿用原有 toggle 样式 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-5 w-9 flex-none rounded-full border transition-colors duration-150',
        checked ? 'border-accent bg-accent-dim' : 'border-subtle bg-elevated',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left,background-color] duration-150',
          checked ? 'left-[18px] bg-accent' : 'left-0.5 bg-muted',
        ].join(' ')}
      />
    </button>
  )
}

/** 主题色相滑块：彩虹轨道 + 数值徽标 + 恢复默认；拖动时实时预览 */
function HueSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  // 预览期间直接改 CSS 变量；组件卸载（关闭设置）时恢复为已保存的色相
  useEffect(() => {
    document.documentElement.style.setProperty('--theme-hue', String(value))
    return () => {
      const saved = useGraphStore.getState().preferences.themeHue
      document.documentElement.style.setProperty('--theme-hue', String(saved))
    }
  }, [value])

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={value}
        onChange={(event) => onChange(normalizeNumber(event.target.value, value, 0, 360, 1))}
        className="hue-slider w-[150px] flex-none cursor-pointer"
      />
      <span className="flex h-8 w-[56px] flex-none items-center justify-center rounded-lg border border-subtle bg-elevated text-[13px] tabular-nums text-ink">
        {value}
      </span>
      <button
        type="button"
        title="恢复默认色相 173"
        aria-label="恢复默认色相"
        onClick={() => onChange(173)}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-subtle bg-elevated text-muted transition-colors duration-150 hover:text-ink"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  )
}

/** 二级标题：同一选项卡内用分区组织 */
function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="mt-8 first:mt-0">
      <h3 className="mb-2 text-[15px] font-semibold text-ink">{title}</h3>
      {hint && <p className="mb-2 text-[13px] leading-[1.55] text-muted">{hint}</p>}
      {children}
    </section>
  )
}

/** 设置行：左侧标题与说明，右侧控件；最后一行不画分隔线 */
function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-subtle py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[13px] leading-[1.55] text-muted">{hint}</p>}
      </div>
      <div className="flex w-[380px] max-w-[46%] flex-none justify-end">{children}</div>
    </div>
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
    cardGap: 80,
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
        cardGap: form.cardGap,
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
    } catch (err) {
      // 后端 detail 会作为 Error.message 抛出；保留表单便于用户修改后重试
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试')
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
        className="flex h-[760px] w-[1040px] max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-subtle bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="flex w-[200px] flex-none flex-col border-r border-subtle bg-card">
          <div className="px-5 pb-3 pt-5 text-[16px] font-semibold text-ink">设置</div>
          <nav className="flex flex-col gap-1 px-2">
            {TABS.map((tab) => {
              const active = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    'rounded-lg px-3 py-2.5 text-left text-[14px] transition-colors duration-150',
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
          <header className="flex items-center justify-between border-b border-subtle px-8 py-3.5">
            <h2 className="text-[16px] font-semibold text-ink">{activeLabel}</h2>
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

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {loading ? (
              <p className="py-6 text-center text-[14px] text-muted">正在读取设置…</p>
            ) : (
              <>
                {activeTab === 'model' && (
                  <>
                    <Section title="服务商与连接">
                      <Row
                        label="服务商"
                        hint="OpenAI 兼容可填写任意兼容 OpenAI 协议的服务（官方 OpenAI、中转、OpenRouter、Moonshot 等）"
                      >
                        <SelectRow
                          ariaLabel="服务商"
                          value={form.provider}
                          options={[
                            { value: 'deepseek', label: 'DeepSeek' },
                            { value: 'openai', label: 'OpenAI 兼容' },
                          ]}
                          onChange={(provider) => setForm({ ...form, provider })}
                        />
                      </Row>
                    </Section>

                    {form.provider === 'deepseek' && (
                      <Section title="DeepSeek 参数">
                        <Row
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
                            placeholder={settings?.hasKey ? '留空保持不变' : '填写 DeepSeek API Key'}
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>

                        <Row label="接口地址" hint="默认 https://api.deepseek.com，兼容其他 OpenAI 协议服务">
                          <input
                            type="text"
                            value={form.baseUrl}
                            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>

                        <Row label="模型" hint="留空会恢复为 .env 中的默认模型">
                          <input
                            type="text"
                            list="settings-model-options"
                            value={form.model}
                            onChange={(event) => setForm({ ...form, model: event.target.value })}
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>
                        <datalist id="settings-model-options">
                          <option value="deepseek-flash" />
                          <option value="deepseek-v4-pro" />
                        </datalist>

                        <Row label="思考模式" hint="关闭后不再返回思考过程，回答更快、更省 Token">
                          <Toggle
                            label="思考模式"
                            checked={form.thinkingEnabled}
                            onChange={(thinkingEnabled) => setForm({ ...form, thinkingEnabled })}
                          />
                        </Row>
                      </Section>
                    )}

                    {form.provider === 'openai' && (
                      <Section title="OpenAI 兼容参数">
                        <Row
                          label="API Key"
                          hint={
                            settings?.openaiHasKey
                              ? `当前：${settings.openaiApiKeyMasked}；留空保持不变`
                              : '兼容任意 OpenAI 协议服务（官方 OpenAI、中转、OpenRouter、Moonshot 等），Key 只保存在本地后端'
                          }
                        >
                          <input
                            type="password"
                            autoComplete="off"
                            value={form.openaiApiKey}
                            onChange={(event) =>
                              setForm({ ...form, openaiApiKey: event.target.value })
                            }
                            placeholder={
                              settings?.openaiHasKey ? '留空保持不变' : '填写服务商提供的 API Key'
                            }
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>

                        <Row label="接口地址" hint="默认 https://api.openai.com/v1，可填写兼容 OpenAI 协议的中转地址">
                          <input
                            type="text"
                            value={form.openaiBaseUrl}
                            onChange={(event) =>
                              setForm({ ...form, openaiBaseUrl: event.target.value })
                            }
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>

                        <Row label="模型" hint="可手填任意模型名；留空恢复默认 gpt-4o-mini">
                          <input
                            type="text"
                            list="settings-openai-model-options"
                            value={form.openaiModel}
                            onChange={(event) =>
                              setForm({ ...form, openaiModel: event.target.value })
                            }
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>
                        <datalist id="settings-openai-model-options">
                          <option value="gpt-4o-mini" />
                          <option value="gpt-4o" />
                          <option value="gpt-4.1-mini" />
                        </datalist>

                        <Row label="Organization ID（可选）" hint="仅 OpenAI 官方组织需要填写，留空表示不发送该请求头">
                          <input
                            type="text"
                            value={form.openaiOrganization}
                            onChange={(event) =>
                              setForm({ ...form, openaiOrganization: event.target.value })
                            }
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>

                        <Row label="Project ID（可选）" hint="留空不发送">
                          <input
                            type="text"
                            value={form.openaiProject}
                            onChange={(event) =>
                              setForm({ ...form, openaiProject: event.target.value })
                            }
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </Row>

                        <Row label="温度" hint="默认不发送，由模型自行决定；推理模型可能不支持 temperature">
                          <div className="flex items-center gap-3">
                            <Toggle
                              label="自定义温度"
                              checked={form.openaiTemperatureEnabled}
                              onChange={(openaiTemperatureEnabled) =>
                                setForm({ ...form, openaiTemperatureEnabled })
                              }
                            />
                            <SliderNumber
                              value={form.openaiTemperature}
                              onChange={(openaiTemperature) =>
                                setForm({ ...form, openaiTemperature })
                              }
                              min={0}
                              max={2}
                              step={0.1}
                              disabled={!form.openaiTemperatureEnabled}
                            />
                          </div>
                        </Row>

                        <Row label="最大输出 tokens" hint="0 表示不发送；大于 0 时按 max_completion_tokens 传递">
                          <NumberInput
                            value={form.openaiMaxTokens}
                            onChange={(openaiMaxTokens) => setForm({ ...form, openaiMaxTokens })}
                            min={0}
                            max={999999}
                            step={1}
                          />
                        </Row>

                        <Row label="推理强度" hint="默认表示不发送该参数；仅推理模型（如 o 系列）支持">
                          <ChoiceGroup
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
                        </Row>

                        <Row label="请求超时" hint="10–300 秒，默认 60">
                          <SliderNumber
                            value={form.openaiTimeoutSeconds}
                            onChange={(openaiTimeoutSeconds) =>
                              setForm({ ...form, openaiTimeoutSeconds })
                            }
                            min={10}
                            max={300}
                          />
                        </Row>
                      </Section>
                    )}

                    <Section title="通用">
                      <Row label="候选方向数量" hint="每张卡片回答完成后生成的建议箭头数量（2–6），另有 1 条自定义输入">
                        <SliderNumber
                          value={form.suggestionCount}
                          onChange={(suggestionCount) => setForm({ ...form, suggestionCount })}
                          min={2}
                          max={6}
                        />
                      </Row>
                    </Section>
                  </>
                )}

                {activeTab === 'canvas' && (
                  <>
                    <Section title="布局">
                      <Row
                        label="连接方式"
                        hint="直接分支从父卡片上/下边中点连到子卡片；共用母线由全部子分支共享一条母线"
                      >
                        <ChoiceGroup
                          value={form.connectionStyle}
                          options={[
                            { value: 'direct', label: '直接分支' },
                            { value: 'bus', label: '共用母线' },
                          ]}
                          onChange={(connectionStyle) => setForm({ ...form, connectionStyle })}
                        />
                      </Row>

                      <Row label="卡片间距" hint="新建子卡片与自动整理共用；默认 80，范围 16–1200">
                        <SliderNumber
                          value={form.cardGap}
                          onChange={(cardGap) => setForm({ ...form, cardGap })}
                          min={16}
                          max={1200}
                          step={1}
                        />
                      </Row>
                    </Section>

                    <Section title="指针">
                      <Row label="双击间隔" hint="两次点击在该间隔内算双击；默认 300，范围 100–1000">
                        <SliderNumber
                          value={form.doubleClickMs}
                          onChange={(doubleClickMs) => setForm({ ...form, doubleClickMs })}
                          min={100}
                          max={1000}
                          step={50}
                        />
                      </Row>

                      <Row label="指针点击漂移延迟" hint="按下后等待多久开始检测晃动；默认 0，范围 0–500">
                        <SliderNumber
                          value={form.dragDriftDelayMs}
                          onChange={(dragDriftDelayMs) => setForm({ ...form, dragDriftDelayMs })}
                          min={0}
                          max={500}
                          step={10}
                        />
                      </Row>

                      <Row label="指针点击漂移距离" hint="超过该距离视为拖动，否则视为点击；默认 10，范围 0–50">
                        <SliderNumber
                          value={form.dragDriftDistance}
                          onChange={(dragDriftDistance) => setForm({ ...form, dragDriftDistance })}
                          min={0}
                          max={50}
                          step={1}
                        />
                      </Row>
                    </Section>

                    <Section title="保存">
                      <Row label="自动保存间隔" hint="分钟；默认 5，填写 0 表示关闭自动保存">
                        <NumberInput
                          value={form.autosaveMinutes}
                          onChange={(autosaveMinutes) => setForm({ ...form, autosaveMinutes })}
                          min={0}
                          step={1}
                        />
                      </Row>

                      <Row label="撤销步数" hint="每张画布可回退的步数，默认 10，最小 1">
                        <NumberInput
                          value={form.undoSteps}
                          onChange={(undoSteps) => setForm({ ...form, undoSteps })}
                          min={1}
                          step={1}
                        />
                      </Row>
                    </Section>
                  </>
                )}

                {activeTab === 'appearance' && (
                  <>
                    <Section title="主题">
                      <Row label="主题模式" hint="跟随系统时，会随 Windows 深浅色设置实时切换">
                        <ChoiceGroup
                          value={form.themeMode}
                          options={[
                            { value: 'system', label: '跟随系统' },
                            { value: 'light', label: '浅色' },
                            { value: 'dark', label: '深色' },
                          ]}
                          onChange={(themeMode) => setForm({ ...form, themeMode })}
                        />
                      </Row>

                      <Row label="主题色相" hint="0–360，默认 173（青色）；强调色由此色相派生">
                        <HueSlider
                          value={form.themeHue}
                          onChange={(themeHue) => setForm({ ...form, themeHue })}
                        />
                      </Row>
                    </Section>

                    <Section title="卡片">
                      <Row label="正文字号" hint="12–24，默认 14；字号变大时卡片会自动放大，调小不会缩回">
                        <SliderNumber
                          value={form.cardFontSize}
                          onChange={(cardFontSize) => setForm({ ...form, cardFontSize })}
                          min={12}
                          max={24}
                          step={1}
                        />
                      </Row>
                    </Section>

                    <Section title="连线">
                      <Row label="连线粗细" hint="0.5–6，步长 0.5">
                        <SliderNumber
                          value={form.edgeWidth}
                          onChange={(edgeWidth) => setForm({ ...form, edgeWidth })}
                          min={0.5}
                          max={6}
                          step={0.5}
                        />
                      </Row>

                      <Row label="连线颜色" hint="所有逻辑线统一使用该颜色">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            aria-label="连线颜色"
                            value={form.edgeColor}
                            onChange={(event) => setForm({ ...form, edgeColor: event.target.value })}
                            className="h-8 w-12 flex-none cursor-pointer rounded-lg border border-subtle bg-elevated p-1"
                          />
                          <input
                            type="text"
                            value={form.edgeColor}
                            onChange={(event) => setForm({ ...form, edgeColor: event.target.value })}
                            className={`${INPUT_CLASS} w-[110px]`}
                          />
                        </div>
                      </Row>
                    </Section>

                    <Section title="时间">
                      <Row label="时间制式" hint="卡片修改时间按此制式显示">
                        <ChoiceGroup
                          value={form.timeFormat}
                          options={[
                            { value: '24h', label: '24 小时制' },
                            { value: '12h', label: '12 小时制' },
                          ]}
                          onChange={(timeFormat) => setForm({ ...form, timeFormat })}
                        />
                      </Row>
                    </Section>
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
