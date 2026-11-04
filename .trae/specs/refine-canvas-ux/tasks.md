# Tasks

- [x] Task 1: 密钥防泄漏加固
  - [x] SubTask 1.1: 扩充 `.gitignore`：`.env`、`.env.*`（`!.env.example`）、`*.db`、`*.sqlite*`、`*.key`，保留 `backend/data/` 与 `Reference_Doc/`
  - [x] SubTask 1.2: 新增 `.githooks/pre-commit`（扫描暂存文件中 `sk-` 长串与 `DEEPSEEK_API_KEY=<非空>`，命中则列出文件并非零退出）
  - [x] SubTask 1.3: 验证：`git check-ignore -v backend/.env backend/data/app.db` 命中；`git status` 不含密钥/数据库文件；用临时文本自测钩子能拦截

- [x] Task 2: 后端设置与分支接口
  - [x] SubTask 2.1: `AppSetting` 新增 `card_width`（默认 400）与 `card_height`（默认 560）；`services/settings.py` 的 `effective/dto/update` 支持，**不设上限**，仅夹到最小值 280×240
  - [x] SubTask 2.2: `ConversationNode` 新增 `suggestions_consumed`（默认 false）；`POST /projects/{id}/nodes` 创建 `origin=suggestion` 的子节点时把父节点置为 true；`POST /nodes/{id}/suggestions` 重置为 false
  - [x] SubTask 2.3: 子节点坐标改用「当前设置尺寸」：`x = parent.x + card_width + 320`；`y = parent.y`（首个孩子）或 `parent.y + sibling_count * (card_height + 100)`（分支）
  - [x] SubTask 2.4: 新增 `POST /api/nodes/{id}/branch`：创建 `question=""`、`status="input"`、`origin="user"` 的空分支卡片，坐标同 2.3，返回节点
  - [x] SubTask 2.5: 新增/扩展测试：尺寸保存与夹取、consumed 置位/重置、分支接口、首子节点与父节点同 Y
  - [x] SubTask 2.6: 验证：`backend\.venv\Scripts\python.exe -m pytest backend\tests -q -p no:cacheprovider --tb=short` 全绿

- [x] Task 3: 前端数据层
  - [x] SubTask 3.1: `api/types.ts` 增加 `cardWidth/cardHeight`（SettingsDTO/Patch）与 `suggestionsConsumed`（NodeDTO）；`api/client.ts` 增加 `createBranch(nodeId)`；`api/mock.ts` 同步实现并持久化
  - [x] SubTask 3.2: `store/graphStore.ts` 增加 `cardSize` 状态与 `updateCardSize`（乐观更新 + PUT 设置）；`createBranch` 移除 ghost 坐标覆盖，选择建议后本地把父节点 `suggestionsConsumed=true`；`regenerateSuggestions` 后置 false
  - [x] SubTask 3.3: 新增 `addBranch(nodeId)`：调用分支接口 → 追加节点 → 选中；验证新卡片为输入态

- [x] Task 4: 卡片尺寸与分支按钮
  - [x] SubTask 4.1: `CardNode.tsx` 改用全局 `cardWidth/cardHeight`，正文区 `flex-1 overflow-y-auto`，移除固定 `max-h-[420px]`
  - [x] SubTask 4.2: 右边缘与下边缘两个拖拽手柄（`nodrag`，仅非根卡片且选中/悬停可见），拖动实时更新全局尺寸，松手保存；**不设上限**，仅限制最小 280×240
  - [x] SubTask 4.3: 底部操作区把「换一批方向」改为「换一个方向」，旁边加分支图标按钮（`GitBranch`），调用 `addBranch`
  - [x] SubTask 4.4: 根节点不可拖拽；验证拖拽手柄不触发卡片拖动

- [x] Task 5: 紧凑候选方向与平级布局
  - [x] SubTask 5.1: `canvas/ghosts.ts` 改为紧凑坐标：`x = 父卡片 x + 当前卡片宽度 + 320`、组顶部与父卡片顶部对齐、间距 8px；候选方向与输入项固定 280px 宽
  - [x] SubTask 5.2: 隐藏规则：`node.suggestionsConsumed === true` 时不生成候选方向；输入项同样不显示
  - [x] SubTask 5.3: `GhostNode.tsx` 压缩为单行（约 44px 高）、截断文本 + 「猜你想问」+ 箭头；`GhostInputNode.tsx` 保持同样紧凑高度
  - [x] SubTask 5.4: `Canvas.tsx` 拖拽子树：拖拽开始记录子树初始坐标，拖动中按 delta 同步更新所有后代，结束后批量保存；ghost 跟随父卡片自动重算
  - [x] SubTask 5.5: 自动重排改用当前 `cardWidth/cardHeight` 估算，`nodesep` 相应调整
  - [x] SubTask 5.6: 验证：`npm run build --prefix frontend` 成功

- [x] Task 6: 文档与版本
  - [x] SubTask 6.1: `frontend/package.json` 版本升至 `0.0.3`
  - [x] SubTask 6.2: `readme.md` / `readme_en.md` 顶部版本号改 0.0.3，changelog 追加 0.0.3（本次六项改动 + 密钥防泄漏 + 钩子启用方式 `git config core.hooksPath .githooks`）

- [x] Task 7: 端到端验收
  - [x] SubTask 7.1: 浏览器实测：卡片边缘缩放即时套用到另一画布、刷新保持；候选方向紧凑排列；单选后整组消失且刷新保持；换一个方向重新出现
  - [x] SubTask 7.2: 浏览器实测：元→B→C 同一水平线；分支按钮新增空卡片可输入；拖拽 B 带动 C 且刷新保持；元卡片不可拖
  - [x] SubTask 7.3: 回归：删除子树、流式回答、思考过程、侧边栏、设置弹窗仍正常；截图存 `.screenshots/`

# Task Dependencies

- Task 2 依赖 Task 1（可并行开工，但提交前需安全规则就位）
- Task 3 依赖 Task 2（接口契约）
- Task 4 依赖 Task 3（cardSize 与 addBranch）
- Task 5 依赖 Task 3（consumed 与坐标规则）
- Task 6 依赖 Task 4、Task 5（功能定型后再写 changelog）
- Task 7 依赖 Task 1–6
</file>
