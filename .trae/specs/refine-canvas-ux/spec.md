# 画布交互优化 Spec

change-id: `refine-canvas-ux`

## Why

当前版本在连续追问时卡片被逐级下移，形成「阶梯」；候选方向卡片纵向距离过大且可多选，容易一次生出多条非预期分支；卡片大小固定、无法按内容调节；拖动中间卡片时后续卡片不跟随。此外，密钥防泄漏需要更严格的仓库级保障。

## What Changes

- **安全**：加固 `.gitignore`（`.env*`、`*.db` 等），新增 `.githooks/pre-commit` 密钥扫描钩子，并审计当前仓库确认无密钥入库。
- **卡片尺寸**：新增全局统一卡片尺寸（默认 400×560），在卡片右边缘 / 下边缘拖拽调整，调整一张即应用到所有画布的所有卡片，并持久化。
- **候选方向**：改为紧凑纵向排列的独立小卡片；点击后展开为完整对话卡片；同一轮只能选择一条，选择后整组隐藏。
- **布局**：只有一个子节点时与父节点保持同一水平线（不再阶梯式）。
- **分支入口**：卡片底部「换一个方向」旁新增分支图标，点击即新增一个空分支卡片。
- **拖拽**：元问题卡片固定不可拖；其余卡片拖动时整棵子树同步移动并持久化。
- 版本号升至 `0.0.3`，README 中英同步更新 changelog。

## Impact

- Affected specs：`tree-canvas`（布局/分支/拖拽）、`suggestion`（候选方向交互）、`settings`（卡片尺寸）、`security`（密钥防泄漏）。
- Affected code：
  - 后端：`app/models.py`、`app/schemas.py`、`app/services/settings.py`、`app/api/settings.py`、`app/api/projects.py`、`app/api/nodes.py`、`tests/`
  - 前端：`api/{types,client,mock}.ts`、`store/graphStore.ts`、`canvas/{Canvas,CardNode,GhostNode,ghosts}.tsx|ts`、`components/SettingsDialog.tsx`（如需展示尺寸）
  - 仓库：`.gitignore`、`.githooks/pre-commit`、`readme.md`、`readme_en.md`、`frontend/package.json`

## 关键决策与假设

| 议题 | 决定 |
| --- | --- |
| 卡片「大小」 | 指卡片外框的**宽度与高度**；卡片改为固定高度，正文区域内部滚动。默认 400×560，**不设上限**，仅保留最小可用尺寸 280×240。 |
| 调整方式 | 卡片右边缘拖拽调宽度、下边缘拖拽调高度；拖拽过程实时预览，松手后保存一次。 |
| 「跨对话」 | 全局唯一尺寸，存在 `app_settings`，切换画布、刷新、重启后一致。 |
| 「点击后再扩展」 | 紧凑卡片点击后直接在该分支落点生成完整对话卡片（含问题与流式回答），不做二次确认。 |
| 「只能选一个」 | 每轮候选方向只允许选择一条；选择后该节点整组候选方向隐藏（后端持久化 `suggestions_consumed`）；点「换一个方向」开启新一轮后可再次单选。 |
| 「新增分支」 | 点击分支图标立即在父卡片右侧新增一张**空问题卡片**（输入态），用户直接输入；可重复点击生成多个分支槽位。 |
| 「平级」 | 父卡片只有 1 个子卡片时，子卡片 `y == 父卡片 y`；出现第 2 个及以上子卡片（分支）时才按垂直间距错开。 |
| 候选方向位置 | 紧凑组固定在父卡片右侧、顶部对齐父卡片顶部，组内间距 8px；不再与子卡片落点对齐。 |
| 元卡片拖拽 | 根节点 `draggable=false`，同时隐藏缩放手柄。 |

## ADDED / MODIFIED Requirements

### Requirement: 密钥防泄漏

仓库 SHALL 保证任何包含 API Key 的文件都不会被提交；`.gitignore` SHALL 覆盖 `.env`、`.env.*`（保留 `.env.example`）、`*.db`、`backend/data/`；仓库 SHALL 提供提交前扫描钩子。

#### Scenario: 忽略规则生效
- **WHEN** 执行 `git check-ignore -v backend/.env backend/data/app.db`
- **THEN** 两者均被匹配到忽略规则
- **AND** `git status` 中不出现 `backend/.env`、数据库文件或前端构建产物

#### Scenario: 提交前拦截
- **WHEN** 暂存区文件内容包含疑似 Key（`sk-` 长串或 `DEEPSEEK_API_KEY=<非空>`）
- **THEN** `.githooks/pre-commit` 以非零状态退出并列出文件名，提交被阻止

