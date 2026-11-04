# Tasks

- [x] Task 1: 搭建前后端脚手架与运行配置
  - [x] SubTask 1.1: 创建 `backend/`（`.venv` 独立环境、`requirements.txt`、`app/main.py` 提供 `/health`、`.env.example` 含 DeepSeek 配置项、`.gitignore` 忽略 `.venv/data/app.db/.env/node_modules/dist`）
  - [x] SubTask 1.2: 创建 `frontend/`（Vite + React + TS + Tailwind v4 + `@xyflow/react` + `zustand` + `react-markdown`，`vite.config.ts` 代理 `/api → http://127.0.0.1:8000`）
  - [x] SubTask 1.3: 暗色主题基座：`src/styles/theme.css` 定义 spec「UI 设计规范」全部令牌并经 Tailwind `@theme` 映射；`index.html` 内联深色底防白闪；全局滚动条/字体栈
  - [x] SubTask 1.4: 验证：`uvicorn` 起后 `/health` 返回 200；`npm run dev` 打开为 `#08090c` 点阵画布，首屏无白闪

- [x] Task 2: 后端数据层与画布/节点 API
  - [x] SubTask 2.1: SQLAlchemy 模型 `projects` / `nodes`（含 `suggestions` JSON、`x/y`、`status`、`origin`、`suggestion_id`、`reasoning`）
  - [x] SubTask 2.2: 画布 API：`GET/POST /api/projects`、`PATCH`（重命名 / 保存视口）、`DELETE` 级联删除；创建画布时自动建唯一根节点
  - [x] SubTask 2.3: 节点 API：`GET /api/projects/{id}/graph`、`POST /api/projects/{id}/nodes`（创建子节点并分配坐标/置位）、`PATCH /api/nodes/{id}`（坐标）、`DELETE`（级联子树，根节点拒绝）、`POST /api/nodes/{id}/question`
  - [x] SubTask 2.4: 验证：用 `curl` 走完「建画布→取图→加子节点→改坐标→删子树」，数据库与返回结构符合 spec「接口一览」约定

- [x] Task 3: DeepSeek 客户端与流式回答 SSE
  - [x] SubTask 3.1: `services/llm.py` 用 `openai` SDK 指向可配置 `base_url`，读取 `DEEPSEEK_API_KEY/MODEL/THINKING_ENABLED`
  - [x] SubTask 3.2: `services/context.py` 实现「根→当前节点」路径拼 messages（不含 `reasoning_content`）
  - [x] SubTask 3.3: `POST /api/nodes/{id}/answer` 输出 SSE：`reasoning` / `delta` / `done` / `error`，并把最终 answer/reasoning 落库
  - [x] SubTask 3.4: 验证：假 LLM 流式用例 + 无 Key 用例 + 四个上下文路径用例全部通过

- [x] Task 4: 候选方向生成与替换
  - [x] SubTask 4.1: `services/suggestions.py` 用 JSON Output（`response_format=json_object`）生成 N 条 ≤20 字方向，解析失败降级为按行截断并记录日志
  - [x] SubTask 4.2: `POST /api/nodes/{id}/suggestions` 支持重新生成，保留已产生子节点的建议
  - [x] SubTask 4.3: 验证：单元测试解析成功/空 content/非法 JSON 三种情况；模型失败时兜底方向

- [x] Task 5: 前端画布与卡片
  - [x] SubTask 5.1: Zustand `graphStore`（nodes/edges/选中节点/视口）+ API client（含 SSE 解析器）
  - [x] SubTask 5.2: `Canvas.tsx`：React Flow 深色点阵背景、缩放控件（含百分比与复位）、底部全局追问输入条、拖拽结束保存坐标、`fitView` 策略（仅首次/切换画布）
  - [x] SubTask 5.3: `CardNode.tsx` 三种状态（待输入 / 流式中 / 完成+错误重试），Markdown 渲染、回答区内部滚动、思考过程折叠、复制/重新生成/删除；状态样式（选中/流式/错误）全部使用主题令牌
  - [x] SubTask 5.4: 验证：本地 mock 数据下可新建根问题、流式吐字、卡片内滚动、错误态显示重试
  - [x] SubTask 5.5: 视觉验收：组件中无硬编码色值（仅 `theme.css` 定义），正文对比度 ≥ 4.5:1，卡片/画布不出现纯黑纯白

- [x] Task 6: 建议箭头（Ghost）与分支创建
  - [x] SubTask 6.1: `GhostNode.tsx`（建议，点击转正）与 `GhostInputNode.tsx`（内嵌输入，Enter/Shift+Enter）
  - [x] SubTask 6.2: 创建子节点流程：POST 节点 → 原地替换 ghost → 打开该节点 SSE 流；父节点剩余箭头保留
  - [x] SubTask 6.3: 「换一批方向」与「自动重排」（dagre）按钮接入
  - [x] SubTask 6.4: 验证：同一卡片点两条不同建议形成两条分支；两条分支分别追问后回答互不引用
  - [x] SubTask 6.5: 修复「自动重排」节点尺寸估算（实际卡片约 572px 高，当前按 320 计算导致兄弟卡片纵向重叠）

- [x] Task 7: 左侧可折叠画布侧边栏
  - [x] SubTask 7.1: `Sidebar.tsx`（展开 240px / 收起 48px，列表项：名称、根问题摘要、高亮当前、新建/重命名/删除）
  - [x] SubTask 7.2: 切换画布时加载图数据并按需 `fitView`；画布为空时给出「输入元问题」引导
  - [x] SubTask 7.3: 验证：折叠/展开后画布可视区域变化且节点不位移；切换/刷新后当前画布与树结构保持

- [x] Task 8: 联调、持久化校验与验收
  - [x] SubTask 8.1: 端到端跑通 spec 中全部 Scenario（含错误路径、删除子树、重新生成）
  - [x] SubTask 8.2: 校验安全项：`git grep` 确认无密钥入库；`frontend/dist` 中不含 Key 与模型调用直连代码
  - [x] SubTask 8.3: 验证：`pytest -q` 通过；`npm run build` 通过；刷新页面后坐标、回答、建议全部还原

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 2（节点已可创建与读取）
- Task 4 依赖 Task 3（复用 LLM 客户端与上下文）
- Task 5 依赖 Task 1（可先用 mock 数据并行于 Task 2/3 进行）
- Task 6 依赖 Task 5 与 Task 2
- Task 7 依赖 Task 2 与 Task 5
- Task 8 依赖 Task 3、Task 4、Task 6、Task 7
