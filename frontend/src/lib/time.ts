import type { TimeFormat } from '../api/types'

/** 补零到两位，保证日期与时间各段宽度一致 */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 格式化卡片的修改时间：按本地时区输出 `yyyy-mm-dd hh:mm`；
 * 12 小时制把小时转成 12 制（0 点显示为 12），并追加 AM / PM。
 * 无值或无法解析时返回空串，调用方据此决定是否渲染。
 */
export function formatModifiedTime(iso: string | undefined, format: TimeFormat): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const minutes = pad(date.getMinutes())

  if (format === '12h') {
    const period = date.getHours() < 12 ? 'AM' : 'PM'
    // 0 点与 12 点都显示 12，其余按 12 小时制取余
    const hour12 = date.getHours() % 12 || 12
    return `${year}-${month}-${day} ${pad(hour12)}:${minutes} ${period}`
  }

  return `${year}-${month}-${day} ${pad(date.getHours())}:${minutes}`
}
