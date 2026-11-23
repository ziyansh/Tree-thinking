import { isMock, mockApi } from './mock'
import { streamContinue } from './sse'
import type { StreamHandlers } from './sse'
import type {
  ArkModelInfo,
  ArkModelsResponse,
  AttachmentDTO,
  AuthSession,
  AuthUser,
  ExportFile,
  GraphDTO,
  ImportResult,
  NodeCreateInput,
  NodeDTO,
  NoteLinkDTO,
  ProjectDTO,
  SettingsDTO,
  SettingsPatch,
  SourceDTO,
  SuggestionDTO,
  Viewport,
} from './types'

/** 停止生成时一并提交的内存内容：后端据此落库，避免流式期间数据库未更新导致内容丢失 */
export interface StopNodePayload {
  answer: string
  reasoning: string
  sources: SourceDTO[]
}

/** 所有请求走同源 /api，开发环境由 vite 代理到后端 8000 端口 */
const API_BASE = '/api'

/** 用户名检查结果：reason 为不可用原因，可用时为 null */
export interface UsernameCheck {
  available: boolean
  reason: string | null
}

/** 后端返回的非 2xx 响应统一抛此错误，message 为后端 detail 的中文文案 */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 从错误响应体里取可读文案（兼容 detail 为字符串或校验错误数组） */
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) {
      const messages = body.detail.map((item) =>
        typeof item === 'object' && item !== null && 'msg' in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      if (messages.length > 0) return messages.join('；')
    }
  } catch {
    // 响应体不是 JSON，退回状态码文案
  }
  return `请求失败（HTTP ${res.status}）`
}

/** 401 统一处理：通知 App 会话已失效，随后仍照常抛出 ApiError（登录/注册失败为 400，不触发） */
function notifyUnauthorized(status: number): void {
  if (status !== 401) return
  window.dispatchEvent(new CustomEvent('tt:unauthorized'))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // 跨端口开发与 server 模式的 Cookie 会话都需要显式携带凭据
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请确认后端已启动')
  }
  if (!res.ok) {
    notifyUnauthorized(res.status)
    throw new ApiError(res.status, await readError(res))
  }
  if (res.status === 204) return undefined as T
  try {
    return (await res.json()) as T
  } catch {
    // 常见于 /api 未反向代理：静态服务器把 index.html 当作接口响应返回
    throw new ApiError(res.status, '接口返回的不是 JSON，请检查 /api 代理配置')
  }
}

/** 上传单个附件：multipart 表单字段名固定为 file，Content-Type 交给浏览器自动生成 */
async function uploadAttachmentFile(file: File): Promise<AttachmentDTO> {
  const formData = new FormData()
  formData.append('file', file)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/attachments`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请确认后端已启动')
  }
  if (!res.ok) {
    notifyUnauthorized(res.status)
    throw new ApiError(res.status, await readError(res))
  }
  return (await res.json()) as AttachmentDTO
}

/** 下载画布导出文件：响应体为附件二进制，失败时按统一结构抛错 */
async function downloadProjectFile(id: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/projects/${id}/export`, { credentials: 'include' })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请确认后端已启动')
  }
  if (!res.ok) {
    notifyUnauthorized(res.status)
    throw new ApiError(res.status, await readError(res))
  }
  return res.blob()
}

