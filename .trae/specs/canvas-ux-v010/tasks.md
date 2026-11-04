# Tasks

- [x] Task 1: 后端节点字段、设置项与保存/恢复接口
  - [x] SubTask 1.1: `ConversationNode` 新增 `pinned`（默认 False）、`node_type`（默认 `chat`）、`width/height`（可空，仅笔记使用）；根节点创建时 `pinned=True`；`db.py` 补列迁移并把已有根节点置为 pinned
  - [x] SubTask 1.2: `AppSetting` 新增：`connection_style`（direct/bus，默认 direct）、`long_press_ms`（默认 300）、`autosave_minutes`（默认 5，0=关闭）、`undo_steps`（默认 10，最小 1）、`theme_hue`（默认 173，0–360）、`edge_width`（默认 1.5）、`edge_color`（默认 #3a3f4a）、`theme_mode`（system/light/dark，默认 system）、`time_format`（24h/12h，默认 24h）；同步 `services/settings.py` 的 effective/dto/update 与 `SettingsPatch`
  - [x] SubTask 1.3: `NodePatch` 扩展 `pinned/title/content/width/height`（title/content 仅在对应节点类型上生效），PATCH 接口落库并刷新 `updated_at`
  - [x] SubTask 1.4: 新增 `POST /api/projects/{id}/notes {x,y}` 创建笔记节点（`node_type='note'`、`status='done'`、空标题/正文、默认 320×220）；新增 `POST /api/projects/{id}/nodes/restore {nodes:[...]}` 批量恢复节点（保留原 id，用于撤销删除）
  - [x] SubTask 1.5: 新增 `POST /api/projects/{id}/save`：把当前画布完整节点 JSON 写到 `backend/data/saves/{projectId}.json`（单文件覆盖），返回保存时间；目录已随 `backend/data/` 被 ignore
  - [x] SubTask 1.6: 测试：设置新字段默认/范围、pin、笔记创建与独立尺寸、restore、save 文件生成；`pytest` 全绿

- [x] Task 2: 前端设置与主题外观
  - [x] SubTask 2.1: `api/types.ts` / `client.ts` / `mock.ts` 同步新设置字段与 `createNote`、`restoreNodes`、`saveProject`、扩展 `patchNode`
  - [x] SubTask 2.2: `styles/theme.css` 增加 `[data-theme="light"]` 全套令牌与 `--on-accent`、`--dot-color`；浅/深/跟随系统由 `<html data-theme>` 控制，系统模式监听 `matchMedia`
  - [x] SubTask 2.3: 运行时应用主题色相（`--accent`/`--accent-dim` 由 HSL 生成）、连线粗细/颜色、时间制式；`Canvas` 点阵颜色读取主题令牌
  - [x] SubTask 2.4: `SettingsDialog` 扩展选项卡：模型服务 / 画布（连接方式）/ 移动（空白长按毫秒）/ 保存（自动保存分钟、保存步数）/ 外观（主题模式、色相滑条+数值、连线粗细+颜色、时间制式）；保存后立即生效并持久化

- [x] Task 3: 画布手势、选择、拖动与固定
  - [x] SubTask 3.1: 平移规则：空格+左键 / 中键 / 空白长按 `longPressMs`（可配）；关闭普通左键平移；保留滚轮缩放
  - [x] SubTask 3.2: 多选：Ctrl+左键切换，空白点击清空；未按 Ctrl 点击卡片改为单选
  - [x] SubTask 3.3: 拖动：仅标题区作为 drag handle；直接按住拖动即可移动（无需先选中）；拖动时子树同步；多选时选中卡片及其子树一起移动（去重）
  - [x] SubTask 3.4: 卡片固定按钮（顶部最右，`Pin` 图标，固定时高亮）；固定卡片不能直接拖动；元卡片默认固定；pin 状态持久化并可撤销
  - [x] SubTask 3.5: 多选浮动菜单（顶部居中）：显示已选数量、「删除所选」「取消选择」；存在未选中后代时二次确认，确认后删除所选卡片及其分支

- [x] Task 4: 卡片/笔记 UI、标题编辑、缩放与吸附
  - [x] SubTask 4.1: 图层：猜你想问与分支输入条使用更高 `zIndex`（高于卡片），点击/输入不被遮挡
  - [x] SubTask 4.2: 分支入口改为「下方长条输入框」：标签/占位「请输入你的分支问题」，自动聚焦，Enter 后创建卡片；可重复点击生成多条分支输入框
  - [x] SubTask 4.3: 标题双击编辑（Enter/失焦提交、Esc 取消）；提交后更新 `updated_at` 并可撤销
  - [x] SubTask 4.4: 缩放改为四边+四角命中区：上下边只改高度、左右边只改宽度、角同时改；聊天卡片改全局尺寸，笔记改自身尺寸；移除现有两条调整线
  - [x] SubTask 4.5: Shift 吸附：20px 网格 + 其它卡片边缘/中心线 8px 内对齐（拖动子树整体吸附）
  - [x] SubTask 4.6: `NoteNode` 组件：双击空白画布创建；标题可编辑、正文 textarea、独立尺寸、选中/多选/pin/删除；不参与自动整理、无连线与建议

