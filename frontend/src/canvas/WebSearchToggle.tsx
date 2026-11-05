import { Globe } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'

/**
 * 联网搜索快捷开关：读取并写入全局偏好，与顶部工具栏按钮共用同一字段，
 * 两处状态自动同步；仅 DeepSeek 服务商支持。
 */
export function WebSearchToggle() {
  const provider = useGraphStore((state) => state.preferences.provider)
  const enabled = useGraphStore((state) => state.preferences.webSearchEnabled)
  const updatePreferences = useGraphStore((state) => state.updatePreferences)

  const disabled = provider !== 'deepseek'

  const toggle = async () => {
    if (disabled) return
    try {
      await updatePreferences({ webSearchEnabled: !enabled })
    } catch (err) {
      // store 已回滚，这里只告警
      console.warn('切换联网搜索失败', err)
    }
  }

  return (
    <button
      type="button"
      title={disabled ? '仅支持 DeepSeek API' : '联网搜索'}
      aria-label="联网搜索"
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
      <Globe size={14} />
    </button>
  )
}
