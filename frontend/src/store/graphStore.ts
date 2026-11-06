import { create } from 'zustand'
import type { Node } from '@xyflow/react'
import { ApiError, api } from '../api/client'
import { streamAnswer } from '../api/sse'
import type { NodeDTO, ProjectDTO, SettingsDTO, SettingsPatch, Viewport } from '../api/types'
import { applyTheme } from '../lib/theme'

/** React Flow 卡片节点的数据类型 */
export type CardNodeData = { node: NodeDTO }

/** React Flow 问答卡片节点：类型固定为 card，id 直接使用后端节点 id */
export type CardFlowNode = Node<CardNodeData, 'card'>

/** React Flow 笔记卡片节点：数据结构与问答卡片一致，仅节点类型不同 */
export type NoteFlowNode = Node<CardNodeData, 'note'>

/** 画布上的真实节点（问答卡片 / 笔记卡片） */
export type GraphFlowNode = CardFlowNode | NoteFlowNode

/** 创建分支入参，坐标统一由后端按当前卡片尺寸计算 */
export interface CreateBranchPayload {
  origin: 'user' | 'suggestion'
  question: string
  suggestionId?: string
  /** 新卡片携带的附件 id 列表 */
  attachmentIds?: string[]
  x: number
  y: number
}

/** 分支输入条：挂在某张卡片下方，提交后才创建真正的子卡片 */
export interface BranchInput {
  id: string
  parentId: string
}

/** 全局卡片尺寸的最小值（与后端一致，无上限） */
const MIN_CARD_WIDTH = 280
const MIN_CARD_HEIGHT = 240

/** 全局卡片尺寸，默认值与后端一致 */
const DEFAULT_CARD_SIZE = { width: 400, height: 560 }

/** 正文字号自动放大卡片的基准：14px 对应 400×560 */
const BASE_CARD_FONT_SIZE = 14

/** 笔记卡片的默认尺寸与最小尺寸（与后端 constants 一致） */
export const NOTE_DEFAULT_WIDTH = 320
export const NOTE_DEFAULT_HEIGHT = 220
export const NOTE_MIN_WIDTH = 280
export const NOTE_MIN_HEIGHT = 240

/** 个人偏好设置：设置里与画布外观/交互相关的字段（不含 API Key 与模型参数） */
export type Preferences = Pick<
  SettingsDTO,
  | 'cardWidth'
  | 'cardHeight'
  | 'cardGap'
  | 'connectionStyle'
  | 'doubleClickMs'
  | 'dragDriftDelayMs'
  | 'dragDriftDistance'
  | 'wheelMode'
  | 'cardFontSize'
  | 'autosaveMinutes'
  | 'undoSteps'
  | 'themeHue'
  | 'edgeWidth'
  | 'edgeColor'
  | 'themeMode'
  | 'timeFormat'
  | 'provider'
  | 'webSearchEnabled'
  | 'sourcesPanelRatio'
  | 'panInertiaEnabled'
  | 'panInertiaCoefficient'
  | 'canvasStyle'
>

/** 与后端默认值保持一致，读取设置失败时沿用 */
const DEFAULT_PREFERENCES: Preferences = {
  cardWidth: DEFAULT_CARD_SIZE.width,
  cardHeight: DEFAULT_CARD_SIZE.height,
  cardGap: 80,
  connectionStyle: 'direct',
  doubleClickMs: 300,
  dragDriftDelayMs: 0,
  dragDriftDistance: 10,
  wheelMode: 'zoom-canvas',
  cardFontSize: 14,
  autosaveMinutes: 5,
  undoSteps: 10,
  themeHue: 173,
  edgeWidth: 1.5,
  edgeColor: '#3a3f4a',
  themeMode: 'system',
  timeFormat: '24h',
  provider: 'deepseek',
  webSearchEnabled: false,
  sourcesPanelRatio: 0.25,
  panInertiaEnabled: false,
  panInertiaCoefficient: 0.5,
  canvasStyle: 'none',
}

/** 从设置 DTO 中摘出偏好字段，保证 store 与后端返回值同形 */
function pickPreferences(settings: SettingsDTO): Preferences {
  return {
    cardWidth: settings.cardWidth,
    cardHeight: settings.cardHeight,
    cardGap: settings.cardGap,
    connectionStyle: settings.connectionStyle,
    doubleClickMs: settings.doubleClickMs,
    dragDriftDelayMs: settings.dragDriftDelayMs,
    dragDriftDistance: settings.dragDriftDistance,
    wheelMode: settings.wheelMode ?? 'zoom-canvas',
    cardFontSize: settings.cardFontSize,
    autosaveMinutes: settings.autosaveMinutes,
    undoSteps: settings.undoSteps,
    themeHue: settings.themeHue,
    edgeWidth: settings.edgeWidth,
    edgeColor: settings.edgeColor,
    themeMode: settings.themeMode,
    timeFormat: settings.timeFormat,
    provider: settings.provider,
    webSearchEnabled: settings.webSearchEnabled,
    sourcesPanelRatio: settings.sourcesPanelRatio ?? 0.25,
    panInertiaEnabled: settings.panInertiaEnabled ?? false,
    panInertiaCoefficient: settings.panInertiaCoefficient ?? 0.5,
    canvasStyle: settings.canvasStyle ?? 'none',
  }
}

