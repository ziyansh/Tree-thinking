import type { ApiClient } from './client'
import type { StreamHandlers } from './sse'
import type { GraphDTO, NodeDTO, ProjectDTO, SettingsDTO, SettingsPatch, SuggestionDTO } from './types'

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
    answer: '',
    reasoning: '',
    origin: 'root',
    suggestionId: null,
    status: 'input',
    error: null,
    suggestions: [],
    suggestionsConsumed: false,
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
  return { projects: [project], nodes: [makeRoot(project.id)] }
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
      const parsed = JSON.parse(raw) as MockDb
      if (Array.isArray(parsed.projects) && parsed.projects.length > 0 && Array.isArray(parsed.nodes)) {
        return parsed
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
  suggestionCount: 3,
  cardWidth: 400,
  cardHeight: 560,
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
}

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
    answer: '',
    reasoning: '',
    origin: init.origin ?? 'user',
    suggestionId: init.suggestionId ?? null,
    status: init.status ?? 'pending',
    error: null,
    suggestions: [],
    suggestionsConsumed: false,
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

export const mockApi: ApiClient = {
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
    const graph: GraphDTO = { project: { ...project }, nodes: [{ ...root }] }
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
    }
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
    if (patch.title !== undefined) node.question = patch.title
    // 候选方向整组覆盖（撤销「换一个方向」）
    if (patch.suggestions !== undefined) node.suggestions = patch.suggestions
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
    syncProjectMeta(db, node.projectId)
    saveDb(db)
  },

  async setNodeQuestion(id, question) {
    await delay(60)
    const db = getDb()
    const node = findNode(id)
    node.question = question
    node.error = null
    node.updatedAt = nowIso()
    // 根问题写入后同步画布摘要，侧边栏列表才能显示最新摘要
    syncProjectMeta(db, node.projectId)
    saveDb(db)
    return { ...node }
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
      settings.edgeWidth = Math.min(6, Math.max(0.5, patch.edgeWidth))
    }
    if (patch.edgeColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.edgeColor)) {
      settings.edgeColor = patch.edgeColor.toLowerCase()
    }
    if (patch.themeMode !== undefined) settings.themeMode = patch.themeMode
    if (patch.timeFormat !== undefined) settings.timeFormat = patch.timeFormat
    saveSettingsState(settings)
    return { ...settings }
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