- [x] Task 5: 连线系统（直接分支 / 共用母线 / 绕行）
  - [x] SubTask 5.1: 主链边保持左→右；分支边（同一父节点第 2 个及以后子节点）按设置选择连接方式
  - [x] SubTask 5.2: 直接分支：父卡片上/下边中点 ↔ 子卡片上/下边中点，按子卡片相对位置选择上/下；默认下
  - [x] SubTask 5.3: 共用母线：父卡片右侧水平引线 → 统一纵向母线 → 子卡片左侧中点
  - [x] SubTask 5.4: 自定义边组件做障碍绕行：路径穿过其它卡片时从上方或下方绕行（主链、分支、母线、ghost 全部适用）
  - [x] SubTask 5.5: 边样式读取设置中的粗细/颜色；ghost 虚线保持
  - [x] SubTask 5.6: 验证：两种连接方式截图对比；连线不穿过任何卡片

- [x] Task 6: 自动整理（含猜你想问与 fork）
  - [x] SubTask 6.1: 共用母线模式：dagre LR 布局，猜你想问作为独立占位卡片参与布局，连线按母线样式渲染
  - [x] SubTask 6.2: 直接分支模式：主干保持水平，fork 子树整体排在父树下方（lane 递增），猜你想问同样占位
  - [x] SubTask 6.3: 布局后进行碰撞检查：任意卡片/猜你想问矩形不得重叠（必要时按列下推）
  - [x] SubTask 6.4: 自动整理结果写入坐标并可被撤销；笔记卡片保持原位不参与整理
  - [x] SubTask 6.5: 验证：两种模式下整理后无重叠、main 与 fork 可区分

- [x] Task 7: 撤销与保存
  - [x] SubTask 7.1: 每个画布独立的内存撤销栈（深度取设置 `undoSteps`，默认 10、最小 1）；切换画布保留，刷新清空
  - [x] SubTask 7.2: 在画布内容变更前压入快照：位置、标题/正文、pin、建议、自动整理、笔记创建/编辑/尺寸、删除批次；个人设置不入栈
  - [x] SubTask 7.3: Ctrl+Z 执行回退：缺失节点用 restore 接口恢复、新增节点按「已回答询问 / 生成中终止并删除 / 空白直接删」处理、字段与坐标用 PATCH 回写；删除批次整体恢复
  - [x] SubTask 7.4: Ctrl+S 保存当前画布快照；自动保存定时器按 `autosaveMinutes`（0 关闭），保存不影响撤销；保存成功给出轻提示
  - [x] SubTask 7.5: 快捷键仅在非输入框聚焦时触发；与标题编辑、备注输入互不干扰
  - [x] SubTask 7.6: 验证：连续 3 次拖动逐次撤销、按画布隔离、删除整批恢复、保存后仍可撤销

- [x] Task 8: 修改时间与版本文档
  - [x] SubTask 8.1: 聊天气泡与笔记卡片外部右下角显示修改时间 `yyyy-mm-dd hh-mm`（12 小时制加 AM/PM）；随 `updatedAt` 实时更新
  - [x] SubTask 8.2: `frontend/package.json` 升级 `0.1.0`；`readme.md` / `readme_en.md` 顶部版本与 changelog 增加 0.1.0（覆盖本次全部功能）
  - [x] SubTask 8.3: README 补充新设置项说明（画布/移动/保存/外观）与笔记卡片用法

- [x] Task 9: 端到端验收与回归
  - [x] SubTask 9.1: 两种连接方式与自动整理：无重叠、fork 可区分、母线正确
  - [x] SubTask 9.2: 手势与拖动：空格/中键/长按平移、Ctrl 多选、标题拖动、多选联动、pin、元卡片默认固定
  - [x] SubTask 9.3: 分支长条输入、标题双击、边角缩放、Shift 吸附、连线绕行
  - [x] SubTask 9.4: 撤销全场景（拖动/标题/新增/删除/整理/pin）与 Ctrl+S/自动保存、按画布隔离
  - [x] SubTask 9.5: 外观：色相、连线样式、浅/深/跟随系统、12/24 小时制；笔记卡片与修改时间
  - [x] SubTask 9.6: 回归：流式回答、候选方向单选、侧边栏、模型设置、删除子树；`pytest` 与 `npm run build` 全绿

# Task Dependencies

- Task 2、Task 3 依赖 Task 1
- Task 4 依赖 Task 2（主题/尺寸/设置）与 Task 3（选择/pin）
- Task 5 依赖 Task 2（连线样式设置）与 Task 4（节点尺寸）
- Task 6 依赖 Task 5（连接方式）与 Task 4（ghost 尺寸）
- Task 7 依赖 Task 3、Task 4、Task 6（需要全部画布变更入口）
- Task 8 依赖 Task 4（修改时间）与功能定型
- Task 9 依赖 Task 1–8
</file>