/** 把补丁中与偏好相关的字段合并进当前偏好（忽略 Key 与模型参数） */
function mergePreferences(base: Preferences, patch: SettingsPatch): Preferences {
  return {
    cardWidth: patch.cardWidth ?? base.cardWidth,
    cardHeight: patch.cardHeight ?? base.cardHeight,
    cardGap: patch.cardGap ?? base.cardGap,
    connectionStyle: patch.connectionStyle ?? base.connectionStyle,
    doubleClickMs: patch.doubleClickMs ?? base.doubleClickMs,
    dragDriftDelayMs: patch.dragDriftDelayMs ?? base.dragDriftDelayMs,
    dragDriftDistance: patch.dragDriftDistance ?? base.dragDriftDistance,
    wheelMode: patch.wheelMode ?? base.wheelMode,
    cardFontSize: patch.cardFontSize ?? base.cardFontSize,
    autosaveMinutes: patch.autosaveMinutes ?? base.autosaveMinutes,
    undoSteps: patch.undoSteps ?? base.undoSteps,
    themeHue: patch.themeHue ?? base.themeHue,
    edgeWidth: patch.edgeWidth ?? base.edgeWidth,
    edgeColor: patch.edgeColor ?? base.edgeColor,
    themeMode: patch.themeMode ?? base.themeMode,
    timeFormat: patch.timeFormat ?? base.timeFormat,
    provider: patch.provider ?? base.provider,
    webSearchEnabled: patch.webSearchEnabled ?? base.webSearchEnabled,
    sourcesPanelRatio: patch.sourcesPanelRatio ?? base.sourcesPanelRatio,
    panInertiaEnabled: patch.panInertiaEnabled ?? base.panInertiaEnabled,
    panInertiaCoefficient: patch.panInertiaCoefficient ?? base.panInertiaCoefficient,
    canvasStyle: patch.canvasStyle ?? base.canvasStyle,
  }
}

function toFlowNode(node: NodeDTO): GraphFlowNode {
  return {
    id: node.id,
    // 笔记节点使用独立组件，避免渲染聊天专属 UI
    type: node.nodeType === 'note' ? 'note' : 'card',
    position: { x: node.x, y: node.y },
    data: { node },
  }
}

/** 流式中断控制器按节点维护，不进入 store 状态 */
const controllers = new Map<string, AbortController>()

/** 撤销快照：动作发生前的整份节点数据、动作名与当时的全局卡片尺寸 */
interface UndoEntry {
  nodes: NodeDTO[]
  label: string
  cardSize: { width: number; height: number }
}

/** 按画布隔离的撤销栈；模块级存储，避免进入 zustand 状态引起重渲染 */
const undoStacks = new Map<string, UndoEntry[]>()

/** PATCH 节点时可回写的字段（撤销时按差异提交） */
type NodePatchBody = {
  x?: number
  y?: number
  pinned?: boolean
  title?: string
  content?: string
  width?: number
  height?: number
  suggestions?: NodeDTO['suggestions']
  suggestionsConsumed?: boolean
}

/** toast 定时器：模块级，避免进入 store 状态 */
let toastTimer: number | null = null

/** 终止某个节点的流式请求（撤销「生成中卡片」时先中断再删除） */
function abortStream(nodeId: string): void {
  controllers.get(nodeId)?.abort()
  controllers.delete(nodeId)
}

/** 动作失败时丢弃刚压入的快照，避免撤销栈留下无效条目 */
function dropLastUndo(projectId: string | null): void {
  if (!projectId) return
  undoStacks.get(projectId)?.pop()
}

