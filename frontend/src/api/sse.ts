import { isMock, mockStreamAnswer } from './mock'
import type { SourceDTO, SuggestionDTO } from './types'

/** 流式回答的回调集合 */
export interface StreamHandlers {
  onSources?: (list: SourceDTO[]) => void
  onReasoning?: (text: string) => void
  onDelta?: (text: string) => void
  onSuggestions?: (list: SuggestionDTO[]) => void
  onDone?: (usage?: unknown) => void
  onError?: (message: string) => void
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'AbortError'
}

/** 尝试把 data 解析成 JSON，失败返回 undefined */
function parseJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/** 兼容两类建议下发格式：[{id,text,...}] 或 {suggestions:[...]} */
function parseSuggestions(data: string): SuggestionDTO[] | null {
  const parsed = parseJson(data)
  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
      ? (parsed as { suggestions: unknown[] }).suggestions
      : null
  if (!items) return null
  return items.map((item, index) => {
    if (typeof item === 'string') return { id: `suggestion-${index}`, text: item }
    const record = item as { id?: unknown; text?: unknown }
    return {
      id: typeof record.id === 'string' ? record.id : `suggestion-${index}`,
      text: typeof record.text === 'string' ? record.text : String(record.text ?? ''),
    }
  })
}

/**
 * 兼容两类来源下发格式：[{...}] 或 {sources:[...]}，
 * 字段缺失时用空串 / null 补齐，避免前端渲染时判空。
 */
function parseSources(data: string): SourceDTO[] | null {
  const parsed = parseJson(data)
  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { sources?: unknown }).sources)
      ? (parsed as { sources: unknown[] }).sources
      : null
  if (!items) return null
  return items.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>
    return {
      title: typeof record.title === 'string' ? record.title : String(record.title ?? ''),
      url: typeof record.url === 'string' ? record.url : String(record.url ?? ''),
      snippet: typeof record.snippet === 'string' ? record.snippet : '',
      summary: typeof record.summary === 'string' ? record.summary : '',
      siteName: typeof record.siteName === 'string' ? record.siteName : null,
      date: typeof record.date === 'string' ? record.date : null,
    }
  })
}

/**
 * 取出事件正文：后端 reasoning / delta 事件下发 {"text": "..."}，
 * 也兼容直接下发纯文本（例如 Mock 或其它实现）。
 */
function parseTextPayload(data: string): string {
  const parsed = parseJson(data)
  if (typeof parsed === 'string') return parsed
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { text?: unknown }).text === 'string'
  ) {
    return (parsed as { text: string }).text
  }
  return data
}

/** error 事件的 data 可能是纯文本，也可能是 {detail|message: '...'} */
function extractErrorMessage(data: string): string {
  const parsed = parseJson(data)
  if (typeof parsed === 'string') return parsed
  if (typeof parsed === 'object' && parsed !== null && 'detail' in parsed) {
    return String((parsed as { detail: unknown }).detail)
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { message?: unknown }).message === 'string'
  ) {
    return (parsed as { message: string }).message
  }
  return data || '回答生成失败，请重试'
}

/**
 * 解析一个完整 SSE 事件块（以空行分隔）。
 * 返回 true 表示流已结束（收到 done 或 error）。
 */
function dispatchEvent(rawEvent: string, handlers: StreamHandlers): boolean {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of rawEvent.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }

  if (dataLines.length === 0) return false
  const data = dataLines.join('\n')

  switch (event) {
    case 'sources': {
      // 来源在正文增量之前下发，解析失败时忽略，不中断回答
      const list = parseSources(data)
      if (list) handlers.onSources?.(list)
      return false
    }
    case 'reasoning':
      handlers.onReasoning?.(parseTextPayload(data))
      return false
    case 'delta':
      handlers.onDelta?.(parseTextPayload(data))
      return false
    case 'suggestions': {
      const list = parseSuggestions(data)
      if (list) handlers.onSuggestions?.(list)
      return false
    }
    case 'done':
      handlers.onDone?.(parseJson(data))
      return true
    case 'error':
      handlers.onError?.(extractErrorMessage(data))
      return true
    default:
      // 后端若直接下发纯文本 data（未带 event），按正文增量处理
      handlers.onDelta?.(parseTextPayload(data))
      return false
  }
}

/**
 * 调用 POST /api/nodes/{id}/answer 并逐行解析 SSE。
 * Mock 模式下自动改走本地定时器模拟，调用方无需区分。
 */
export async function streamAnswer(
  nodeId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (isMock()) {
    await mockStreamAnswer(nodeId, handlers, signal)
    return
  }

  let res: Response
  try {
    res = await fetch(`/api/nodes/${nodeId}/answer`, { method: 'POST', signal })
  } catch (err) {
    if (isAbortError(err)) return
    handlers.onError?.('无法连接后端服务，请确认后端已启动')
    return
  }

  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      // 保留默认文案
    }
    handlers.onError?.(message)
    return
  }

  if (!res.body) {
    handlers.onError?.('没有收到流式响应')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 统一换行符，保证按空行切分事件块
      buffer = buffer.replace(/\r\n/g, '\n')

      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        if (dispatchEvent(rawEvent, handlers)) {
          await reader.cancel()
          return
        }
        separator = buffer.indexOf('\n\n')
      }
    }
    // 处理最后一个未以空行结尾的事件块
    buffer += decoder.decode()
    if (buffer.trim()) dispatchEvent(buffer, handlers)
  } catch (err) {
    if (!isAbortError(err)) handlers.onError?.('流式连接中断，请重试')
  }
}
