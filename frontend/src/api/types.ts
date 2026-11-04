/** 画布视口，结构与 React Flow 的 Viewport 一致 */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** 节点状态：待输入 / 排队 / 流式中 / 完成 / 失败 */
export type NodeStatus = 'input' | 'pending' | 'streaming' | 'done' | 'error'

/** 节点来源：根节点 / 用户新增 / 点选建议 */
export type NodeOrigin = 'root' | 'user' | 'suggestion'

/** 候选方向（Task 6 的 ghost 箭头使用，本任务仅透传） */
export interface SuggestionDTO {
  id: string
  text: string
}

/** 对话卡片对应的后端节点 */
export interface NodeDTO {
  id: string
  projectId: string
  parentId: string | null
  question: string
  answer: string
  reasoning: string
  origin: NodeOrigin
  suggestionId: string | null
  status: NodeStatus
  error: string | null
  suggestions: SuggestionDTO[]
  /** 候选方向是否已被消费（选中一条后隐藏整组，换一个方向后重置） */
  suggestionsConsumed: boolean
  /** 是否固定：固定卡片不能被直接拖动（元卡片默认固定） */
  pinned: boolean
  /** 节点类型：chat 问答卡片 / note 笔记卡片 */
  nodeType: 'chat' | 'note'
  /** 笔记卡片的独立宽度；问答卡片为空，使用全局卡片宽度 */
  width: number | null
  /** 笔记卡片的独立高度；问答卡片为空，使用全局卡片高度 */
  height: number | null
  x: number
  y: number
  createdAt?: string
  updatedAt?: string
}

/** 画布（项目）元信息 */
export interface ProjectDTO {
  id: string
  name: string
  viewport: Viewport | null
  rootQuestion?: string
  nodeCount?: number
  createdAt?: string
  updatedAt?: string
}

/** 画布图数据：项目 + 全部节点（边由 parentId 在前端派生） */
export interface GraphDTO {
  project: ProjectDTO
  nodes: NodeDTO[]
}

/** 创建子节点的入参 */
export interface NodeCreateInput {
  parentId: string
  question: string
  origin: NodeOrigin
  suggestionId?: string
}

/** 主题模式：跟随系统 / 浅色 / 深色 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 连接方式：直接分支 / 共用母线 */
export type ConnectionStyle = 'direct' | 'bus'

/** 时间制式：24 小时制 / 12 小时制 */
export type TimeFormat = '24h' | '12h'

/** 模型服务商：DeepSeek / OpenAI */
export type ModelProvider = 'deepseek' | 'openai'

/** OpenAI 推理强度：default 表示不发送该参数 */
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high'

/** 应用设置视图：Key 只返回脱敏值 */
export interface SettingsDTO {
  /** 当前服务商（默认 deepseek） */
  provider: ModelProvider
  hasKey: boolean
  apiKeyMasked: string
  baseUrl: string
  model: string
  thinkingEnabled: boolean
  /** OpenAI 独立配置：是否已配置 Key 与脱敏值 */
  openaiHasKey: boolean
  openaiApiKeyMasked: string
  openaiBaseUrl: string
  openaiModel: string
  openaiOrganization: string
  openaiProject: string
  /** 是否发送 temperature（推理模型不支持，默认关闭） */
  openaiTemperatureEnabled: boolean
  openaiTemperature: number
  /** 最大输出 tokens，0 表示不发送 */
  openaiMaxTokens: number
  openaiReasoningEffort: ReasoningEffort
  openaiTimeoutSeconds: number
  suggestionCount: number
  /** 全局卡片宽度（默认 400，仅限制最小值） */
  cardWidth: number
  /** 全局卡片高度（默认 560，仅限制最小值） */
  cardHeight: number
  /** 分支连线方式（默认 direct） */
  connectionStyle: ConnectionStyle
  /** 双击最大间隔（默认 300ms，范围 100–1000） */
  doubleClickMs: number
  /** 按下后开始检测拖动的延迟（默认 0ms，范围 0–500） */
  dragDriftDelayMs: number
  /** 判定为拖动的最小位移（默认 10px，范围 0–50） */
  dragDriftDistance: number
  /** 卡片正文字号（默认 14，范围 12–24） */
  cardFontSize: number
  /** 自动保存间隔分钟数（默认 5，0 表示关闭） */
  autosaveMinutes: number
  /** 撤销步数（默认 10，最小 1） */
  undoSteps: number
  /** 主题色相（默认 173，范围 0–360） */
  themeHue: number
  /** 连线粗细（默认 1.5，范围 0.5–6） */
  edgeWidth: number
  /** 连线颜色（默认 #3a3f4a） */
  edgeColor: string
  /** 主题模式（默认跟随系统） */
  themeMode: ThemeMode
  /** 时间制式（默认 24 小时制） */
  timeFormat: TimeFormat
}

/** 更新设置入参：只提交要改的字段；apiKey 留空表示保持原 Key */
export interface SettingsPatch {
  provider?: ModelProvider
  apiKey?: string
  baseUrl?: string
  model?: string
  thinkingEnabled?: boolean
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
  openaiOrganization?: string
  openaiProject?: string
  openaiTemperatureEnabled?: boolean
  openaiTemperature?: number
  openaiMaxTokens?: number
  openaiReasoningEffort?: ReasoningEffort
  openaiTimeoutSeconds?: number
  suggestionCount?: number
  cardWidth?: number
  cardHeight?: number
  connectionStyle?: ConnectionStyle
  doubleClickMs?: number
  dragDriftDelayMs?: number
  dragDriftDistance?: number
  cardFontSize?: number
  autosaveMinutes?: number
  undoSteps?: number
  themeHue?: number
  edgeWidth?: number
  edgeColor?: string
  themeMode?: ThemeMode
  timeFormat?: TimeFormat
}
