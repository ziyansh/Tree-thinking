import type { ReactNode } from 'react'

/** 转义正则特殊字符：用户输入按字面量匹配，不当作正则 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 把文本按关键词切分并高亮命中片段；关键词为空时原样返回 */
export function highlightText(
  text: string,
  query: string,
  markClassName = 'rounded-sm bg-accent-dim px-0.5 text-accent',
): ReactNode {
  const term = query.trim()
  if (!term) return text
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'))
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? (
      <mark key={index} className={markClassName}>
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  )
}
