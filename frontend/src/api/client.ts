import { isMock, mockApi } from './mock'
import type {
  GraphDTO,
  NodeCreateInput,
  NodeDTO,
  ProjectDTO,
  SettingsDTO,
  SettingsPatch,
  SuggestionDTO,
  Viewport,
} from './types'

/** 所有请求走同源 /api，开发环境由 vite 代理到后端 8000 端口 */
const API_BASE = '/api'

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请确认后端已启动')
  }
  if (!res.ok) throw new ApiError(res.status, await readError(res))
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** 前端用到的全部后端接口（Mock 与真实模式共用） */
export interface ApiClient {
  listProjects(): Promise<ProjectDTO[]>
  createProject(name?: string): Promise<GraphDTO>
  patchProject(id: string, patch: { name?: string; viewport?: Viewport }): Promise<ProjectDTO>
  /** 首轮回答完成后尝试自动命名（服务端会检查用户是否已手动改名） */
  autoNameProject(id: string): Promise<ProjectDTO>
  deleteProject(id: string): Promise<void>
  getGraph(projectId: string): Promise<GraphDTO>
  createNode(projectId: string, input: NodeCreateInput): Promise<NodeDTO>
  patchNode(
    id: string,
    patch: {
      x?: number
      y?: number
      pinned?: boolean
      title?: string
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
  /** 批量恢复节点（撤销删除），保留原 id */
  restoreNodes(projectId: string, nodes: NodeDTO[]): Promise<void>
  /** 保存当前画布快照，返回保存时间 */
  saveProject(projectId: string): Promise<{ savedAt: string }>
  setNodeQuestion(id: string, question: string): Promise<NodeDTO>
  generateSuggestions(id: string, count?: number): Promise<SuggestionDTO[]>
  /** 新增空分支卡片：后端按当前卡片尺寸计算坐标，返回输入态节点 */
  createBranch(nodeId: string): Promise<NodeDTO>
  getSettings(): Promise<SettingsDTO>
  updateSettings(patch: SettingsPatch): Promise<SettingsDTO>
}

const realApi: ApiClient = {
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

  // 后端按原 id 恢复，已存在的 id 会被跳过
  restoreNodes: (projectId, nodes) =>
    request<void>(`/projects/${projectId}/nodes/restore`, {
      method: 'POST',
      body: JSON.stringify({ nodes }),
    }),

  // 快照写入后端 saves 目录，只保留最新 1 份
  saveProject: (projectId) =>
    request<{ savedAt: string }>(`/projects/${projectId}/save`, { method: 'POST' }),

  setNodeQuestion: (id, question) =>
    request<NodeDTO>(`/nodes/${id}/question`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

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
}

/** VITE_MOCK=1 时切到本地内存假数据，接口形状与真实后端一致 */
export const api: ApiClient = isMock() ? mockApi : realApi
