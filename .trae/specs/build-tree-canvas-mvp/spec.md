# 树状对话画布 Spec

change-id: `build-tree-canvas-mvp`

## Why

市面上的网页 AI 都是线性对话：越追问，主线越长，想回头比较另一条思路就必须新开对话。本项目把每一次问答变成画布上的一张卡片，从卡片右侧长出若干「候选方向」箭头，用户点选任意箭头即可沿该方向继续，从而把对话变成一棵可回看、可比较、可并行的思维树。

## What Changes

- 从零搭建仓库（当前仅有 git 初始化、`Reference_Doc/`、`.trae/`，无任何代码）。
- 前端（React + TypeScript + Vite）：深色无限画布、对话卡片、候选方向箭头、可折叠的画布侧边栏、底部追问输入条。
- 后端（Python 3.10 + FastAPI + SQLite）：画布/节点持久化、DeepSeek 流式回答、候选方向生成。
- 接入 DeepSeek（OpenAI 兼容协议：`https://api.deepseek.com`，模型 `deepseek-flash` / `deepseek-v4-pro`）。
- 非 **BREAKING**：全新项目，无既有功能可破坏。

## Impact

- Affected specs：新增能力 `tree-canvas`（画布/卡片/分支）、`ds-chat`（DeepSeek 问答）、`suggestion`（候选方向）。
- Affected code（规划路径）：
  - `backend/app/{main.py,db.py,models.py,schemas.py,api/*.py,services/*.py}`、`backend/tests/`
  - `frontend/src/{App.tsx,api/*,store/*,canvas/*,components/*}`
  - `.gitignore`、`backend/.env.example`、`backend/requirements.txt`、`frontend/.env.example`
- 运行方式：`backend` 用 `backend/.venv` 独立虚拟环境 + uvicorn；`frontend` 用 Vite dev server，`/api` 代理到 8000。

## 技术与配置决策（实现约束）

| 项 | 决定 |
| --- | --- |
| 画布库 | `@xyflow/react` v12（无限平移缩放、自定义节点） |
| 状态 | Zustand 单 store，卡片组件 `memo`，只订阅自身数据 |
| 自动布局 | 由图坐标 + 简易槽位算法；提供「自动重排」按钮（dagre, `rankdir: LR`） |
| 存储 | SQLite `backend/data/app.db`，SQLAlchemy 2.0；`parent_id` 自引用 |
| 模型接入 | `openai` Python SDK，`base_url` 可配，默认 DeepSeek；Key 只存后端 `.env` |
| 流式 | 后端 SSE（`POST` + 前端 `fetch` + `ReadableStream` 解析），不做自动重连 |
| 视觉 | 全局暗色主题（唯一主题，无浅色切换），令牌见「UI 设计规范」 |
| 卡片尺寸 | 宽 400px；回答区 `max-height: 420px` 内部滚动；圆角 12px |
| 建议箭头 | 未点选的建议渲染为 `ghost` 节点（260×44，半透明），点击后原地转正为子卡片 |

## UI 设计规范（暗色主题）

主题令牌 SHALL 统一定义在 `frontend/src/styles/theme.css`（CSS variables + Tailwind `@theme` 映射），组件内禁止散落硬编码颜色值。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--bg-canvas` | `#08090c` | 画布底色（近黑，非纯黑） |
| `--bg-panel` | `#0d0f13` | 侧边栏、底部输入条底色 |
| `--bg-card` | `#12141a` | 卡片底色 |
| `--bg-elevated` | `#181b21` | 输入框、悬浮按钮、思考过程区 |
| `--border-subtle` | `#24272f` | 卡片默认边框、分隔线 |
| `--border-strong` | `#33373f` | 悬停/聚焦边框 |
| `--text-primary` | `#e6e8ec` | 标题、主要文字 |
| `--text-body` | `#c9cbd1` | 回答正文 |
| `--text-muted` | `#7c818b` | 时间、摘要、占位符 |
| `--accent` | `#4ecdc4` | 问题标题、选中态、聚焦环、主按钮 |
| `--accent-dim` | `rgba(78,205,196,0.14)` | 选中背景、悬浮提示底 |
| `--danger` | `#f87171` | 错误态与删除确认 |
| `--edge` | `#3a3f4a` | 连线/箭头默认色 |
| `--ghost-bg` | `rgba(255,255,255,0.03)` | 建议箭头底色 |
| `--ghost-border` | `rgba(255,255,255,0.07)` | 建议箭头边框 |

