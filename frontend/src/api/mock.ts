import type { ApiClient } from './client'
import type { StreamHandlers } from './sse'
import type {
  ArkModelInfo,
  AttachmentDTO,
  AuthSession,
  ExportFile,
  GraphDTO,
  ImportResult,
  NodeDTO,
  NoteLinkDTO,
  ProjectDTO,
  SearchHit,
  SearchResponse,
  SettingsDTO,
  SettingsPatch,
  SuggestionDTO,
} from './types'

/** Mock 数据在 sessionStorage 中的键（刷新后同一标签页仍保留） */
const STORAGE_KEY = 'tree-thinking:mock-graph'
/** Mock 设置单独存放，避免和画布数据混在一起 */
const SETTINGS_STORAGE_KEY = 'tree-thinking:mock-settings'

/** 是否启用本地假数据模式：在 .env / 启动命令中设置 VITE_MOCK=1 */
export function isMock(): boolean {
  return import.meta.env.VITE_MOCK === '1'
}

interface MockDb {
  projects: ProjectDTO[]
  nodes: NodeDTO[]
  /** 回答卡片与笔记卡片之间的连接 */
  links: NoteLinkDTO[]
}

const nowIso = () => new Date().toISOString()

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

 /** 模拟网络延迟，让加载态可见 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 可被 AbortSignal 提前结束的定时等待 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
  })
}

function makeRoot(projectId: string): NodeDTO {
  return {
    id: uid('n'),
    projectId,
    parentId: null,
    question: '',
    prompt: '',
    answer: '',
    reasoning: '',
    origin: 'root',
    suggestionId: null,
    status: 'input',
    error: null,
    suggestions: [],
    suggestionsConsumed: false,
    titleCustom: false,
    sources: [],
    attachments: [],
    webToolUsed: false,
    // 元卡片默认固定，与后端一致
    pinned: true,
    nodeType: 'chat',
    width: null,
    height: null,
    x: 0,
    y: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
}

function seedDb(): MockDb {
  const project: ProjectDTO = {
    id: uid('p'),
    name: '示例画布',
    viewport: null,
    rootQuestion: '',
    nodeCount: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  return { projects: [project], nodes: [makeRoot(project.id)], links: [] }
}

function saveDb(db: MockDb): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // sessionStorage 不可用时仅保留内存态
  }
}

function loadDb(): MockDb {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MockDb>
      if (Array.isArray(parsed.projects) && parsed.projects.length > 0 && Array.isArray(parsed.nodes)) {
        // 旧数据结构没有 links 字段，按空数组兼容
        return {
          projects: parsed.projects,
          nodes: parsed.nodes,
          links: Array.isArray(parsed.links) ? parsed.links : [],
        }
      }
    }
  } catch {
    // 脏数据直接重建
  }
  const db = seedDb()
  saveDb(db)
  return db
}

/** Mock 模式下的设置默认值（与 .env 默认一致） */
const DEFAULT_SETTINGS: SettingsDTO = {
  provider: 'deepseek',
  hasKey: false,
  apiKeyMasked: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  thinkingEnabled: true,
  openaiHasKey: false,
  openaiApiKeyMasked: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  openaiOrganization: '',
  openaiProject: '',
  openaiTemperatureEnabled: false,
  openaiTemperature: 1,
  openaiMaxTokens: 0,
  openaiReasoningEffort: 'default',
  openaiTimeoutSeconds: 60,
  arkHasKey: false,
  arkApiKeyMasked: '',
  arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  arkModel: 'doubao-seed-2-1-pro-260915',
  suggestionCount: 3,
  cardWidth: 400,
  cardHeight: 560,
  cardGap: 80,
  connectionStyle: 'direct',
  doubleClickMs: 300,
  dragDriftDelayMs: 0,
  dragDriftDistance: 10,
  pointerMode: 'mouse',
  cardFontSize: 14,
  autosaveMinutes: 5,
  undoSteps: 10,
  themeHue: 173,
  edgeWidth: 1.5,
  edgeColor: '#3a3f4a',
  noteLinkStyle: 'orthogonal',
  noteLinkWidth: 1.5,
  noteLinkColor: '#3a3f4a',
  noteLinkReleaseAction: 'none',
  themeMode: 'system',
  timeFormat: '24h',
  webSearchEnabled: false,
  webSearchMode: 'smart',
  sourcesPanelRatio: 0.25,
  panInertiaEnabled: false,
  panInertiaCoefficient: 0.5,
  canvasStyle: 'none',
  searchLimit: 50,
}

/** 构造 mock 模型项：输出统一为文本，输入模态按官方模型表近似给出 */
function arkModel(id: string, inputModalities: string[]): ArkModelInfo {
  return {
    id,
    // 去掉末尾的版本号（如 -260915），得到基础模型名
    name: id.replace(/-\d{6}$/, ''),
    inputModalities,
    outputModalities: ['text'],
  }
}

/**
 * Mock 模式 / 接口失败兜底的内置模型列表：21 个 LLM 模型（不含 seed-character）。
 * 模态为按官方模型表给出的近似值，仅用于本地下拉与能力提示。
 */
