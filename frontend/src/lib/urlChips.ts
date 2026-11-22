/** 输入框中链接胶囊的解析与移除工具（规则与后端 backend/app/services/urls.py 保持一致） */

/** 单条消息最多携带的链接数，与后端提取上限一致 */
export const MAX_URLS = 10

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

/**
 * 把文本中已写完整的链接抽出来：返回移除链接后的文本与新发现的链接。
 * 重复出现的同一链接会被全部移除，避免输入框里残留。
 */
export function splitUrls(text: string, limit = MAX_URLS): { text: string; urls: string[] } {
  if (!text) return { text: '', urls: [] }
  const urls = extractUrls(text, limit)
  let rest = text
  for (const url of urls) {
    while (rest.includes(url)) {
      const next = removeUrl(rest, url)
      if (next === rest) break
      rest = next
    }
  }
  // 移除链接后可能留下连续空行，压缩为最多一个空行
  rest = rest.replace(/\n{3,}/g, '\n\n')
  return { text: rest, urls }
}

/** 合并链接列表：保持顺序、去重、最多 limit 个 */
export function mergeUrls(current: string[], incoming: string[], limit = MAX_URLS): string[] {
  const merged = [...current]
  for (const url of incoming) {
    if (!url || merged.includes(url)) continue
    merged.push(url)
    if (merged.length >= limit) break
  }
  return merged
}

/**
 * 生成提交用的完整问题：正文在前，链接按胶囊编号顺序各占一行追加到末尾。
 * 后端只识别最后一条用户消息中的链接，因此链接必须跟着问题一起提交。
 */
export function composeWithUrls(text: string, urls: string[]): string {
  const body = text.trim()
  if (urls.length === 0) return body
  return [body, ...urls].filter(Boolean).join('\n')
}

/**
 * 编辑胶囊里的链接：新值仍须是合法链接（按提取规则归一化），
 * 替换后保持原编号顺序并去重；新值非法时原样返回。
 */
export function replaceUrl(urls: string[], oldUrl: string, raw: string): string[] {
  const [next] = extractUrls(raw, 1)
  if (!next) return urls
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of urls) {
    const value = item === oldUrl ? next : item
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