- 字体栈：`Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`。
- 字号：问题标题 15px/600；回答正文 14px/1.65；建议箭头与摘要 13px；缩放百分比 12px。
- 间距：卡片内边距 16px；卡片间距 320px；建议箭头堆叠间距 12px；侧边栏列表项间距 4px。
- 组件外观：卡片圆角 12px + `1px solid var(--border-subtle)` + 轻微投影；图标按钮 28×28、圆角 8px、悬停底色 `rgba(255,255,255,0.06)`；滚动条宽 6px、滑块 `#2e323b`。
- 状态：流式中卡片边框轻微发光（`--accent` 20% 透明度）；选中卡片边框 `--accent` + 外发光；错误态边框 `--danger`；ghost 悬停时文字提亮、边框转 `--accent`。
- 动效：仅 140ms `ease-out` 的透明度/边框过渡；不使用大幅位移或视差。
- 画布背景点阵：`radial-gradient(circle, #1a1c22 1px, transparent 1px)`，间距 24px。
- 对比度：正文与卡片底的对比度不低于 4.5:1；`--text-muted` 仅用于非关键信息。
- 空态：无节点时画布中央显示柔和引导文案，使用 `--text-muted`，不使用大图插画。

## 接口一览（实现约定）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/api/projects` | 画布列表（含名称、根问题摘要、更新时间） |
| POST | `/api/projects` | 新建画布，body `{name?}`，同时返回自动创建的根节点 |
| PATCH | `/api/projects/{id}` | `{name?}` 或 `{viewport?}`（视口 `{x,y,zoom}` 持久化） |
| DELETE | `/api/projects/{id}` | 级联删除画布与其全部节点 |
| GET | `/api/projects/{id}/graph` | `{project, nodes}`，`edges` 由 `parent_id` 在前端派生 |
| POST | `/api/projects/{id}/nodes` | 建子节点 `{parentId, question, origin, suggestionId?}`，返回已分配坐标的节点 |
| PATCH | `/api/nodes/{id}` | `{x?,y?}` 坐标保存 |
| DELETE | `/api/nodes/{id}` | 级联删除子树；根节点返回 400；删除后父节点对应建议恢复「未使用」 |
| POST | `/api/nodes/{id}/question` | `{question}` 写入问题（用于根卡片首次输入） |
| POST | `/api/nodes/{id}/answer` | SSE：`reasoning` / `delta` / `suggestions` / `done` / `error` |
| POST | `/api/nodes/{id}/suggestions` | `{count?}` 重新生成未使用的建议 |

节点字段：`id, projectId, parentId, question, answer, reasoning, origin('root'|'user'|'suggestion'), suggestionId, status('input'|'pending'|'streaming'|'done'|'error'), error, suggestions[{id,text}], x, y, createdAt, updatedAt`。

## ADDED Requirements

### Requirement: 画布与元问题唯一性

系统 SHALL 以「画布」为最小项目单位，每个画布 SHALL 有且仅有一个元问题根节点，根节点 SHALL 在画布创建时自动生成且不可删除。

#### Scenario: 新建画布
- **WHEN** 用户点击侧边栏「新建画布」
- **THEN** 系统创建一个画布并自动创建根卡片，画布切换到新画布并 `fitView` 到根卡片
- **AND** 根卡片处于「待输入」态，显示输入框用于填写元问题