export const MOCK_ARK_MODELS: ArkModelInfo[] = [
  arkModel('doubao-seed-evolving', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-1-pro-260915', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-1-lite-260915', ['text', 'image', 'video', 'audio']),
  arkModel('doubao-seed-2-1-turbo-260628', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-1-pro-260628', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-0-lite-260428', ['text', 'image', 'video', 'audio']),
  arkModel('doubao-seed-2-0-mini-260428', ['text', 'image', 'video', 'audio']),
  arkModel('doubao-seed-2-0-pro-260215', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-0-lite-260215', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-0-mini-260215', ['text', 'image', 'video']),
  arkModel('doubao-seed-2-0-code-preview-260215', ['text', 'image', 'video']),
  arkModel('doubao-seed-translation-250915', ['text']),
  arkModel('glm-5-3-flash-260828', ['text', 'image']),
  arkModel('glm-5-2-260617', ['text']),
  arkModel('kimi-k3-1-pro-261024', ['text', 'image']),
  arkModel('deepseek-v4-1-flash-261017', ['text', 'image']),
  arkModel('deepseek-v4-1-flash-260910', ['text', 'image']),
  arkModel('deepseek-v4-1-flash-economy-261017', ['text', 'image']),
  arkModel('deepseek-v4-pro-ga-260813', ['text']),
  arkModel('deepseek-v4-flash-ga-260731', ['text']),
  arkModel('deepseek-v4-pro-260425', ['text']),
]

/** 全局卡片尺寸的最小值（与后端一致，无上限） */
const MIN_CARD_WIDTH = 280
const MIN_CARD_HEIGHT = 240

/** 正文字号的取值范围，以及自动放大卡片时的基准（14px → 400×560） */
const MIN_CARD_FONT_SIZE = 12
const MAX_CARD_FONT_SIZE = 24
const BASE_CARD_FONT_SIZE = 14
const BASE_CARD_WIDTH = 400
const BASE_CARD_HEIGHT = 560

/** 笔记卡片的默认尺寸（与后端一致） */
const NOTE_DEFAULT_WIDTH = 320
const NOTE_DEFAULT_HEIGHT = 220

let settingsCache: SettingsDTO | null = null

function getSettingsState(): SettingsDTO {
  if (settingsCache) return settingsCache
  try {
    const raw = sessionStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      settingsCache = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SettingsDTO>) }
      return settingsCache
    }
  } catch {
    // 脏数据回落到默认值
  }
  settingsCache = { ...DEFAULT_SETTINGS }
  return settingsCache
}

function saveSettingsState(value: SettingsDTO): void {
  settingsCache = value
  try {
    sessionStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // sessionStorage 不可用时仅保留内存态
  }
}