/** 计算把当前节点回退到快照需要提交的字段；无变化时返回 null */
function buildUndoPatch(node: NodeDTO, snapshot: NodeDTO): NodePatchBody | null {
  const patch: NodePatchBody = {}
  if (node.x !== snapshot.x) patch.x = snapshot.x
  if (node.y !== snapshot.y) patch.y = snapshot.y
  if (node.pinned !== snapshot.pinned) patch.pinned = snapshot.pinned
  // 标题（聊天卡片与笔记都复用 question）
  if (node.question !== snapshot.question) patch.title = snapshot.question
  // 笔记正文单独回写；聊天卡片的回答不由撤销覆盖
  if (node.nodeType === 'note' && node.answer !== snapshot.answer) patch.content = snapshot.answer
  if (node.nodeType === 'note') {
    if (node.width !== snapshot.width && snapshot.width !== null) patch.width = snapshot.width
    if (node.height !== snapshot.height && snapshot.height !== null) patch.height = snapshot.height
  }
  if (JSON.stringify(node.suggestions) !== JSON.stringify(snapshot.suggestions)) {
    patch.suggestions = snapshot.suggestions
  }
  // 新增子卡片会把父节点候选方向标记为已消费，撤销时一并恢复
  if (node.suggestionsConsumed !== snapshot.suggestionsConsumed) {
    patch.suggestionsConsumed = snapshot.suggestionsConsumed
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/** 收集一组节点及其全部后代 id（删除、拖动时本地同步使用） */
function collectSubtree(nodes: GraphFlowNode[], rootIds: string[]): Set<string> {
  const ids = new Set<string>(rootIds)
  let changed = true
  while (changed) {
    changed = false
    for (const item of nodes) {
      const parentId = item.data.node.parentId
      if (parentId && ids.has(parentId) && !ids.has(item.id)) {
        ids.add(item.id)
        changed = true
      }
    }
  }
  return ids
}

/** 元卡片：无父节点且为问答卡片（笔记节点同样 parentId 为空，不能当作元问题） */
function findRootNode(nodes: NodeDTO[]): NodeDTO | undefined {
  return nodes.find((node) => node.parentId === null && node.nodeType === 'chat')
}

interface GraphState {
  projects: ProjectDTO[]
  currentProjectId: string | null
  nodes: GraphFlowNode[]
  /** 主选中：最后点击的卡片，供底部追问条绑定 */
  selectedNodeId: string | null
  /** 多选集合；主选中始终包含在内 */
  selectedNodeIds: string[]
  isStreamingIds: string[]
  /** 分支输入条（卡片下方长条），提交后才创建子卡片 */
  branchInputs: BranchInput[]
  /** 全局卡片尺寸，所有画布共用一份 */
  cardSize: { width: number; height: number }
  /** 个人偏好设置（外观、画布交互与保存参数），全局共用 */
  preferences: Preferences
  /** 底部轻提示文案，2 秒后自动清空 */
  toast: string | null

  loadProjects: () => Promise<void>
  openProject: (id: string) => Promise<void>
  /** 把当前画布内容快照压入该画布的撤销栈（在改动之前调用） */
  pushUndo: (label: string) => void
  /** 撤销当前画布的最近一步；按快照差异恢复/删除/回写节点 */
  undo: () => Promise<void>
  /** 保存当前画布快照（手动 Ctrl+S 与自动保存共用），不影响撤销栈 */
  saveCurrentProject: () => Promise<void>
  /** 底部轻提示，2 秒后自动消失 */
  showToast: (message: string) => void
  createProject: (name?: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  /** 首轮回答完成后尝试自动命名；失败只告警，不影响画布 */
  autoNameProject: (id: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  /** 单选：清空其它选中并设为主选中 */
  setSelected: (id: string | null) => void
  /** Ctrl 多选切换：已选中则取消，否则追加并成为主选中 */
  toggleSelected: (id: string) => void
  /** 清空全部选中 */
  clearSelection: () => void
  /** 乐观切换固定状态，失败回滚 */
  togglePin: (nodeId: string) => Promise<void>
  /** 批量删除选中的卡片（含未选中分支时二次确认） */
  deleteSelected: () => Promise<void>
  /** 提交问题：待输入节点写入问题，已有问答的节点新建子卡片；返回要生成回答的节点 id */
  startQuestion: (nodeId: string, question: string, attachmentIds?: string[]) => Promise<string | null>
  /** 由 ghost 箭头创建子卡片，坐标以后端返回值为准 */
  createBranch: (parentId: string, payload: CreateBranchPayload) => Promise<void>
  /** 在指定卡片下方新增一条分支输入条 */
  addBranchInput: (parentId: string) => void
  /** 移除分支输入条 */
  cancelBranchInput: (inputId: string) => void
  /** 提交分支问题：创建子卡片、写入落点并开始生成回答 */
  submitBranchInput: (inputId: string, question: string) => Promise<void>
  /** 更新卡片标题并同步后端返回的修改时间 */
  updateNodeTitle: (nodeId: string, title: string) => Promise<void>
  /** 在画布指定坐标新建笔记卡片并选中 */
  createNoteAt: (x: number, y: number) => Promise<void>
  /** 更新笔记标题（乐观更新，失败回滚） */
  updateNoteTitle: (nodeId: string, title: string) => Promise<void>
  /** 更新笔记正文（乐观更新，失败回滚） */
  updateNoteContent: (nodeId: string, content: string) => Promise<void>
  /** 更新笔记独立尺寸，最小 280×240，无上限 */
  updateNoteSize: (nodeId: string, width: number, height: number) => Promise<void>
  runAnswer: (nodeId: string) => Promise<void>
  savePosition: (nodeId: string, x: number, y: number) => Promise<void>
  regenerate: (nodeId: string) => Promise<void>
  regenerateSuggestions: (nodeId: string) => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>
  setViewport: (viewport: Viewport) => Promise<void>
  /** 读取个人偏好设置（失败只告警，不阻塞画布），并同步卡片尺寸 */
  loadPreferences: () => Promise<void>
  /** 乐观更新个人偏好并持久化；失败回滚并抛出，成功返回后端最新设置 */
  updatePreferences: (patch: SettingsPatch) => Promise<SettingsDTO | null>
  /** 仅更新本地尺寸，用于拖拽实时预览 */
  setCardSize: (width: number, height: number) => void
  /** 把当前尺寸持久化到设置 */
  saveCardSize: () => Promise<void>
}

export const useGraphStore = create<GraphState>()((set, get) => {
  /** 只替换目标节点的数据，其余节点保持同一引用，配合 memo 避免整体重渲染 */
  const patchNode = (nodeId: string, patch: (node: NodeDTO) => NodeDTO) => {
    set((state) => ({
      nodes: state.nodes.map((item) =>
        item.id === nodeId ? { ...item, data: { node: patch(item.data.node) } } : item,
      ),
    }))
  }

  const removeStreamingId = (nodeId: string) => {
    set((state) => ({ isStreamingIds: state.isStreamingIds.filter((id) => id !== nodeId) }))
  }

  /** 把偏好写入 store，同时让卡片尺寸与设置保持一致 */
  const syncPreferences = (preferences: Preferences) => ({
    preferences,
    cardSize: { width: preferences.cardWidth, height: preferences.cardHeight },
  })

  return {
    projects: [],
    currentProjectId: null,
    nodes: [],
    selectedNodeId: null,
    selectedNodeIds: [],
    isStreamingIds: [],
    branchInputs: [],
    cardSize: { ...DEFAULT_CARD_SIZE },
    preferences: { ...DEFAULT_PREFERENCES },
    toast: null,

    loadProjects: async () => {
      const projects = await api.listProjects()
      set({ projects })
    },

    openProject: async (id) => {
      // 切换画布时中断旧画布仍在进行的流
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      const graph = await api.getGraph(id)
      const nodes = graph.nodes.map(toFlowNode)
      const root = findRootNode(graph.nodes)
      set({
        currentProjectId: id,
        nodes,
        selectedNodeId: root?.id ?? null,
        selectedNodeIds: root ? [root.id] : [],
        isStreamingIds: [],
        branchInputs: [],
        projects: get().projects.map((project) =>
          project.id === graph.project.id ? graph.project : project,
        ),
      })
    },

    pushUndo: (label) => {
      const projectId = get().currentProjectId
      if (!projectId) return
      // 深拷贝当前节点，避免后续乐观更新污染快照
      const snapshot: NodeDTO[] = JSON.parse(
        JSON.stringify(get().nodes.map((item) => item.data.node)),
      )
      const stack = undoStacks.get(projectId) ?? []
      // 卡片尺寸一并快照，撤销「调整卡片大小」时可恢复全局尺寸
      stack.push({ nodes: snapshot, label, cardSize: { ...get().cardSize } })
      const depth = Math.max(1, get().preferences.undoSteps)
      while (stack.length > depth) stack.shift()
      undoStacks.set(projectId, stack)
    },

    undo: async () => {
      const projectId = get().currentProjectId
      const stack = projectId ? undoStacks.get(projectId) : undefined
      const entry = stack?.pop()
      if (!projectId || !stack || !entry) {
        get().showToast('没有可撤销的操作')
        return
      }

      const current = get().nodes.map((item) => item.data.node)
      const currentById = new Map(current.map((node) => [node.id, node]))
      const snapshotById = new Map(entry.nodes.map((node) => [node.id, node]))
      // 三类差异：新增（快照没有）、删除（当前没有）、字段变化（两边都有）
      const created = current.filter((node) => !snapshotById.has(node.id))
      const deleted = entry.nodes.filter((node) => !currentById.has(node.id))

      // 新增节点：先按内容询问，确认后再中断流式并删除
      const createdIds = new Set(created.map((node) => node.id))
      for (const node of created) {
        if (node.answer.trim() || node.question.trim()) {
          if (!window.confirm('该卡片已有内容，是否删除？')) {
            // 取消则把快照放回栈顶，本次撤销不做任何改动
            stack.push(entry)
            return
          }
        }
      }

      try {
        // 先恢复全局卡片尺寸：与当前不同才提交，失败抛错交由下方统一处理
        const currentSize = get().cardSize
        if (
          entry.cardSize.width !== currentSize.width ||
          entry.cardSize.height !== currentSize.height
        ) {
          await get().updatePreferences({
            cardWidth: entry.cardSize.width,
            cardHeight: entry.cardSize.height,
          })
        }
        // 生成中的卡片先终止流式，避免删除后仍有事件写回已移除的节点
        for (const node of created) {
          if (node.status === 'streaming') abortStream(node.id)
        }
        // 只删除新增集合里的根节点，后代由后端级联删除
        for (const node of created) {
          if (node.parentId && createdIds.has(node.parentId)) continue
          try {
            await api.deleteNode(node.id)
          } catch (err) {
            // 节点已不存在时忽略，继续处理其它差异
            if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 404)) throw err
          }
        }

        // 被删除的节点按创建时间排序恢复，保证父节点先于子节点入库
        if (deleted.length > 0) {
          const ordered = [...deleted].sort((a, b) =>
            (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
          )
          await api.restoreNodes(projectId, ordered)
        }

        // 逐节点回写字段差异（坐标、固定、标题、正文、尺寸、候选方向）
        for (const node of current) {
          const snapshot = snapshotById.get(node.id)
          if (!snapshot) continue
          const patch = buildUndoPatch(node, snapshot)
          if (patch) await api.patchNode(node.id, patch)
        }
      } catch (err) {
        console.warn('撤销失败', err)
        window.alert('撤销失败，请重试')
        return
      }

      set((state) => ({
        isStreamingIds: state.isStreamingIds.filter((id) => !createdIds.has(id)),
      }))
      // 全部 API 成功后重新拉取图，保证 store 与后端一致，并清空选择
      await get().openProject(projectId)
      set({ selectedNodeId: null, selectedNodeIds: [] })
    },

    saveCurrentProject: async () => {
      const projectId = get().currentProjectId
      if (!projectId) return
      try {
        await api.saveProject(projectId)
        get().showToast('已保存')
      } catch (err) {
        console.warn('保存画布失败', err)
        window.alert('保存失败，请稍后重试')
      }
    },

    showToast: (message) => {
      if (toastTimer !== null) window.clearTimeout(toastTimer)
      set({ toast: message })
      toastTimer = window.setTimeout(() => {
        toastTimer = null
        set({ toast: null })
      }, 2000)
    },

    createProject: async (name) => {
      const graph = await api.createProject(name)
      const nodes = graph.nodes.map(toFlowNode)
      const root = findRootNode(graph.nodes)
      set((state) => ({
        projects: [graph.project, ...state.projects],
        currentProjectId: graph.project.id,
        nodes,
        selectedNodeId: root?.id ?? null,
        selectedNodeIds: root ? [root.id] : [],
        isStreamingIds: [],
        branchInputs: [],
      }))
    },

    renameProject: async (id, name) => {
      const project = await api.patchProject(id, { name })
      set((state) => ({
        // 合并而非替换，保留侧边栏需要的 rootQuestion / nodeCount
        projects: state.projects.map((item) => (item.id === id ? { ...item, ...project } : item)),
      }))
    },

    autoNameProject: async (id) => {
      try {
        const project = await api.autoNameProject(id)
        // 服务端可能因用户已改名而保持原名，这里按返回值覆盖即可
        set((state) => ({
          projects: state.projects.map((item) =>
            item.id === id ? { ...item, ...project } : item,
          ),
        }))
      } catch (err) {
        // 自动命名属于增强体验，失败不影响画布内容
        console.warn('画布自动命名失败', err)
      }
    },

    deleteProject: async (id) => {
      if (!window.confirm('确定删除这个画布及其全部卡片吗？此操作不可恢复。')) return
      await api.deleteProject(id)
      set((state) => {
        const rest = state.projects.filter((project) => project.id !== id)
        if (state.currentProjectId !== id) return { projects: rest }
        return {
          projects: rest,
          currentProjectId: null,
          nodes: [],
          selectedNodeId: null,
          selectedNodeIds: [],
          branchInputs: [],
        }
      })
    },

    setSelected: (id) => set({ selectedNodeId: id, selectedNodeIds: id ? [id] : [] }),

    toggleSelected: (id) =>
      set((state) => {
        // 已选中则取消；取消主选中时把剩余集合中最后一张卡片作为主选中
        if (state.selectedNodeIds.includes(id)) {
          const rest = state.selectedNodeIds.filter((item) => item !== id)
          return {
            selectedNodeIds: rest,
            selectedNodeId:
              state.selectedNodeId === id ? (rest[rest.length - 1] ?? null) : state.selectedNodeId,
          }
        }
        return { selectedNodeIds: [...state.selectedNodeIds, id], selectedNodeId: id }
      }),

    clearSelection: () => set({ selectedNodeId: null, selectedNodeIds: [] }),

    togglePin: async (nodeId) => {
      const node = get().nodes.find((item) => item.id === nodeId)?.data.node
      if (!node) return
      const pinned = !node.pinned
      get().pushUndo('固定状态')
      // 先本地切换，保证图标即时响应，失败再回滚
      patchNode(nodeId, (current) => ({ ...current, pinned }))
      try {
        const updated = await api.patchNode(nodeId, { pinned })
        patchNode(nodeId, (current) => ({ ...current, ...updated }))
      } catch (err) {
        console.warn('切换固定状态失败', err)
        dropLastUndo(get().currentProjectId)
        patchNode(nodeId, (current) => ({ ...current, pinned: node.pinned }))
        window.alert('切换固定状态失败，请稍后重试')
      }
    },

    deleteSelected: async () => {
      const { nodes, selectedNodeIds } = get()
      const selected = new Set(selectedNodeIds)
      if (selected.size === 0) return

      // 删除根：选中且父节点未被选中的卡片（其余选中项都是它的后代，由后端级联删除）
      const roots = nodes
        .filter((item) => {
          if (!selected.has(item.id)) return false
          const parentId = item.data.node.parentId
          return !(parentId && selected.has(parentId))
        })
        .map((item) => item.id)
        .filter((id) => {
          // 元问题卡片后端不允许删除，直接剔除
          const node = nodes.find((item) => item.id === id)?.data.node
          return !(node && node.parentId === null && node.nodeType === 'chat')
        })
      if (roots.length === 0) {
        window.alert('元问题卡片不能删除')
        return
      }

      const removing = collectSubtree(nodes, roots)
      // 选中集合之外仍存在后代时先确认，取消则完全不做删除
      if ([...removing].some((id) => !selected.has(id))) {
        if (!window.confirm('所选卡片包含未选中的分支，是否连同分支一起删除？')) return
      }

      // 先终止相关流式请求，避免删除后仍有事件写回已被移除的节点
      get().pushUndo('批量删除')
      for (const id of removing) {
        controllers.get(id)?.abort()
        controllers.delete(id)
      }

      try {
        await Promise.all(roots.map((id) => api.deleteNode(id)))
      } catch (err) {
        console.warn('批量删除失败', err)
        dropLastUndo(get().currentProjectId)
        window.alert('删除失败，请稍后重试')
        return
      }

      set((state) => ({
        nodes: state.nodes.filter((item) => !removing.has(item.id)),
        selectedNodeId: null,
        selectedNodeIds: [],
        isStreamingIds: state.isStreamingIds.filter((id) => !removing.has(id)),
      }))
    },

    startQuestion: async (nodeId, question, attachmentIds) => {
      const text = question.trim()
      if (!text) return null
      const projectId = get().currentProjectId
      if (!projectId) return null

      const node = get().nodes.find((item) => item.id === nodeId)?.data.node
      if (!node) return null

      // 待输入的卡片（通常是根卡片）直接写入问题
      if (node.status === 'input') {
        const updated = await api.setNodeQuestion(nodeId, text, attachmentIds)
        patchNode(nodeId, (current) => ({ ...current, ...updated }))
        // 根问题变化后同步画布摘要，侧边栏无需重新拉取列表即可显示
        if (node.parentId === null && node.nodeType === 'chat') {
          set((state) => ({
            projects: state.projects.map((project) =>
              project.id === projectId ? { ...project, rootQuestion: text } : project,
            ),
          }))
        }
        return nodeId
      }

      // 已有问答的卡片：新建子卡片并选中它
      const child = await api.createNode(projectId, {
        parentId: nodeId,
        question: text,
        origin: 'user',
        attachments: attachmentIds,
      })
      // 一旦继续追问，父卡片这一轮候选方向即结束，整组隐藏
      patchNode(nodeId, (current) => ({ ...current, suggestionsConsumed: true }))
      set((state) => ({
        nodes: [...state.nodes, toFlowNode(child)],
        selectedNodeId: child.id,
        selectedNodeIds: [child.id],
      }))
      return child.id
    },

    createBranch: async (parentId, payload) => {
      const projectId = get().currentProjectId
      if (!projectId) return
      get().pushUndo('新增卡片')

      let child: NodeDTO
      try {
        child = await api.createNode(projectId, {
          parentId,
          question: payload.question,
          origin: payload.origin,
          suggestionId: payload.suggestionId,
          attachments: payload.attachmentIds,
        })
      } catch (err) {
        console.warn('创建分支失败', err)
        dropLastUndo(projectId)
        window.alert('创建分支失败，请稍后重试')
        return
      }

      // 坐标直接用后端返回值，保证同一父卡片的兄弟节点错落一致
      set((state) => ({
        nodes: [...state.nodes, toFlowNode(child)],
        selectedNodeId: child.id,
        selectedNodeIds: [child.id],
      }))
      // 由建议派生的子卡片意味着该轮候选方向已被消费；自定义输入与分支输入同样隐藏整组
      patchNode(parentId, (node) => ({ ...node, suggestionsConsumed: true }))

      await get().runAnswer(child.id)
    },

    addBranchInput: (parentId) =>
      set((state) => ({
        branchInputs: [
          ...state.branchInputs,
          { id: `branch-input-${crypto.randomUUID()}`, parentId },
        ],
      })),

    cancelBranchInput: (inputId) =>
      set((state) => ({
        branchInputs: state.branchInputs.filter((item) => item.id !== inputId),
      })),

    submitBranchInput: async (inputId, question) => {
      const text = question.trim()
      if (!text) return
      const { branchInputs, nodes, currentProjectId } = get()
      const input = branchInputs.find((item) => item.id === inputId)
      if (!input || !currentProjectId) return
      const parent = nodes.find((item) => item.id === input.parentId)
      if (!parent) return

      let child: NodeDTO
      get().pushUndo('新增分支卡片')
      try {
        // 坐标由后端按当前卡片尺寸与分支规则计算，直接使用返回值
        child = await api.createNode(currentProjectId, {
          parentId: input.parentId,
          question: text,
          origin: 'user',
        })
      } catch (err) {
        console.warn('提交分支失败', err)
        dropLastUndo(currentProjectId)
        window.alert('创建分支失败，请稍后重试')
        return
      }

      // 分支输入提交后，父卡片这一轮候选方向同样结束
      patchNode(input.parentId, (node) => ({ ...node, suggestionsConsumed: true }))
      set((state) => ({
        nodes: [...state.nodes, toFlowNode(child)],
        branchInputs: state.branchInputs.filter((item) => item.id !== inputId),
        selectedNodeId: child.id,
        selectedNodeIds: [child.id],
      }))
      await get().runAnswer(child.id)
    },

    updateNodeTitle: async (nodeId, title) => {
      get().pushUndo('编辑卡片')
      try {
        const updated = await api.patchNode(nodeId, { title })
        // 合并后端返回值，question 与 updatedAt 一起刷新
        patchNode(nodeId, (node) => ({ ...node, ...updated }))
      } catch (err) {
        console.warn('更新标题失败', err)
        dropLastUndo(get().currentProjectId)
        window.alert('更新标题失败，请稍后重试')
      }
    },

    createNoteAt: async (x, y) => {
      const projectId = get().currentProjectId
      if (!projectId) return
      get().pushUndo('新建笔记')
      try {
        const note = await api.createNote(projectId, { x, y })
        // 新建后立即选中，用户可直接编辑标题与正文
        set((state) => ({
          nodes: [...state.nodes, toFlowNode(note)],
          selectedNodeId: note.id,
          selectedNodeIds: [note.id],
        }))
      } catch (err) {
        console.warn('创建笔记失败', err)
        dropLastUndo(projectId)
        window.alert('创建笔记失败，请稍后重试')
      }
    },

    updateNoteTitle: async (nodeId, title) => {
      const node = get().nodes.find((item) => item.id === nodeId)?.data.node
      if (!node || node.nodeType !== 'note') return
      const previous = node.question
      get().pushUndo('编辑卡片')
      // 先乐观更新，保证输入框失焦后标题立即生效
      patchNode(nodeId, (current) => ({ ...current, question: title }))
      try {
        const updated = await api.patchNode(nodeId, { title })
        patchNode(nodeId, (current) => ({ ...current, ...updated }))
      } catch (err) {
        console.warn('更新笔记标题失败', err)
        dropLastUndo(get().currentProjectId)
        patchNode(nodeId, (current) => ({ ...current, question: previous }))
      }
    },

    updateNoteContent: async (nodeId, content) => {
      const node = get().nodes.find((item) => item.id === nodeId)?.data.node
      if (!node || node.nodeType !== 'note') return
      const previous = node.answer
      get().pushUndo('编辑卡片')
      patchNode(nodeId, (current) => ({ ...current, answer: content }))
      try {
        const updated = await api.patchNode(nodeId, { content })
        patchNode(nodeId, (current) => ({ ...current, ...updated }))
      } catch (err) {
        console.warn('更新笔记正文失败', err)
        dropLastUndo(get().currentProjectId)
        patchNode(nodeId, (current) => ({ ...current, answer: previous }))
      }
    },

    updateNoteSize: async (nodeId, width, height) => {
      const node = get().nodes.find((item) => item.id === nodeId)?.data.node
      if (!node || node.nodeType !== 'note') return
      // 只限制最小值，无上限；尺寸只影响当前笔记
      const previous = { width: node.width, height: node.height }
      // 未变化的方向保持原值，不做最小值夹取（默认 220 高度只有拖动纵向时才需要抬到 240）
      const size = {
        width:
          previous.width !== null && Math.round(width) === Math.round(previous.width)
            ? previous.width
            : Math.max(NOTE_MIN_WIDTH, Math.round(width)),
        height:
          previous.height !== null && Math.round(height) === Math.round(previous.height)
            ? previous.height
            : Math.max(NOTE_MIN_HEIGHT, Math.round(height)),
      }
      get().pushUndo('编辑卡片')
      // 只提交实际发生变化的方向，避免后端把未拖动的高度按最小值夹取
      const patch: { width?: number; height?: number } = {}
      if (previous.width !== null && previous.width !== size.width) patch.width = size.width
      if (previous.height !== null && previous.height !== size.height) patch.height = size.height
      patchNode(nodeId, (current) => ({ ...current, ...size }))
      try {
        const updated = await api.patchNode(nodeId, patch)
        patchNode(nodeId, (current) => ({ ...current, ...updated }))
      } catch (err) {
        console.warn('更新笔记尺寸失败', err)
        dropLastUndo(get().currentProjectId)
        patchNode(nodeId, (current) => ({ ...current, ...previous }))
      }
    },

    runAnswer: async (nodeId) => {
      // 清空旧回答、来源并进入流式态
      patchNode(nodeId, (node) => ({
        ...node,
        answer: '',
        reasoning: '',
        error: null,
        status: 'streaming',
        suggestions: [],
        sources: [],
      }))
      set((state) => ({
        isStreamingIds: [...state.isStreamingIds.filter((id) => id !== nodeId), nodeId],
      }))

      // 先登记新控制器再中断旧流，避免旧流的清理逻辑覆盖本次状态
      const previous = controllers.get(nodeId)
      const controller = new AbortController()
      controllers.set(nodeId, controller)
      previous?.abort()

      // 流式文本按 ~30fps 批量写回：避免每个 token 都重新解析整段 Markdown，
      // 把 React 渲染预算留给界面动画，保证动画稳定在 60fps。
      let pendingAnswer = ''
      let pendingReasoning = ''
      let flushTimer: number | null = null

      const flush = () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer)
          flushTimer = null
        }
        if (pendingReasoning) {
          const chunk = pendingReasoning
          pendingReasoning = ''
          patchNode(nodeId, (node) => ({ ...node, reasoning: node.reasoning + chunk }))
        }
        if (pendingAnswer) {
          const chunk = pendingAnswer
          pendingAnswer = ''
          patchNode(nodeId, (node) => ({ ...node, answer: node.answer + chunk }))
        }
      }

      const scheduleFlush = () => {
        if (flushTimer !== null) return
        flushTimer = window.setTimeout(flush, 32)
      }

      const dropPending = () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer)
          flushTimer = null
        }
        pendingAnswer = ''
        pendingReasoning = ''
      }

      try {
        await streamAnswer(
          nodeId,
          {
            onSources: (sources) => patchNode(nodeId, (node) => ({ ...node, sources })),
            onReasoning: (reasoning) => {
              pendingReasoning += reasoning
              scheduleFlush()
            },
            onDelta: (delta) => {
              pendingAnswer += delta
              scheduleFlush()
            },
            onSuggestions: (suggestions) => {
              flush()
              patchNode(nodeId, (node) => ({ ...node, suggestions }))
            },
            onDone: () => {
              flush()
              patchNode(nodeId, (node) => ({ ...node, status: 'done' }))
              // 首轮回答完成且画布仍是默认名时，尝试让模型自动命名
              const state = get()
              const projectId = state.currentProjectId
              const node = state.nodes.find((item) => item.id === nodeId)?.data.node
              const project = state.projects.find((item) => item.id === projectId)
              if (
                projectId &&
                project?.name === '新画布' &&
                node?.parentId === null &&
                node.nodeType === 'chat'
              ) {
                void get().autoNameProject(projectId)
              }
            },
            onError: (error) => {
              flush()
              patchNode(nodeId, (node) => ({ ...node, status: 'error', error }))
            },
          },
          controller.signal,
        )
      } finally {
        // 新一轮请求已接管时不清理（避免覆盖新流的状态）
        if (controllers.get(nodeId) === controller) {
          flush()
          controllers.delete(nodeId)
          removeStreamingId(nodeId)
          patchNode(nodeId, (node) =>
            node.status === 'streaming'
              ? node.answer
                ? { ...node, status: 'done' }
                : { ...node, status: 'error', error: '回答被中断，请重试' }
              : node,
          )
        } else {
          // 旧流被新流替换：丢弃旧缓冲区，避免写进新回答
          dropPending()
        }
      }
    },

    savePosition: async (nodeId, x, y) => {
      set((state) => ({
        nodes: state.nodes.map((item) =>
          item.id === nodeId ? { ...item, position: { x, y } } : item,
        ),
      }))
      try {
        const updated = await api.patchNode(nodeId, { x, y })
        patchNode(nodeId, (node) => ({ ...node, ...updated }))
      } catch (err) {
        console.warn('保存节点坐标失败', err)
      }
    },

    regenerate: async (nodeId) => {
      await get().runAnswer(nodeId)
    },

    regenerateSuggestions: async (nodeId) => {
      get().pushUndo('换一批方向')
      try {
        const suggestions = await api.generateSuggestions(nodeId)
        // 换一个方向即开启新一轮，同时解除隐藏
        patchNode(nodeId, (node) => ({ ...node, suggestions, suggestionsConsumed: false }))
      } catch (err) {
        console.warn('重新生成候选方向失败', err)
        dropLastUndo(get().currentProjectId)
      }
    },

    deleteNode: async (nodeId) => {
      const node = get().nodes.find((item) => item.id === nodeId)?.data.node
      if (!node) return
      // 仅元问题卡片（根部的聊天卡片）不可删除；笔记没有父节点但允许删除
      if (node.parentId === null && node.nodeType === 'chat') {
        window.alert('元问题卡片不能删除')
        return
      }
      if (!window.confirm('确定删除这张卡片及其所有分支吗？此操作不可恢复。')) return

      const removing = collectSubtree(get().nodes, [nodeId])
      get().pushUndo('删除卡片')
      for (const id of removing) {
        controllers.get(id)?.abort()
        controllers.delete(id)
      }

      try {
        await api.deleteNode(nodeId)
      } catch (err) {
        console.warn('删除节点失败', err)
        dropLastUndo(get().currentProjectId)
        return
      }

      set((state) => ({
        nodes: state.nodes.filter((item) => !removing.has(item.id)),
        selectedNodeId:
          state.selectedNodeId && removing.has(state.selectedNodeId) ? null : state.selectedNodeId,
        selectedNodeIds: state.selectedNodeIds.filter((id) => !removing.has(id)),
        isStreamingIds: state.isStreamingIds.filter((id) => !removing.has(id)),
      }))
    },

    setViewport: async (viewport) => {
      const projectId = get().currentProjectId
      if (!projectId) return
      set((state) => ({
        projects: state.projects.map((project) =>
          project.id === projectId ? { ...project, viewport } : project,
        ),
      }))
      try {
        await api.patchProject(projectId, { viewport })
      } catch (err) {
        console.warn('保存视口失败', err)
      }
    },

    loadPreferences: async () => {
      try {
        const settings = await api.getSettings()
        const preferences = pickPreferences(settings)
        set(syncPreferences(preferences))
        applyTheme(preferences)
      } catch (err) {
        console.warn('读取个人设置失败', err)
      }
    },

    updatePreferences: async (patch) => {
      const previous = get().preferences
      // 字号变大时自动放大卡片：按 14px→400×560 的比例计算最小值，只放大不缩小
      let effectivePatch = patch
      if (patch.cardFontSize !== undefined && Number.isFinite(patch.cardFontSize)) {
        const minWidth = Math.round((DEFAULT_CARD_SIZE.width * patch.cardFontSize) / BASE_CARD_FONT_SIZE)
        const minHeight = Math.round(
          (DEFAULT_CARD_SIZE.height * patch.cardFontSize) / BASE_CARD_FONT_SIZE,
        )
        const width = Math.max(previous.cardWidth, minWidth)
        const height = Math.max(previous.cardHeight, minHeight)
        // 同一次 PUT 一并提交尺寸，保证刷新后卡片不会缩回
        if (width !== previous.cardWidth || height !== previous.cardHeight) {
          effectivePatch = { ...patch, cardWidth: width, cardHeight: height }
        }
      }
      const optimistic = mergePreferences(previous, effectivePatch)
      // 先乐观写入并立即应用，主题/连线颜色无需等待请求返回
      set(syncPreferences(optimistic))
      applyTheme(optimistic)
      try {
        const settings = await api.updateSettings(effectivePatch)
        const preferences = pickPreferences(settings)
        set(syncPreferences(preferences))
        applyTheme(preferences)
        return settings
      } catch (err) {
        console.warn('保存个人设置失败', err)
        // 回滚乐观更新后抛出，交由调用方提示失败
        set(syncPreferences(previous))
        applyTheme(previous)
        throw err
      }
    },

    setCardSize: (width, height) => {
      // 仅本地预览，松手后再保存；只限制最小值，并同步偏好保证单一来源
      const size = {
        width: Math.max(MIN_CARD_WIDTH, Math.round(width)),
        height: Math.max(MIN_CARD_HEIGHT, Math.round(height)),
      }
      set((state) => ({
        cardSize: size,
        preferences: { ...state.preferences, cardWidth: size.width, cardHeight: size.height },
      }))
    },

    saveCardSize: async () => {
      const { width, height } = get().cardSize
      try {
        await get().updatePreferences({ cardWidth: width, cardHeight: height })
      } catch (err) {
        // 拖拽缩放保存失败只告警，避免未处理的 rejection
        console.warn('保存卡片尺寸失败', err)
      }
    },
  }
})
