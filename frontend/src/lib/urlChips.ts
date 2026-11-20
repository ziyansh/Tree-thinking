/** 输入框中链接胶囊的解析与移除工具（规则与后端 backend/app/services/urls.py 保持一致） */

/** 裸域名只在这些常见顶级域名下视为链接，避免把普通文字或数字误判成网址 */
const TLDS =
  'com|cn|org|net|io|dev|ai|co|edu|gov|info|me|app|xyz|top|cc|tv|tech|site|online|store|wiki'

/** URL 正文允许的字符：排除空白、中文/全角标点与引号，防止把后续中文吞进链接 */
const BODY = '[^\\s\\u3000-\\u303f\\u2018-\\u201d\\u2026\\u4e00-\\u9fff\\uff00-\\uffef<>"\'\\u0060]'

/** 带协议的链接，或无协议的裸域名（如 github.com/owner/repo、www.example.com/page） */
const URL_PATTERN = new RegExp(
  `https?:\\/\\/${BODY}+` +
    `|(?<![@A-Za-z0-9_])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+(?:${TLDS})` +
    `(?![A-Za-z0-9-])(?::\\d{1,5})?(?:[/?#]${BODY}*)?`,
  'gi',
)

/** 链接尾部可能粘连的标点（中英文都要处理） */
const TRAILING = '.,;:!?，。；：！？、)）》】"\'}]'

/** 去掉链接末尾的标点，可能连续多个（如 `）。`） */
function stripTrailing(text: string): string {
  let end = text.length
  while (end > 0 && TRAILING.includes(text[end - 1])) end -= 1
  return text.slice(0, end)
}

/**
 * 按出现顺序提取文本中的链接：去尾部标点、重复只保留首次，最多 limit 个。
 */
export function extractUrls(text: string, limit = 10): string[] {
  if (!text) return []
  const found: string[] = []
  const seen = new Set<string>()
  URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const url = stripTrailing(match[0])
    if (!url || seen.has(url)) continue
    seen.add(url)
    found.push(url)
    if (found.length >= limit) break
  }
  return found
}

/**
 * 从文本中移除指定链接的第一次出现：连同相邻的一个空格一起清理，
 * 若移除后整行只剩空白，则去掉该空行。
 */
export function removeUrl(text: string, url: string): string {
  const start = text.indexOf(url)
  if (start < 0) return text
  let end = start + url.length
  let from = start

  const beforeSpace = start > 0 && text[start - 1] === ' '
  const afterSpace = text[end] === ' '

  if (beforeSpace && afterSpace) {
    // 两侧都有空格：吃掉右侧空格，保留左侧作为分隔
    end += 1
  } else if (beforeSpace) {
    // 只在前侧有空格：一起吃掉（常见于行尾）
    from -= 1
  } else if (afterSpace) {
    end += 1
  }

  const result = text.slice(0, from) + text.slice(end)
  // 计算被修改的行，整行只剩空白时删除该行
  const lineIndex = text.slice(0, from).split('\n').length - 1
  const lines = result.split('\n')
  if (lines[lineIndex] !== undefined && lines[lineIndex].trim() === '') {
    lines.splice(lineIndex, 1)
    return lines.join('\n')
  }
  return result
}