/** 与后端一致的脱敏规则：保留前 3 位与末 4 位 */
function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}••••${key.slice(-4)}`
}

let dbCache: MockDb | null = null

function getDb(): MockDb {
  if (!dbCache) dbCache = loadDb()
  return dbCache
}

/** 同步画布的派生字段（根问题摘要、节点数、更新时间） */
function syncProjectMeta(db: MockDb, projectId: string): void {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) return
  const nodes = db.nodes.filter((item) => item.projectId === projectId)
  const root = nodes.find((item) => item.parentId === null && item.nodeType === 'chat')
  project.rootQuestion = root?.question ?? ''
  project.nodeCount = nodes.length
  project.updatedAt = nowIso()
}

function findNode(id: string): NodeDTO {
  const node = getDb().nodes.find((item) => item.id === id)
  if (!node) throw new Error('节点不存在，可能已被删除')
  return node
}

/** 新子节点坐标：与后端规则一致，水平间隔为「卡片宽 + 320」 */
function nextChildPosition(db: MockDb, parent: NodeDTO): { x: number; y: number } {
  const settings = getSettingsState()
  const siblings = db.nodes.filter((item) => item.parentId === parent.id).length
  return {
    x: parent.x + settings.cardWidth + 320,
    // 首个孩子与父卡片同一水平线，之后按「卡片高 + 100」纵向错开
    y: siblings === 0 ? parent.y : parent.y + siblings * (settings.cardHeight + 100),
  }
}

/** 构造一个新节点，字段默认值与后端一致 */
function makeNode(init: Partial<NodeDTO> & { projectId: string; parentId: string | null }): NodeDTO {
  return {
    id: uid('n'),
    projectId: init.projectId,
    parentId: init.parentId,
    question: init.question ?? '',
    prompt: init.prompt ?? init.question ?? '',
    answer: '',
    reasoning: '',
    origin: init.origin ?? 'user',
    suggestionId: init.suggestionId ?? null,
    status: init.status ?? 'pending',
    error: null,
    suggestions: [],
    suggestionsConsumed: false,
    titleCustom: init.titleCustom ?? false,
    sources: init.sources ?? [],
    attachments: init.attachments ?? [],
    webToolUsed: init.webToolUsed ?? false,
    pinned: init.pinned ?? false,
    nodeType: init.nodeType ?? 'chat',
    width: init.width ?? null,
    height: init.height ?? null,
    x: init.x ?? 0,
    y: init.y ?? 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
}

/** Mock 附件缓存：按 id 保存元数据，创建节点时按 id 解析 */
const attachmentCache = new Map<string, AttachmentDTO>()

/** 作为纯文本读取的扩展名白名单（与后端保持一致） */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.log',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.sql', '.java', '.c', '.cpp',
  '.h', '.go', '.rs', '.sh', '.bat', '.ps1',
])

/** 按 MIME 与扩展名判定附件类型：image / text / pdf / video / audio / other */
function kindOfAttachment(name: string, mime: string): AttachmentDTO['kind'] {
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return 'image'
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase()
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'other'
}

/** 把附件 id 解析成元信息，找不到时给出占位，避免节点缺字段 */
function resolveAttachments(ids?: string[]): AttachmentDTO[] {
  if (!ids || ids.length === 0) return []
  return ids.slice(0, 10).map(
    (id) =>
      attachmentCache.get(id) ?? {
        id,
        name: id,
        mime: '',
        size: 0,
        kind: 'other',
        ext: '',
        url: `/api/attachments/${id}`,
        pageCount: null,
        provider: null,
        fileId: id,
        parsed: false,
      },
  )
}

export const mockApi: ApiClient = {
  async getSession(): Promise<AuthSession> {
    // Mock 始终是单机模式，没有账号体系
    return { mode: 'local', user: null }
  },

  async register() {
    throw new Error('Mock 模式为本地模式，无需注册')
  },

  async login() {
    throw new Error('Mock 模式为本地模式，无需登录')
  },

  async logout() {
    // 本地模式没有会话，直接视为成功
  },

  async checkUsername() {
    // Mock 模式没有账号体系，统一返回不可用
    return { available: false, reason: 'Mock 模式为本地模式，无需注册' }
  },

  async search(query, projectId) {
    await delay(80)
    const term = (query ?? '').trim()
    if (!term) return { query, items: [], truncated: false }
    const db = getDb()
    const projects = db.projects.filter((item) => !projectId || item.id === projectId)
    const names = new Map(projects.map((item) => [item.id, item.name]))
    const items: SearchHit[] = []

    // 与后端一致：返回命中位置附近的单行片段，超长时以省略号收尾
    const snippet = (text: string | null | undefined): string | null => {
      if (!text) return null
      const position = text.toLowerCase().indexOf(term.toLowerCase())
      if (position < 0) return null
      const start = Math.max(0, position - 48)
      const end = Math.min(text.length, position + term.length + 48)
      const body = text.slice(start, end).split(/\s+/).join(' ')
      return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
    }

    for (const project of projects) {
      const text = snippet(project.name)
      if (text === null) continue
      items.push({
        projectId: project.id,
        projectName: project.name,
        nodeId: null,
        nodeType: 'project',
        field: 'project',
        snippet: text,
        updatedAt: project.updatedAt ?? '',
      })
    }

    const nodes = db.nodes
      .filter((node) => names.has(node.projectId))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    for (const node of nodes) {
      const fields = [
        ['title', node.question],
        ['answer', node.answer],
      ] as const
      for (const [field, text] of fields) {
        const body = snippet(text)
        if (body === null) continue
        items.push({
          projectId: node.projectId,
          projectName: names.get(node.projectId) ?? '',
          nodeId: node.id,
          nodeType: node.nodeType,
          field,
          snippet: body,
          updatedAt: node.updatedAt ?? '',
        })
      }
    }

    return {
      query,
      items: items.slice(0, 60),
      truncated: items.length > 60,
    } satisfies SearchResponse
  },

  async exportProject(id) {
    await delay(80)
    const db = getDb()
    const project = db.projects.find((item) => item.id === id)
    if (!project) throw new Error('画布不存在')
    const payload: ExportFile = {
      app: 'tree-thinking',
      version: 1,
      exportedAt: nowIso(),
      project: { name: project.name, viewport: project.viewport },
      nodes: db.nodes.filter((item) => item.projectId === id).map((node) => ({ ...node })),
      // 只导出连接两端的节点 id，导入时按新 id 重映射
      links: db.links
        .filter((link) => link.projectId === id)
        .map((link) => ({ answerNodeId: link.answerNodeId, noteNodeId: link.noteNodeId })),
    }
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  },

  async importProject(payload): Promise<ImportResult> {
    await delay(160)
    if (payload.app !== 'tree-thinking') throw new Error('不是本应用导出的画布文件')
    if (payload.version !== 1) throw new Error('不支持的导出文件版本')
    if (!Array.isArray(payload.nodes) || payload.nodes.length === 0) {
      throw new Error('导入文件里没有节点')
    }

    const db = getDb()
    const project: ProjectDTO = {
      id: uid('p'),
      // 与后端一致：导入后追加后缀，便于和原画布区分
      name: `${(payload.project?.name ?? '').trim() || '新画布'}（导入）`,
      viewport: payload.project?.viewport ?? null,
      rootQuestion: '',
      nodeCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }

    // 旧 id → 新 id 的映射，parentId 同步换成新 id 以保持树结构
    const idMap = new Map<string, string>()
    for (const node of payload.nodes) {
      if (!node.id) throw new Error('导入文件里的节点 id 缺失')
      idMap.set(node.id, uid('n'))
    }
    if (idMap.size !== payload.nodes.length) throw new Error('导入文件里的节点 id 缺失或重复')
    for (const node of payload.nodes) {
      if (node.parentId && !idMap.has(node.parentId)) {
        throw new Error('导入文件里的父子关系不完整')
      }
    }

    const nodes: NodeDTO[] = payload.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id) as string,
      projectId: project.id,
      parentId: node.parentId ? (idMap.get(node.parentId) ?? null) : null,
      createdAt: node.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }))

    const root = nodes.find((node) => node.parentId === null && node.nodeType === 'chat')
    if (!root) throw new Error('导入文件缺少根节点')

    // 连接按旧 id → 新 id 重映射，两端节点不存在时跳过该条连接
    const links: NoteLinkDTO[] = []
    for (const link of payload.links ?? []) {
      const answerNodeId = idMap.get(link.answerNodeId)
      const noteNodeId = idMap.get(link.noteNodeId)
      if (!answerNodeId || !noteNodeId) continue
      links.push({ id: uid('l'), projectId: project.id, answerNodeId, noteNodeId })
    }

    db.projects.unshift(project)
    db.nodes.push(...nodes)
    db.links.push(...links)
    syncProjectMeta(db, project.id)
    saveDb(db)
    return { project: { ...project }, nodeId: root.id }
  },

  async listProjects() {
    await delay(80)
    return getDb().projects.map((project) => ({ ...project }))
  },

  async createProject(name) {
    await delay(120)
    const db = getDb()
    const project: ProjectDTO = {
      id: uid('p'),
      name: name || '新画布',
      viewport: null,
      rootQuestion: '',
      nodeCount: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    const root = makeRoot(project.id)
    db.projects.unshift(project)
    db.nodes.push(root)
    saveDb(db)
    const graph: GraphDTO = { project: { ...project }, nodes: [{ ...root }], links: [] }
    return graph
  },

  async patchProject(id, patch) {
    await delay(60)
    const db = getDb()
    const project = db.projects.find((item) => item.id === id)
    if (!project) throw new Error('画布不存在')
    if (patch.name !== undefined) project.name = patch.name
    if (patch.viewport !== undefined) project.viewport = patch.viewport
    project.updatedAt = nowIso()
    saveDb(db)
    return { ...project }
  },

  async autoNameProject(id) {
    await delay(120)
    const db = getDb()
    const project = db.projects.find((item) => item.id === id)
    if (!project) throw new Error('画布不存在')
    // 模拟服务端：只命名仍是默认名的画布，并取根问题前 20 字
    if (project.name === '新画布') {
      const root = db.nodes.find(
        (item) => item.projectId === id && item.parentId === null && item.nodeType === 'chat',
      )
      const title = root?.question.replace(/\s+/g, ' ').trim().slice(0, 20)
      project.name = title || '未命名画布'
      project.updatedAt = nowIso()
      saveDb(db)
    }
    return { ...project }
  },

  async deleteProject(id) {
    await delay(80)
    const db = getDb()
    db.projects = db.projects.filter((item) => item.id !== id)
    db.nodes = db.nodes.filter((item) => item.projectId !== id)
    // 画布删除时一并清理连接
    db.links = db.links.filter((item) => item.projectId !== id)
    saveDb(db)
  },

  async getGraph(projectId) {
    await delay(100)
    const db = getDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('画布不存在')
    return {
      project: { ...project },
      nodes: db.nodes.filter((item) => item.projectId === projectId).map((node) => ({ ...node })),
      links: db.links
        .filter((item) => item.projectId === projectId)
        .map((item) => ({ ...item })),
    }
  },

  async uploadAttachment(file) {
    await delay(120)
    // 读成 data URL，Mock 模式下图片可直接用于 img src
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
    const id = crypto.randomUUID().replace(/-/g, '')
    const dot = file.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : file.name.slice(dot)
    const attachment: AttachmentDTO = {
      id,
      name: file.name || id,
      mime: file.type,
      size: file.size,
      kind: kindOfAttachment(file.name, file.type),
      ext,
      url,
      // Mock 模式不解析 PDF 页数，保持 null
      pageCount: null,
      provider: null,
      fileId: id,
      parsed: true,
    }
    attachmentCache.set(id, attachment)
    return { ...attachment }
  },

  async createNode(projectId, input) {
    await delay(80)
    const db = getDb()
    const parent = findNode(input.parentId)
    const position = nextChildPosition(db, parent)
    const node = makeNode({
      projectId,
      parentId: input.parentId,
      question: input.question,
      origin: input.origin,
      suggestionId: input.suggestionId ?? null,
      status: 'pending',
      attachments: resolveAttachments(input.attachments),
      ...position,
    })
    // 由建议派生出的子卡片意味着父节点该轮候选方向已被消费
    if (input.origin === 'suggestion') parent.suggestionsConsumed = true
    db.nodes.push(node)
    syncProjectMeta(db, projectId)
    saveDb(db)
    return { ...node }
  },

  async patchNode(id, patch) {
    await delay(50)
    const db = getDb()
    const node = findNode(id)
    if (patch.x !== undefined) node.x = patch.x
    if (patch.y !== undefined) node.y = patch.y
    if (patch.pinned !== undefined) node.pinned = patch.pinned
    if (patch.title !== undefined) {
      node.question = patch.title
      // 用户手动编辑标题后标记，重新提交提问时不再自动覆盖
      node.titleCustom = true
    }
    if (patch.prompt !== undefined) node.prompt = patch.prompt.trim()
    if (patch.attachments !== undefined) node.attachments = resolveAttachments(patch.attachments)
    // 候选方向整组覆盖（撤销「换一个方向」）
    if (patch.suggestions !== undefined) node.suggestions = patch.suggestions
    if (patch.suggestionsConsumed !== undefined) node.suggestionsConsumed = patch.suggestionsConsumed
    // 正文与独立尺寸仅对笔记生效，与后端一致
    if (node.nodeType === 'note') {
      if (patch.content !== undefined) node.answer = patch.content
      if (patch.width !== undefined) node.width = Math.max(MIN_CARD_WIDTH, patch.width)
      if (patch.height !== undefined) node.height = Math.max(MIN_CARD_HEIGHT, patch.height)
    }
    node.updatedAt = nowIso()
    saveDb(db)
    return { ...node }
  },

  async createNote(projectId, position) {
    await delay(80)
    const db = getDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('画布不存在')
    // 笔记不挂在对话树上（parentId 为空），因此不出连线、不参与自动整理
    const note = makeNode({
      projectId,
      parentId: null,
      origin: 'user',
      status: 'done',
      nodeType: 'note',
      width: NOTE_DEFAULT_WIDTH,
      height: NOTE_DEFAULT_HEIGHT,
      x: position.x,
      y: position.y,
    })
    db.nodes.push(note)
    syncProjectMeta(db, projectId)
    saveDb(db)
    return { ...note }
  },

  async listNoteLinks(projectId) {
    await delay(40)
    return getDb()
      .links.filter((item) => item.projectId === projectId)
      .map((item) => ({ ...item }))
  },

  async createNoteLink(projectId, input) {
    await delay(50)
    const db = getDb()
    if (!db.projects.some((item) => item.id === projectId)) throw new Error('画布不存在')
    const answer = db.nodes.find((item) => item.id === input.answerNodeId)
    const note = db.nodes.find((item) => item.id === input.noteNodeId)
    if (!answer || answer.projectId !== projectId) throw new Error('回答卡片不存在')
    if (!note || note.projectId !== projectId) throw new Error('笔记卡片不存在')
    if (answer.nodeType !== 'chat') throw new Error('连接起点必须是回答卡片')
    if (note.nodeType !== 'note') throw new Error('连接终点必须是笔记卡片')
    // 重复连接幂等：直接返回已有记录
    const existing = db.links.find(
      (item) => item.answerNodeId === answer.id && item.noteNodeId === note.id,
    )
    if (existing) return { ...existing }
    const link: NoteLinkDTO = {
      id: uid('l'),
      projectId,
      answerNodeId: answer.id,
      noteNodeId: note.id,
    }
    db.links.push(link)
    saveDb(db)
    return { ...link }
  },

  async deleteNoteLink(projectId, linkId) {
    await delay(40)
    const db = getDb()
    db.links = db.links.filter(
      (item) => !(item.projectId === projectId && item.id === linkId),
    )
    saveDb(db)
  },

  async syncNoteLinks(projectId, links) {
    await delay(60)
    const db = getDb()
    if (!db.projects.some((item) => item.id === projectId)) throw new Error('画布不存在')
    // 只允许连接本画布内的回答卡片与笔记卡片，重复连接按首次出现去重
    const nodes = new Map(
      db.nodes.filter((item) => item.projectId === projectId).map((item) => [item.id, item]),
    )
    const next: NoteLinkDTO[] = []
    const seen = new Set<string>()
    for (const item of links) {
      const answer = nodes.get(item.answerNodeId)
      const note = nodes.get(item.noteNodeId)
      if (!answer || answer.nodeType !== 'chat') throw new Error('连接起点必须是回答卡片')
      if (!note || note.nodeType !== 'note') throw new Error('连接终点必须是笔记卡片')
      const key = `${answer.id}->${note.id}`
      if (seen.has(key)) continue
      seen.add(key)
      // 已有记录复用原 id，保证全量覆盖的幂等性
      const existing = db.links.find(
        (link) =>
          link.projectId === projectId &&
          link.answerNodeId === answer.id &&
          link.noteNodeId === note.id,
      )
      next.push(
        existing
          ? { ...existing }
          : { id: uid('l'), projectId, answerNodeId: answer.id, noteNodeId: note.id },
      )
    }
    db.links = [...db.links.filter((item) => item.projectId !== projectId), ...next]
    saveDb(db)
    return next.map((item) => ({ ...item }))
  },

  async restoreNodes(projectId, nodes) {
    await delay(80)
    const db = getDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('画布不存在')
    const existing = new Set(db.nodes.map((item) => item.id))
    for (const node of nodes) {
      // 已存在的 id 跳过（同一批次里的重复 id 也一样），避免覆盖当前数据
      if (existing.has(node.id)) continue
      existing.add(node.id)
      db.nodes.push({ ...node, projectId })
    }
    syncProjectMeta(db, projectId)
    saveDb(db)
  },

  async saveProject(projectId) {
    // Mock 只模拟保存耗时，返回当前时间
    await delay(150)
    const db = getDb()
    if (!db.projects.some((item) => item.id === projectId)) throw new Error('画布不存在')
    return { savedAt: nowIso() }
  },

  async deleteNode(id) {
    await delay(80)
    const db = getDb()
    const node = findNode(id)
    // 元问题根卡片不可删，笔记没有父节点但允许删除（与后端一致）
    if (node.parentId === null && node.nodeType !== 'note') throw new Error('根节点不可删除')
    // 收集子树后一次性删除
    const ids = new Set<string>([node.id])
    let changed = true
    while (changed) {
      changed = false
      for (const item of db.nodes) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id)
          changed = true
        }
      }
    }
    db.nodes = db.nodes.filter((item) => !ids.has(item.id))
    // 节点删除后级联清理引用了这些节点的连接
    db.links = db.links.filter(
      (item) => !ids.has(item.answerNodeId) && !ids.has(item.noteNodeId),
    )
    syncProjectMeta(db, node.projectId)
    saveDb(db)
  },

  async setNodeQuestion(id, question, attachments) {
    await delay(60)
    const db = getDb()
    const node = findNode(id)
    node.question = question
    // 首次提交时原始提问与标题一致，后续标题可单独改名
    node.prompt = question
    node.error = null
    // 附件按 id 解析成元信息；未传该字段时保持原附件不变
    if (attachments !== undefined) node.attachments = resolveAttachments(attachments)
    node.updatedAt = nowIso()
    // 根问题写入后同步画布摘要，侧边栏列表才能显示最新摘要
    syncProjectMeta(db, node.projectId)
    saveDb(db)
    return { ...node }
  },

  async stopNode(id, payload) {
    await delay(40)
    const db = getDb()
    const node = findNode(id)
    // 流式期间数据库尚未写入增量：先把前端提交的内存内容落库，再判断有无输出
    if (payload) {
      node.answer = payload.answer
      node.reasoning = payload.reasoning
      node.sources = payload.sources.map((source) => ({ ...source }))
    }
    // 与后端一致：已有可见输出时保留内容并进入暂停态，否则根卡片回到输入态
    if (node.answer.trim()) {
      node.status = 'paused'
      node.error = null
    } else if (node.parentId === null && node.nodeType === 'chat') {
      node.status = 'input'
      node.answer = ''
      node.reasoning = ''
      node.error = null
      node.sources = []
      node.suggestions = []
    }
    node.updatedAt = nowIso()
    saveDb(db)
    return { ...node }
  },

  async continueNode(id, handlers, signal) {
    await delay(40)
    const db = getDb()
    const node = findNode(id)
    if (signal?.aborted) return
    // 模拟续写：在现有回答后追加一段文本，完成后回到 done
    const chunk = '\n\n（继续生成）模型从中断处接着补完剩余内容。'
    node.status = 'streaming'
    node.error = null
    node.answer += chunk
    node.updatedAt = nowIso()
    saveDb(db)
    handlers.onDelta?.(chunk)
    await sleep(120, signal)
    if (signal?.aborted) return
    node.status = 'done'
    node.updatedAt = nowIso()
    saveDb(db)
    handlers.onDone?.()
  },

  async generateSuggestions(id, count = 3) {
    await delay(60)
    const db = getDb()
    const node = findNode(id)
    // 已经创建子卡片的建议保持不变，只替换未使用的建议
    const usedIds = new Set(
      db.nodes
        .filter((item) => item.parentId === id && item.origin === 'suggestion' && item.suggestionId)
        .map((item) => item.suggestionId as string),
    )
    const kept = node.suggestions.filter((item) => usedIds.has(item.id))
    // 文本带随机序号，避免与已有建议重复
    const stamp = Math.random().toString(36).slice(2, 6)
    const fresh: SuggestionDTO[] = Array.from({ length: count }, (_, index) => ({
      id: `${id}-s${stamp}${index}`,
      text: `${MOCK_SUGGESTIONS[index % MOCK_SUGGESTIONS.length]} · ${stamp}${index}`,
    }))
    node.suggestions = [...kept, ...fresh]
    // 换一个方向即开启新一轮，解除「已选」隐藏状态
    node.suggestionsConsumed = false
    node.updatedAt = nowIso()
    saveDb(db)
    return node.suggestions.map((item) => ({ ...item }))
  },

  async createBranch(nodeId) {
    await delay(80)
    const db = getDb()
    const parent = findNode(nodeId)
    if (parent.status !== 'done') throw new Error('当前卡片还没有完成回答，无法新增分支')
    const position = nextChildPosition(db, parent)
    const node = makeNode({
      projectId: parent.projectId,
      parentId: parent.id,
      question: '',
      origin: 'user',
      status: 'input',
      ...position,
    })
    db.nodes.push(node)
    syncProjectMeta(db, node.projectId)
    saveDb(db)
    return { ...node }
  },

  async getSettings() {
    await delay(40)
    return { ...getSettingsState() }
  },

  async updateSettings(patch: SettingsPatch) {
    await delay(60)
    const settings = { ...getSettingsState() }
    if (patch.provider !== undefined) settings.provider = patch.provider
    // 留空表示保持原 Key，与后端语义一致
    if (patch.apiKey && patch.apiKey.trim()) {
      settings.hasKey = true
      settings.apiKeyMasked = maskKey(patch.apiKey.trim())
    }
    if (patch.openaiApiKey && patch.openaiApiKey.trim()) {
      settings.openaiHasKey = true
      settings.openaiApiKeyMasked = maskKey(patch.openaiApiKey.trim())
    }
    if (patch.openaiBaseUrl !== undefined) {
      settings.openaiBaseUrl = patch.openaiBaseUrl.trim() || DEFAULT_SETTINGS.openaiBaseUrl
    }
    if (patch.openaiModel !== undefined) {
      settings.openaiModel = patch.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel
    }
    if (patch.openaiOrganization !== undefined) {
      settings.openaiOrganization = patch.openaiOrganization.trim()
    }
    if (patch.openaiProject !== undefined) {
      settings.openaiProject = patch.openaiProject.trim()
    }
    if (patch.openaiTemperatureEnabled !== undefined) {
      settings.openaiTemperatureEnabled = patch.openaiTemperatureEnabled
    }
    if (patch.openaiTemperature !== undefined) {
      settings.openaiTemperature = Math.min(2, Math.max(0, patch.openaiTemperature))
    }
    if (patch.openaiMaxTokens !== undefined) {
      settings.openaiMaxTokens = Math.max(0, Math.round(patch.openaiMaxTokens))
    }
    if (patch.openaiReasoningEffort !== undefined) {
      settings.openaiReasoningEffort = patch.openaiReasoningEffort
    }
    if (patch.openaiTimeoutSeconds !== undefined) {
      settings.openaiTimeoutSeconds = Math.min(
        300,
        Math.max(10, Math.round(patch.openaiTimeoutSeconds)),
      )
    }
    // 火山方舟：Key 只保存脱敏值，留空表示保持原 Key
    if (patch.arkApiKey && patch.arkApiKey.trim()) {
      settings.arkHasKey = true
      settings.arkApiKeyMasked = maskKey(patch.arkApiKey.trim())
    }
    if (patch.arkBaseUrl !== undefined) {
      settings.arkBaseUrl = patch.arkBaseUrl.trim() || DEFAULT_SETTINGS.arkBaseUrl
    }
    if (patch.arkModel !== undefined) {
      settings.arkModel = patch.arkModel.trim() || DEFAULT_SETTINGS.arkModel
    }
    if (patch.baseUrl !== undefined) {
      settings.baseUrl = patch.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl
    }
    if (patch.model !== undefined) {
      settings.model = patch.model.trim() || DEFAULT_SETTINGS.model
    }
    if (patch.thinkingEnabled !== undefined) {
      settings.thinkingEnabled = patch.thinkingEnabled
    }
    if (patch.suggestionCount !== undefined) {
      settings.suggestionCount = Math.min(6, Math.max(2, patch.suggestionCount))
    }
    // 尺寸只夹最小值，不设上限
    if (patch.cardWidth !== undefined) {
      settings.cardWidth = Math.max(MIN_CARD_WIDTH, patch.cardWidth)
    }
    if (patch.cardHeight !== undefined) {
      settings.cardHeight = Math.max(MIN_CARD_HEIGHT, patch.cardHeight)
    }
    if (patch.cardGap !== undefined) {
      settings.cardGap = Math.min(1200, Math.max(16, Math.round(patch.cardGap)))
    }
    // 字号变大时自动放大卡片（只放大不缩小），与前端 store 保持一致
    if (patch.cardFontSize !== undefined) {
      settings.cardFontSize = Math.min(
        MAX_CARD_FONT_SIZE,
        Math.max(MIN_CARD_FONT_SIZE, Math.round(patch.cardFontSize)),
      )
      const minWidth = Math.round((BASE_CARD_WIDTH * settings.cardFontSize) / BASE_CARD_FONT_SIZE)
      const minHeight = Math.round((BASE_CARD_HEIGHT * settings.cardFontSize) / BASE_CARD_FONT_SIZE)
      settings.cardWidth = Math.max(settings.cardWidth, minWidth)
      settings.cardHeight = Math.max(settings.cardHeight, minHeight)
    }
    // 画布 / 移动 / 保存 / 外观字段：取值范围与后端一致
    if (patch.connectionStyle !== undefined) settings.connectionStyle = patch.connectionStyle
    if (patch.doubleClickMs !== undefined) {
      settings.doubleClickMs = Math.min(1000, Math.max(100, Math.round(patch.doubleClickMs)))
    }
    if (patch.dragDriftDelayMs !== undefined) {
      settings.dragDriftDelayMs = Math.min(500, Math.max(0, Math.round(patch.dragDriftDelayMs)))
    }
    if (patch.dragDriftDistance !== undefined) {
      settings.dragDriftDistance = Math.min(50, Math.max(0, Math.round(patch.dragDriftDistance)))
    }
    if (patch.pointerMode !== undefined) {
      settings.pointerMode = patch.pointerMode
    }
    if (patch.autosaveMinutes !== undefined) {
      settings.autosaveMinutes = Math.max(0, Math.round(patch.autosaveMinutes))
    }
    if (patch.undoSteps !== undefined) {
      settings.undoSteps = Math.max(1, Math.round(patch.undoSteps))
    }
    if (patch.themeHue !== undefined) {
      settings.themeHue = Math.min(360, Math.max(0, patch.themeHue))
    }
    if (patch.edgeWidth !== undefined) {
      settings.edgeWidth = Math.min(12, Math.max(0.5, patch.edgeWidth))
    }
    if (patch.edgeColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.edgeColor)) {
      settings.edgeColor = patch.edgeColor.toLowerCase()
    }
    // 笔记连线：粗细与 edgeWidth 使用同一范围 0.5–12，颜色按 #rrggbb 校验并转小写
    if (patch.noteLinkStyle !== undefined) settings.noteLinkStyle = patch.noteLinkStyle
    if (patch.noteLinkWidth !== undefined) {
      settings.noteLinkWidth = Math.min(12, Math.max(0.5, patch.noteLinkWidth))
    }
    if (patch.noteLinkColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.noteLinkColor)) {
      settings.noteLinkColor = patch.noteLinkColor.toLowerCase()
    }
    if (patch.noteLinkReleaseAction !== undefined) {
      settings.noteLinkReleaseAction = patch.noteLinkReleaseAction
    }
    if (patch.themeMode !== undefined) settings.themeMode = patch.themeMode
    if (patch.timeFormat !== undefined) settings.timeFormat = patch.timeFormat
    if (patch.webSearchEnabled !== undefined) settings.webSearchEnabled = patch.webSearchEnabled
    // 只接受智能搜索 / 强制搜索两种取值
    if (patch.webSearchMode === 'smart' || patch.webSearchMode === 'forced') {
      settings.webSearchMode = patch.webSearchMode
    }
    // 火山方舟固定使用智能搜索
    if (settings.provider === 'ark') settings.webSearchMode = 'smart'
    // 参考资料抽屉比例：与后端一致夹到 0.15–0.7
    if (patch.sourcesPanelRatio !== undefined) {
      settings.sourcesPanelRatio = Math.min(0.7, Math.max(0.15, patch.sourcesPanelRatio))
    }
    if (patch.panInertiaEnabled !== undefined) settings.panInertiaEnabled = patch.panInertiaEnabled
    if (patch.panInertiaCoefficient !== undefined) {
      settings.panInertiaCoefficient = Math.min(1, Math.max(0.1, patch.panInertiaCoefficient))
    }
    if (patch.canvasStyle !== undefined) settings.canvasStyle = patch.canvasStyle
    if (patch.searchLimit !== undefined) {
      settings.searchLimit = Math.min(50, Math.max(1, Math.round(patch.searchLimit)))
    }
    saveSettingsState(settings)
    return { ...settings }
  },

  async resetSettings() {
    await delay(60)
    // 恢复默认：保留已配置的 Key 与其脱敏值，其余字段回到默认
    const current = getSettingsState()
    const reset: SettingsDTO = {
      ...DEFAULT_SETTINGS,
      hasKey: current.hasKey,
      apiKeyMasked: current.apiKeyMasked,
      openaiHasKey: current.openaiHasKey,
      openaiApiKeyMasked: current.openaiApiKeyMasked,
      arkHasKey: current.arkHasKey,
      arkApiKeyMasked: current.arkApiKeyMasked,
    }
    saveSettingsState(reset)
    return { ...reset }
  },

  // Mock 模式不校验 Key，始终返回内置模型列表
  async listArkModels() {
    await delay(60)
    return MOCK_ARK_MODELS.map((item) => ({ ...item }))
  },
}

/** Mock 回答：两段中文正文，含列表与代码块以便验证 Markdown 与内部滚动 */
const MOCK_ANSWER = [
  '这是 Mock 模式下的第一段模拟回答：树状对话把线性聊天拆成一张张卡片，每次追问都会在父卡片右侧长出一条新的分支，因此你可以随时回头比较不同思路，而不会覆盖主线。',
  '',
  '第二段补充几个要点：',
  '',
  '- 卡片宽度固定为 400px，回答区超过 420px 后会在卡片内部滚动。',
  '- 流式输出期间卡片边框会轻微发光，结束后才会出现候选方向。',
  '- 思考过程默认折叠，点击标题即可展开查看模型的组织思路。',
  '- 追问输入条固定在底部居中，未选中卡片时会自动绑定根卡片。',
  '- 每条回答都会写入本地存储，刷新页面后可以继续沿着任意分支前进。',
  '',
  '```ts',
  "const node = { id: 'node-1', x: 0, y: 0 }",
  '```',
  '',
  '以上内容由本地 Mock 生成，仅用于验证前端交互，不消耗任何模型额度。',
].join('\n')