#### Scenario: 提交元问题
- **WHEN** 用户在根卡片输入元问题并提交
- **THEN** 根节点保存问题文本，随即进入流式回答状态

#### Scenario: 删除画布
- **WHEN** 用户在侧边栏对某画布选择删除并二次确认
- **THEN** 该画布的根节点及全部子节点被级联删除，画布从列表移除

### Requirement: 可折叠的画布切换侧边栏

系统 SHALL 提供左侧侧边栏，可收起/展开，用于列出与切换全部画布。

#### Scenario: 展开/收起
- **WHEN** 用户点击折叠按钮
- **THEN** 侧边栏收起到 48px 宽的竖条，画布区域自动占满剩余宽度，画布内容不缩放重排（仅视口变宽）
- **AND** 再次点击可展开为 240px 列表

#### Scenario: 切换画布
- **WHEN** 用户点击列表中的另一个画布
- **THEN** 画布切换到该项目图数据，并按其保存的视口显示；未保存视口时 `fitView`

#### Scenario: 列表项信息
- **THEN** 每项 SHALL 显示画布名称（默认可重命名）与根问题摘要（无则为「空画布」），并高亮当前项

### Requirement: 对话卡片

系统 SHALL 将每轮问答渲染为一张卡片：顶部为问题，主体为 Markdown 回答，底部为操作区。

#### Scenario: 流式回答
- **WHEN** 问答请求返回流式增量
- **THEN** 卡片内回答区实时追加文本并显示光标，期间卡片不可再向该节点追加子节点
- **AND** 回答区达到最大高度后在卡片内部滚动，卡片不被撑高

#### Scenario: 思考过程
- **WHEN** DeepSeek 返回 `reasoning_content`
- **THEN** 卡片在回答上方显示可折叠的「思考过程」区域（默认折叠，流式时显示「思考中…」）

#### Scenario: 卡片操作
- **THEN** 卡片提供：复制问题+回答到剪贴板、重新生成回答（清空回答重跑同一问题）、删除节点（仅非根节点，二次确认，级联删除子树）

#### Scenario: 失败
- **WHEN** 请求失败或流式中断
- **THEN** 卡片进入错误态，显示简要错误信息与「重试」按钮，重试复用同一节点重新请求

### Requirement: 候选方向箭头

系统 SHALL 在节点回答完成后，在其右侧生成 N 条模型猜测的候选方向 + 1 条自定义输入，N 默认 3、可配置范围 2–6，且每个节点仅生成一次（重新生成除外）。

#### Scenario: 生成箭头
- **WHEN** 某节点回答完成
- **THEN** 卡片右侧出现 N 条带标签的虚线箭头（`ghost` 节点）+ 1 条输入箭头，按父卡片右侧垂直居中堆叠
- **AND** 每条建议文本不超过 20 个汉字，超出截断展示

#### Scenario: 点选建议
- **WHEN** 用户点击某条建议箭头
- **THEN** 在原地创建子卡片（问题=该建议文本，`origin=suggestion`），该 ghost 消失，新卡片进入回答状态
- **AND** 父节点保留其余未使用的建议箭头

#### Scenario: 自定义输入
- **WHEN** 用户在输入箭头中键入问题并提交（Enter 提交，Shift+Enter 换行）
- **THEN** 创建子卡片（`origin=user`）并进入回答状态；输入箭头保持可用，以便继续新增子分支

#### Scenario: 重新生成建议
- **WHEN** 用户对节点点击「换一批方向」
- **THEN** 后端重新生成 N 条建议并替换未使用的建议（已生成子节点的建议保持不变）

### Requirement: 分支上下文隔离

系统 SHALL 在每次请求时按「根 → 当前节点」的唯一路径拼接上下文；兄弟分支的问答 SHALL NOT 出现在彼此的上下文中。

