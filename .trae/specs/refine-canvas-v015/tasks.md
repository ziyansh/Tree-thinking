# Tasks

- [x] Task 1: 修复分支卡片落点、侧边栏副标题与画布拖动规则
  - [x] SubTask 1.1: `submitBranchInput` 删除前端坐标覆盖，直接使用后端 `next_child_position` 返回坐标，并清理不再使用的落点计算变量（`graphStore.ts`）
  - [x] SubTask 1.2: 删除侧边栏画布条目下的摘要行与 `summaryOf`（`Sidebar.tsx`）
  - [x] SubTask 1.3: 空格按住时禁用卡片拖动（`nodesDraggable={false}`）、禁用文字选中（画布容器 `user-select: none`）；中键拖动保持画布平移；松开后恢复原规则（`Canvas.tsx`）
  - 验证：直接分支第二个子卡片与父卡片纵向距离为 1 个「卡片高度 + 间距」；空格/中键拖动任何位置都平移画布；侧边栏不再出现「空画布」

- [x] Task 2: 猜你想问完整显示与自适应高度
  - [x] SubTask 2.1: `GhostNode.tsx` 去除 `truncate`，改为 `w-max min-w-[280px] max-w-[420px]` + `whitespace-normal break-words`，高度自适应
  - [x] SubTask 2.2: `ghosts.ts` 与 `layout.ts` 共用一个候选方向高度估算函数（按字符数与 420px 上限估算行数），保证堆叠不重叠、自动整理 ghost 占位一致
  - 验证：长候选方向无省略号、自动换行；相邻候选方向不重叠；自动重排后候选方向不与卡片重叠

- [x] Task 3: 后端联网搜索与来源存储
  - [x] SubTask 3.1: 创建设置项 `web_search_enabled`（`models.py`、`db.py` 补列、`schemas.py`、`services/settings.py` effective/dto/update，默认 false）
  - [x] SubTask 3.2: 新增 `services/search.py`：按 DeepSeek base URL 拼接 `/v1/tools/search`，用 DeepSeek Key 鉴权，请求 `count=10`、`need_content=false`，返回精简来源列表；异常统一吞掉并记录日志
  - [x] SubTask 3.3: 节点新增 `sources` 字段（`models.py`、`db.py`、`schemas.py` 的 NodeOut/NodeRestoreItem、`graph.node_to_dto`）；回答开始时清空、搜索成功后落库
  - [x] SubTask 3.4: `api/nodes.py` 回答链路接入：开关开启且服务商为 DeepSeek 时先搜索，把摘要作为 system 消息插到最后一个 user 消息之前；先推送 `sources` SSE 事件，再进入模型流式输出
  - [x] SubTask 3.5: 补充后端测试：设置项默认/回读、来源落库与 DTO、搜索失败不阻断回答（用 monkeypatch 替换搜索函数）
  - 验证：`pytest` 全绿；开启搜索时节点 `sources` 有值；关闭或非 DeepSeek 时无来源

- [x] Task 4: 前端联网搜索开关与来源悬浮窗
  - [x] SubTask 4.1: `SettingsDTO/Patch`、`Preferences`、`mock.ts` 增加 `webSearchEnabled` 与 `provider`；store 提供切换方法（复用 `updatePreferences`）
  - [x] SubTask 4.2: `Canvas.tsx` 左上角 Panel 改为「自动重排 + 联网搜索」两个按钮；启用高亮；非 DeepSeek 置灰并提示
  - [x] SubTask 4.3: `sse.ts` 增加 `onSources` 事件解析；`graphStore.runAnswer` 在开始时清空 sources、收到事件时写入
  - [x] SubTask 4.4: `CardNode.tsx` 底部左侧新增「参考 N 篇资料 ›」入口；点击展开悬浮窗（标题/链接/站点/时间/摘要），再次点击或 Esc 折叠
  - 验证：开关状态刷新后保持；回答完成出现来源入口；Esc 与再次点击均可折叠；OpenAI 兼容下按钮禁用

- [x] Task 5: 设置界面重构
  - [x] SubTask 5.1: 重写 `SettingsDialog.tsx` 骨架：三选项卡顺序、弹窗 1040×760、侧栏 200px、新增 `Section`（二级标题 + 分隔线）与左右分栏 `Row` 组件
  - [x] SubTask 5.2: 新增 `SliderNumber`（滑块 + 数字输入胶囊）与 `NumberInput`（仅数字）控件；接入所有有界/无界数值项；数值失焦时整数截断、夹取边界、空值还原
  - [x] SubTask 5.3: 新增 `HueSlider`（彩虹渐变轨道 + 滑块 + 数值徽标 + 恢复默认 173），样式写入 `styles/theme.css`
  - [x] SubTask 5.4: 服务商改为下拉选择（DeepSeek / OpenAI 兼容）；补全 OpenAI 兼容文案、去掉 `sk-` 提示；「保存」并入画布「保存」分区
  - [x] SubTask 5.5: 保存失败展示后端具体原因：`updatePreferences` 失败时抛出错误，`SettingsDialog` 捕获并显示；`saveCardSize` 捕获后仅告警
  - 验证：设置弹窗布局与图 8 一致；所有有界数值项显示滑块；色相可预览与重置；非法输入被修正；保存失败显示具体原因

