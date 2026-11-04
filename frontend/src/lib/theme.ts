import type { ThemeMode } from '../api/types'

/** 解析后的实际主题（跟随系统会先解析成浅色或深色） */
export type ResolvedTheme = 'light' | 'dark'

/** 画布点阵颜色，取值与 theme.css 中的 --dot-color 保持一致 */
export const DOT_COLORS: Record<ResolvedTheme, string> = {
  dark: '#1a1c22',
  light: '#d5d7dd',
}

/** 运行时外观需要的设置字段 */
export interface ThemePreferences {
  themeMode: ThemeMode
  themeHue: number
  edgeColor: string
  /** 卡片正文字号（px） */
  cardFontSize: number
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 把主题模式解析为实际生效的浅色 / 深色 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 系统深浅色监听的清理函数（切换模式时先摘掉旧监听，避免重复绑定） */
let stopSystemWatch: (() => void) | null = null

/** 应用主题：写入 html[data-theme]、主题色相与连线颜色；跟随系统时实时切换 */
export function applyTheme(preferences: ThemePreferences): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(preferences.themeMode)
  // 强调色由 CSS 里的 hsl(var(--theme-hue) ...) 派生，这里只改色相
  root.style.setProperty('--theme-hue', String(preferences.themeHue))
  root.style.setProperty('--edge', preferences.edgeColor)
  // 卡片正文字号：卡片内文字统一取该变量
  root.style.setProperty('--card-font-size', `${preferences.cardFontSize || 14}px`)

  stopSystemWatch?.()
  stopSystemWatch = null
  if (preferences.themeMode !== 'system') return

  const query = window.matchMedia(DARK_QUERY)
  const onChange = () => {
    root.dataset.theme = query.matches ? 'dark' : 'light'
  }
  query.addEventListener('change', onChange)
  stopSystemWatch = () => query.removeEventListener('change', onChange)
}