#### Scenario: 兄弟分支互不可见
- **WHEN** 存在 `元 → B → C` 与 `元 → B → D → E`
- **THEN** 请求 C 的回答时 messages 仅含 `元(Q,A)`、`B(Q,A)`、`C.question`
- **AND** 请求 E 的回答时 messages 仅含 `元(Q,A)`、`B(Q,A)`、`D(Q,A)`、`E.question`
- **AND** 上下文中不包含任何 `reasoning_content`

#### Scenario: 单测覆盖
- **THEN** `backend/tests/test_context.py` 覆盖：根节点、两层分支、兄弟分支、深链四种路径，且断言不含非祖先内容

### Requirement: 画布交互与持久化

系统 SHALL 提供无限画布（平移、缩放、拖拽节点），并持久化节点坐标与视口。

#### Scenario: 拖拽保存
- **WHEN** 用户拖动卡片结束
- **THEN** 前端调用 `PATCH /api/nodes/{id}` 保存新坐标，刷新页面后位置不变

#### Scenario: 缩放控制
- **THEN** 右下角显示缩放比例与 +/−/复位按钮；底部居中存在全局追问输入条，绑定当前选中卡片（未选中则绑定根卡片）

#### Scenario: 自动重排
- **WHEN** 用户点击工具栏「自动重排」
- **THEN** 全部节点按从左到右的 dagre 布局重排并保存坐标

### Requirement: DeepSeek 接入

系统 SHALL 通过后端调用 DeepSeek（OpenAI 兼容），API Key SHALL 仅存在于后端环境变量，且 SHALL NOT 出现在前端产物或仓库中。

#### Scenario: 默认配置
- **WHEN** 后端读取 `.env` 中的 `DEEPSEEK_API_KEY`
- **THEN** 使用 `base_url=https://api.deepseek.com`、`model=deepseek-flash`、`stream=true` 发起请求
- **AND** 思考模式由 `THINKING_ENABLED` 控制（默认开启），关闭时不发送 `thinking` 参数

#### Scenario: 可替换模型
- **WHEN** 修改 `DEEPSEEK_MODEL=deepseek-v4-pro` 或自定义 `DEEPSEEK_BASE_URL`
- **THEN** 无需改代码即可生效（用户接口只接受画布/节点数据，不接收模型名与 Key）

#### Scenario: 缺少 Key
- **WHEN** 未配置 `DEEPSEEK_API_KEY` 即发起问答
- **THEN** 后端返回可读错误（中文提示如何配置），前端在卡片错误态展示该提示

### Requirement: 暗色主题与视觉一致性

系统 SHALL 全局使用单一暗色主题（不提供浅色切换），所有颜色 SHALL 来自「UI 设计规范」中的令牌。

#### Scenario: 主题令牌集中管理
- **WHEN** 实现任意前端组件
- **THEN** 颜色取自 `theme.css` 中的 CSS 变量（经 Tailwind `@theme` 映射），组件内不出现硬编码色值
- **AND** 同一语义（如边框、强调色）在卡片、侧边栏、ghost 箭头、输入条中取值一致

#### Scenario: 首屏无白闪
- **WHEN** 页面首次加载
- **THEN** 在脚本执行前 `html/body` 即为 `--bg-canvas` 深色底，不出现白色或亮色闪烁

#### Scenario: 交互状态可辨识
- **WHEN** 卡片被选中、处于流式输出、处于错误态，或 ghost 箭头被悬停
- **THEN** 分别以 `--accent` 边框+外发光、`--accent` 20% 发光、`--danger` 边框、ghost 文字提亮+`--accent` 边框呈现，且过渡 140ms
- **AND** 正文与卡片底对比度 ≥ 4.5:1，`--text-muted` 不承载关键信息

#### Scenario: 深色画布观感
- **THEN** 画布为 `#08090c` 底 + 24px 间距点阵网格，不出现纯黑 `#000` 或纯白 `#fff` 大面积色块

## 非目标（本次范围外）

多用户/登录/协作、附件上传与解析、导出、图片生成、移动端适配、全文检索、节点合并/搬移子树、上下文自动摘要。
