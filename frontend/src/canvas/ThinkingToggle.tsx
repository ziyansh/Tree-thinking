import { Brain } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'

/**
 * 深度思考快捷开关：与顶部工具栏、设置里的「思考模式」共用同一字段，
 * 任一入口切换后其余入口自动同步；DeepSeek 与火山方舟支持。
 */
export function ThinkingToggle() {
  const provider = useGraphStore((state) => state.preferences.provider)
  const enabled = useGraphStore((state) => state.preferences.thinkingEnabled)
  const updatePreferences = useGraphStore((state) => state.updatePreferences)

  const disabled = provider !== 'deepseek' && provider !== 'ark'

  const toggle = async () => {
    if (disabled) return
    try {
      await updatePreferences({ thinkingEnabled: !enabled })
    } catch (err) {
      // store 已回滚，这里只告警
      console.warn('切换思考模式失败', err)
    }
  }

  return (
    <button
      type="button"
      title={disabled ? '仅 DeepSeek 与火山方舟支持' : '深度思考'}
      aria-label="深度思考"
      aria-pressed={enabled}
      aria-disabled={disabled}
      onClick={() => void toggle()}
      className={[
        'nodrag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
        disabled
          ? 'cursor-not-allowed text-muted opacity-40'
          : enabled
            ? 'bg-accent-dim text-accent'
            : 'text-muted hover:bg-ghost-border hover:text-ink',
      ].join(' ')}
    >
      <Brain size={14} />
    </button>
  )
}