### Requirement: 全局卡片尺寸（MODIFIED）

系统 SHALL 提供全局唯一的卡片尺寸，支持在卡片边缘拖拽调整；调整结果 SHALL 立即应用到所有画布的所有卡片并持久化到 `app_settings`。

#### Scenario: 拖动右边缘调宽
- **WHEN** 用户拖拽某张卡片右边缘
- **THEN** 所有卡片宽度实时跟随；松手后写入设置，刷新页面仍保持
- **AND** 宽度不设上限，仅限制最小 280px，避免卡片内容不可用

#### Scenario: 拖动下边缘调高
- **WHEN** 用户拖拽卡片下边缘
- **THEN** 高度不设上限（最小 240px），正文超出后卡片内部滚动，卡片不被内容撑开
- **AND** 切换到另一个画布，卡片仍使用同一尺寸

#### Scenario: 只读一致性
- **THEN** 候选方向紧凑卡片、ghost 输入卡片不参与尺寸调整，保持自身固定尺寸

### Requirement: 紧凑候选方向（MODIFIED）

候选方向 SHALL 以紧凑纵向堆叠的独立小卡片呈现，每张仍为独立 React Flow 节点，禁止合并为表格或统一容器。

#### Scenario: 紧凑排列
- **WHEN** 某卡片回答完成
- **THEN** 其右侧出现 N 条候选方向（默认 3）+ 1 条输入项，纵向间距 8px，顶部与父卡片顶部对齐
- **AND** 每条只显示一行截断文本与「猜你想问」标签，不再按 380px 槽位分散

#### Scenario: 点击后展开
- **WHEN** 点击某条候选方向
- **THEN** 在父卡片右侧生成完整子卡片（问题为完整建议文本）并进入流式回答

### Requirement: 候选方向单选（MODIFIED）

同一节点的候选方向 SHALL 只允许选择一条；选择后整组候选方向 SHALL 从画布消失并在刷新后保持隐藏。

#### Scenario: 单选后隐藏
- **WHEN** 用户点击第 2 条候选方向
- **THEN** 子卡片创建成功，其余候选方向连同输入项全部消失
- **AND** 刷新页面后该组仍不显示

#### Scenario: 换一个方向开启新轮
- **WHEN** 用户点击「换一个方向」
- **THEN** 后端重新生成候选方向并解除隐藏，画布显示新一轮紧凑候选卡片，且仍只能再选一条

### Requirement: 平级续写布局（MODIFIED）

当父节点只有一个子节点时，子节点 SHALL 与父节点保持相同 Y 坐标；只有出现第二个及以上子节点时才纵向错开。

#### Scenario: 单链保持水平
- **WHEN** 用户依次创建 `元 → B → C`
- **THEN** 三张卡片位于同一条水平线上

#### Scenario: 分支才错开
- **WHEN** 从 B 再次新增一个分支卡片
- **THEN** 新卡片与 B 的纵向距离为「当前卡片高度 + 100px」，水平距离为「当前卡片宽度 + 320px」

### Requirement: 分支按钮

每张已完成回答的卡片 SHALL 在底部「换一个方向」旁展示一个分支图标按钮；点击 SHALL 创建一个空问题的分支卡片。

#### Scenario: 新增空分支
- **WHEN** 用户点击分支图标
- **THEN** 父卡片右侧新增一张输入态卡片，焦点落在其输入框
- **AND** 连续点击可创建多个分支槽位，各自独立

#### Scenario: 填写即开始回答
- **WHEN** 用户在该卡片输入问题并提交
- **THEN** 该卡片进入流式回答，其余分支槽位保持不变

### Requirement: 子树拖拽（MODIFIED）

除元问题卡片外，所有卡片 SHALL 可拖动；拖动某卡片时其全部后代 SHALL 同步平移相同位移。

#### Scenario: 拖拽带动子树
- **WHEN** 拖动含有子节点的卡片
- **THEN** 其所有后代（含更深层级）在拖动过程中保持相对位置同步移动
- **AND** 松手后所有受影响节点的新坐标被保存，刷新后保持

#### Scenario: 元卡片固定
- **WHEN** 尝试拖动元问题卡片
- **THEN** 卡片不移动（不可拖拽）

### Requirement: 版本与文档

项目 SHALL 将版本提升至 `0.0.3`，并在 `readme.md` 与 `readme_en.md` 同步追加本迭代的 changelog。

## 非目标（本次范围外）

- 每张卡片独立尺寸；旋转/等比缩放。
- 候选方向的手动排序、编辑、收藏。
- 多选候选方向。
- 触屏手势与移动端优化。