/** 前端用到的全部后端接口（Mock 与真实模式共用） */
export interface ApiClient {
  /** 当前会话：local 免登录，server 需要登录 */
  getSession(): Promise<AuthSession>
  register(username: string, password: string): Promise<AuthUser>
  login(username: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  /** 注册前检查用户名格式与是否已被占用 */
  checkUsername(username: string): Promise<UsernameCheck>
  /** 导出画布为 JSON 文件（Blob），供浏览器下载 */
  exportProject(id: string): Promise<Blob>
  /** 导入画布文件，返回新建画布与根节点 id */
  importProject(payload: ExportFile): Promise<ImportResult>
  listProjects(): Promise<ProjectDTO[]>
  createProject(name?: string): Promise<GraphDTO>
  patchProject(id: string, patch: { name?: string; viewport?: Viewport }): Promise<ProjectDTO>
  /** 首轮回答完成后尝试自动命名（服务端会检查用户是否已手动改名） */
  autoNameProject(id: string): Promise<ProjectDTO>
  deleteProject(id: string): Promise<void>
  getGraph(projectId: string): Promise<GraphDTO>
  /** 上传附件（multipart），返回附件元信息，图片 url 可直接用于 img src */
  uploadAttachment(file: File): Promise<AttachmentDTO>
  createNode(projectId: string, input: NodeCreateInput): Promise<NodeDTO>
  patchNode(
    id: string,
    patch: {
      x?: number
      y?: number
      pinned?: boolean
      title?: string
      /** 用户原始提问（卡片顶部抽屉编辑后重新提交） */
      prompt?: string
      /** 重新提交时整体覆盖附件 id 列表 */
      attachments?: string[]
      content?: string
      width?: number
      height?: number
      /** 整组回写候选方向（撤销「换一个方向」时使用） */
      suggestions?: SuggestionDTO[]
      /** 候选方向是否已消费（撤销新增卡片时回写） */
      suggestionsConsumed?: boolean
    },
  ): Promise<NodeDTO>
  deleteNode(id: string): Promise<void>
  /** 在画布指定坐标新建笔记卡片 */
  createNote(projectId: string, position: { x: number; y: number }): Promise<NodeDTO>
  /** 笔记卡片连接列表 */
  listNoteLinks(projectId: string): Promise<NoteLinkDTO[]>
  /** 建立回答卡片到笔记卡片的连接，重复连接由后端幂等返回 */
  createNoteLink(
    projectId: string,
    input: { answerNodeId: string; noteNodeId: string },
  ): Promise<NoteLinkDTO>
  /** 删除单条笔记连接 */
  deleteNoteLink(projectId: string, linkId: string): Promise<void>
  /** 全量覆盖笔记连接（撤销恢复使用） */
  syncNoteLinks(
    projectId: string,
    links: { answerNodeId: string; noteNodeId: string }[],
  ): Promise<NoteLinkDTO[]>
  /** 批量恢复节点（撤销删除），保留原 id */
  restoreNodes(projectId: string, nodes: NodeDTO[]): Promise<void>
  /** 保存当前画布快照，返回保存时间 */
  saveProject(projectId: string): Promise<{ savedAt: string }>
  setNodeQuestion(id: string, question: string, attachments?: string[]): Promise<NodeDTO>
  /** 停止生成：已有输出时保留内容并置 paused；根卡片无输出时回退到输入态 */
  stopNode(id: string, payload?: StopNodePayload): Promise<NodeDTO>
  /** 续写暂停的回答（SSE 流式），事件形状与 answer 接口一致 */
  continueNode(id: string, handlers: StreamHandlers, signal?: AbortSignal): Promise<void>
  generateSuggestions(id: string, count?: number): Promise<SuggestionDTO[]>
  /** 新增空分支卡片：后端按当前卡片尺寸计算坐标，返回输入态节点 */
  createBranch(nodeId: string): Promise<NodeDTO>
  getSettings(): Promise<SettingsDTO>
  updateSettings(patch: SettingsPatch): Promise<SettingsDTO>
  /** 恢复默认设置（保留已保存的 API Key） */
  resetSettings(): Promise<SettingsDTO>
  /** 火山方舟账号可见的模型列表（需要已保存 API Key） */
  listArkModels(): Promise<ArkModelInfo[]>
}

const realApi: ApiClient = {
  getSession: () => request<AuthSession>('/auth/session'),

  // 注册与登录成功后后端直接下发会话 Cookie，这里只返回用户信息
  register: async (username, password) => {
    const body = await request<{ user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    return body.user
  },

  login: async (username, password) => {
    const body = await request<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    return body.user
  },

  logout: async () => {
    await request<{ ok: boolean }>('/auth/logout', { method: 'POST' })
  },

  // 公开只读接口：失焦时检查用户名，最终仍由注册接口兜底校验
  checkUsername: (username) =>
    request<UsernameCheck>(`/auth/check-username?username=${encodeURIComponent(username)}`),

  exportProject: downloadProjectFile,

  importProject: (payload) =>
    request<ImportResult>('/projects/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listProjects: () => request<ProjectDTO[]>('/projects'),

  // 后端创建画布时同时返回自动创建的根节点
  createProject: (name) =>
    request<GraphDTO>('/projects', {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),

  patchProject: (id, patch) =>
    request<ProjectDTO>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  autoNameProject: (id) =>
    request<ProjectDTO>(`/projects/${id}/auto-name`, { method: 'POST' }),

  deleteProject: (id) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getGraph: (projectId) => request<GraphDTO>(`/projects/${projectId}/graph`),

  uploadAttachment: uploadAttachmentFile,

  createNode: (projectId, input) =>
    request<NodeDTO>(`/projects/${projectId}/nodes`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  patchNode: (id, patch) =>
    request<NodeDTO>(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteNode: (id) => request<void>(`/nodes/${id}`, { method: 'DELETE' }),

  createNote: (projectId, position) =>
    request<NodeDTO>(`/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify(position),
    }),

  listNoteLinks: (projectId) => request<NoteLinkDTO[]>(`/projects/${projectId}/links`),

  createNoteLink: (projectId, input) =>
    request<NoteLinkDTO>(`/projects/${projectId}/links`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteNoteLink: (projectId, linkId) =>
    request<void>(`/projects/${projectId}/links/${linkId}`, { method: 'DELETE' }),

  // 全量覆盖：body 为当前应保留的连接，撤销恢复时使用
  syncNoteLinks: (projectId, links) =>
    request<NoteLinkDTO[]>(`/projects/${projectId}/links`, {
      method: 'PUT',
      body: JSON.stringify({ links }),
    }),

  // 后端按原 id 恢复，已存在的 id 会被跳过
  restoreNodes: (projectId, nodes) =>
    request<void>(`/projects/${projectId}/nodes/restore`, {
      method: 'POST',
      body: JSON.stringify({ nodes }),
    }),

  // 快照写入后端 saves 目录，只保留最新 1 份
  saveProject: (projectId) =>
    request<{ savedAt: string }>(`/projects/${projectId}/save`, { method: 'POST' }),

  setNodeQuestion: (id, question, attachments) =>
    request<NodeDTO>(`/nodes/${id}/question`, {
      method: 'POST',
      body: JSON.stringify({ question, attachments }),
    }),

  stopNode: (id, payload) =>
    request<NodeDTO>(`/nodes/${id}/stop`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),

  continueNode: (id, handlers, signal) => streamContinue(id, handlers, signal),

  // 重新生成候选方向，已生成子卡片的建议由后端保留
  generateSuggestions: (id, count) =>
    request<SuggestionDTO[]>(`/nodes/${id}/suggestions`, {
      method: 'POST',
      body: JSON.stringify(count ? { count } : {}),
    }),

  createBranch: (nodeId) =>
    request<NodeDTO>(`/nodes/${nodeId}/branch`, { method: 'POST' }),

  // 应用设置：保存后后端立即使用新配置，无需重启
  getSettings: () => request<SettingsDTO>('/settings'),

  updateSettings: (patch) =>
    request<SettingsDTO>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  // 恢复默认：后端只重置非密钥字段，返回最新设置视图
  resetSettings: () => request<SettingsDTO>('/settings/reset', { method: 'POST' }),

  // 后端代理上游 Models 接口，未配置 Key 返回 400，上游失败返回 502
  listArkModels: async () => {
    const body = await request<ArkModelsResponse>('/ark/models')
    return body.models
  },
}

/** VITE_MOCK=1 时切到本地内存假数据，接口形状与真实后端一致 */
export const api: ApiClient = isMock() ? mockApi : realApi