- [x] Task 6: 卡片文案与细节
  - [x] SubTask 6.1: 卡片标题字号由 `+1px` 改为 `+2px`（标题与编辑输入框同步）
  - [x] SubTask 6.2: fork 按钮改为「图标 + 新建分支」，标题与 aria 同步为「新建分支」
  - 验证：标题字号变大 1px；卡片底部显示「新建分支」文字

- [x] Task 8: 后端附件上传、存储与上下文注入
  - [x] SubTask 8.1: `config.py` 增加 `UPLOAD_DIR`（默认 `backend/data/uploads`，启动时创建）；`requirements.txt` 增加 `python-multipart`
  - [x] SubTask 8.2: 新增 `services/attachments.py` 与 `api/attachments.py`：`POST /api/attachments` 接收 multipart 文件（单文件 ≤20MB、单条 ≤10 个），保存为 `uploads/{id}{后缀}`，返回 `{id,name,mime,size,kind,url}`；`GET /api/attachments/{filename}` 安全地回读文件（禁止路径穿越）
  - [x] SubTask 8.3: 节点新增 `attachments` JSON 字段（`models.py`、`db.py` 补列、`schemas.py` 的 `NodeOut`/`NodeRestoreItem`）；`NodeCreate` 与 `NodeQuestion` 增加 `attachment_ids`，创建/写入问题时把附件元数据落库；撤销恢复时一并还原
  - [x] SubTask 8.4: 回答前按「根 → 当前节点」路径注入附件：文本附件读取正文（单文件 20000 字符、合计 60000 字符上限）拼入 user 文本；图片转 base64 `image_url` 块（`detail: low`）；读取失败/不支持类型跳过并记日志
  - [x] SubTask 8.5: 后端测试：上传与回读、节点附件落库与 DTO、文本附件进入 messages、图片产生 image_url 块、兄弟分支附件互不串入
  - 验证：`pytest` 全绿；把 `Reference_Doc/Deepseek开发文档` 下的 `.md`/`.txt` 上传后，回答请求上下文中包含正文

- [x] Task 9: 前端附件上传、卡片展示与输入框放大
  - [x] SubTask 9.1: `api/types.ts` 增加 `AttachmentDTO`，`NodeDTO` 增加 `attachments`；`client.ts` 增加 multipart `uploadAttachment`；`mock.ts` 同步默认字段与本地 mock 上传
  - [x] SubTask 9.2: 新增 `canvas/AttachmentComposer.tsx`：附件条（图片缩略图、文件名、移除按钮）、回形针按钮、拖拽文件到输入区并高亮、数量/大小超限提示
  - [x] SubTask 9.3: 元问题卡片输入区（`CardNode.tsx` 的 input 分支）接入 AttachmentComposer（左下角）；`GhostInputNode.tsx` 聚焦时扩展为约 460×120 多行面板，底部左侧附件按钮、右侧圆形发送按钮，失焦且为空时恢复单行
  - [x] SubTask 9.4: `graphStore` 的 `startQuestion` / `createBranch` 接收 `attachmentIds` 并提交给后端；提交后清空本次附件；fork 分支输入条（`BranchInputNode.tsx`）不提供上传入口
  - [x] SubTask 9.5: 新增 `canvas/AttachmentBar.tsx`：卡片左上角顶端显示附件；超过 3 个折叠为「附件 N ›」，悬停临时展开、点击固定展开
  - [x] SubTask 9.6: 新增 `canvas/ImageViewer.tsx`：点击图片附件打开全屏查看器，滚轮缩放（以指针为中心）、左键拖动或按住空格/中键拖动平移、Esc 关闭、关闭按钮
  - 验证：输入区可点击/拖拽上传；卡片左上角展示正确；>3 折叠交互符合预期；图片查看器缩放/平移/Esc 正常

- [x] Task 10: 版本文档与整体验证
  - [x] SubTask 10.1: `frontend/package.json` 版本 0.1.5；`readme.md` / `readme_en.md` 增加 0.1.5 更新日志（含联网搜索与附件）
  - [x] SubTask 10.2: 运行 `pytest` 与 `npm run build`，修复所有报错
  - [x] SubTask 10.3: 用 `Reference_Doc` 中的 `.txt`/`.md` 作为附件做一次真实回答验证，确认模型读到附件且分支上下文隔离
  - 验证：测试全部通过、构建成功、README 中英一致、附件实测可用

# Task Dependencies

- Task 4 依赖 Task 3（事件与字段契约）
- Task 5 与 Task 3/4 无依赖，可并行
- Task 6 与 Task 1 无依赖，可并行
- Task 8 与 Task 1–6 无依赖，可并行
- Task 9 依赖 Task 8（上传接口与附件字段）
- Task 10 依赖 Task 1–6、8、9 全部完成