const MOCK_REASONING = '先拆解问题的核心要素，再按「概念 → 示例 → 结论」的顺序组织回答。'

const MOCK_SUGGESTIONS = ['换个角度拆解问题', '补充一个具体案例', '对比另一种方案']

/** Mock 流式输出：先思考，再每 40ms 吐一个字，结束后给出 3 条建议 */
export async function mockStreamAnswer(
  nodeId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const db = getDb()
  const node = db.nodes.find((item) => item.id === nodeId)
  if (!node) {
    handlers.onError?.('节点不存在，可能已被删除')
    return
  }

  node.status = 'streaming'
  node.answer = ''
  node.reasoning = ''
  node.error = null
  node.suggestions = []
  // 新一轮回答开始时清空上一轮的搜索来源
  node.sources = []
  node.updatedAt = nowIso()
  saveDb(db)

  // 模拟首字延迟
  await sleep(150, signal)
  if (signal?.aborted) return

  node.reasoning = MOCK_REASONING
  handlers.onReasoning?.(MOCK_REASONING)

  let answer = ''
  for (const char of Array.from(MOCK_ANSWER)) {
    if (signal?.aborted) return
    await sleep(40, signal)
    if (signal?.aborted) return
    answer += char
    handlers.onDelta?.(char)
  }

  const suggestions: SuggestionDTO[] = MOCK_SUGGESTIONS.map((text, index) => ({
    id: `${nodeId}-s${index}`,
    text,
  }))

  node.answer = answer
  node.reasoning = MOCK_REASONING
  node.status = 'done'
  node.suggestions = suggestions
  node.updatedAt = nowIso()
  saveDb(db)

  handlers.onSuggestions?.(suggestions)
  handlers.onDone?.({ completionTokens: Array.from(answer).length })
}
