# 开发约定

## 术语表

| 术语 | 含义 |
| --- | --- |
| 母卡片 | 被追问、被连线的来源卡片：逻辑上位于主链/分支上游，笔记连接线中与笔记相连的问答卡片 |
| 子卡片 | 由母卡片追问或候选方向创建出的下游卡片，`data.node.parentId` 指向母卡片 |
| 逻辑连线 | 回答卡片之间的父子关系线，分为主链（第一子卡片，父右→子左）与分支（其余子卡片，上下边出线或共用母线） |
| 笔记连接线 | 问答卡片与笔记卡片之间的弱关联线，无方向、可悬停删除，外观由「设置 → 外观 → 笔记连线」控制 |
| 连接点 | 卡片上用于拖拽建立笔记连接线的小圆点：问答卡片右下工具栏一行、笔记卡片标题行最左侧 |
| 状态更新 | 卡片内容或生成状态发生变化（尤其是 `streaming` / `done` 切换）；发生状态更新的卡片自动置顶 |
| 获焦置顶 | 元素被点击、拖动或输入框获得焦点时，提到同类元素最上层 |
| 动态层级 | 由 `lib/uiLayers.ts` 统一分配的运行时 `zIndex`：同类按「最新显示 / 状态更新 / 获焦」排序，跨类使用固定区段 |
| 吸附 | 拖拽笔记连接线时，指针落入可连接卡片矩形内或靠近连接点 24px 内，预览线自动落到该连接点并高亮 |
| 释放动作 | 松开指针时按当前吸附目标建立连接；未命中笔记时按设置决定是否新建空白笔记并连接 |
| 毛玻璃 / 透明底组件 | 背景半透明并叠加背景模糊的浮层或输入容器，统一使用 `.glass-surface`；参考资料抽屉使用更通透的 `.glass-surface-airy` |
| 底层连线 | 所有连线（逻辑连线与笔记连接线）固定渲染在卡片之下，不随选中态抬升到卡片上方 |

## 单键多动作的 LIFO 优先级

当一个按键同时满足多个可执行动作时，始终**优先执行「最后执行 / 最后打开」的那个**；再次按下该键时依次回退到更早的动作。

示例：卡片 A、B 的「参考资料」抽屉同时打开，先打开 A、后打开 B：

1. 第一次 `Esc` → 关闭 B；
2. 第二次 `Esc` → 关闭 A。

### 实现方式

统一使用 `frontend/src/lib/escapeStack.ts`：

- `pushEscapeHandler(handler)`：打开浮层时入栈，返回的函数用于关闭或卸载时出栈；
- `useEscapeHandler(active, handler)`：React 组件的声明式写法，`active` 为 true 时入栈；
- 栈在 `keydown` 的**捕获阶段**监听，只调用栈顶处理器并 `preventDefault()` / `stopPropagation()`；
- 新增任何可用 `Esc` 关闭的浮层（抽屉、查看器、弹窗等）都必须接入此栈，**禁止**再单独注册 `window` 级 Esc 监听，否则会出现「一次 Esc 关闭多个层」的问题；
- 其它按键未来若出现「一个按键多个动作」，也应遵循同样的 LIFO 规则（可用同样的栈式设计扩展）。

### 当前已接入

- 卡片「参考资料」上拉抽屉（`canvas/CardNode.tsx`）
- 设置弹窗（`components/SettingsDialog.tsx`）

## 动态 UI 显示层级分配

画布内出现重叠时，按以下顺序决定谁在上面：

1. **最新显示**的优先；
2. **有状态更新**的优先（流式回答的 `streaming` / `done` 变化也算状态更新）；
3. **获得焦点**的优先（点击、拖动、聚焦输入框）。

**「有状态更新的卡片/元素在上」**：新显示、有状态更新、获焦三者同等优先，都会把元素提到同类元素的最上层；同一元素同时满足多个条件时只提升一次，不重复累加。

这套比较**主要对同类元素成立**：如卡片 A、B 之间按上述顺序排序，两个分支输入框之间也同样排序。不同类型之间使用固定区段；唯一例外是获焦 / 流式卡片会进入专属高区段（`activeCard`），从而压过笔记卡片，详见下方固定区段。

### 固定区段

| 区段 | 基线 | 说明 |
| --- | --- | --- |
| 聊天卡片 | `10` | 未获焦、未流式的聊天卡片；含卡片内部抽屉（随卡片整体抬升） |
| 猜你想问 / 自定义方向 | `900` | 建议箭头与自定义方向输入（收起/展开），高于普通卡片、低于笔记卡片 |
| 笔记卡片 | `1000` | 未获焦的笔记卡片，高于猜你想问 |
| 获焦 / 流式卡片 | `1200` | 点击选中的卡片（聊天或笔记）与正在流式输出的聊天卡片，视为状态更新，压在笔记卡片之上；多选时按置顶序号排列，最后点击的在上 |
| 分支输入条 | `1400` | 必须高于卡片、笔记与猜你想问 |
| 聚焦输入 | `1600` | 自定义方向输入或分支输入获得焦点时使用，层级最高 |

**笔记卡片高于猜你想问**：建议箭头（GhostNode）与自定义方向输入（GhostInputNode）在 `900` 区段，笔记卡片在 `1000` 区段，笔记不会被猜你想问遮挡。

**获焦卡片高于笔记**：用户点击、拖动或聚焦某张卡片时，该卡片视为发生状态更新，进入 `1200` 区段，可以压在笔记卡片之上；点击画布空白取消选中后回到原区段。多选时最后点击的卡片序号最大，显示在最上层。

**输入框聚焦时置于所有卡片之上**：聚焦输入使用独立的 `1600` 区段，高于笔记卡片与获焦卡片；焦点移出容器后立即回到原区段。

**连线始终在卡片之下**：逻辑连线与笔记连接线都固定渲染在卡片下方（React Flow 关闭 `elevateEdgesOnSelect`，边自身 `zIndex` 保持 0），不得因选中、悬停或被卡片转发层级而显示在卡片上方。

### 实现方式

统一使用 `frontend/src/lib/uiLayers.ts`：

- `bumpUiLayer(key)`：把元素提到同类元素最上层；新挂载、状态变化、获焦时调用；
- `dropUiLayer(key)`：元素卸载时清理记录；
- `resolveLayerZ(kind, keys)`：按当前顺序给同类元素分配连续 `zIndex`；
- `setFocusedInput(key | null)` / `getFocusedInput()`：维护唯一的聚焦输入 key 并通知订阅者；Canvas 据此把该输入节点分配到 `focusedInput` 区段；
- `UI_LAYER_BASE` 固定区段：聊天卡片 `10` 起、猜你想问 `900` 起、笔记卡片 `1000` 起、获焦 / 流式卡片 `1200` 起、分支输入条 `1400` 起、聚焦输入 `1600` 起。卡片内部的浮层（如提问抽屉）随卡片整体层级抬升。

获焦 / 流式卡片不经过 `bumpUiLayer` 的跨类比较，而是由 `Canvas.tsx` 按 `selectedNodeIds` 与 `status === 'streaming'` 分组：活跃卡片分配到 `activeCard` 区段，未活跃的聊天卡片分配到 `card` 区段、笔记分配到 `note` 区段。这样既保留「同类按置顶序号排序」，又让焦点卡片压过笔记。

新增可重叠的 UI（节点、浮层、抽屉）时，必须接入这套分配器，**禁止**再写死 `zIndex: 10` 之类的常量，否则会出现「新内容被旧内容遮挡」的问题。

### 当前已接入

- 卡片（`canvas/Canvas.tsx`）：新出现、状态变化、点击、拖动开始时置顶；点击选中或流式输出时进入 `activeCard` 区段（1200 起），高于笔记卡片
- 笔记卡片（`canvas/Canvas.tsx`）：未获焦时使用笔记区段（1000 起），高于猜你想问；点击获焦后同样进入 `activeCard` 区段
- 猜你想问与自定义方向输入（`canvas/GhostNode.tsx`、`canvas/GhostInputNode.tsx`）：新显示、展开获焦时置顶，固定使用猜你想问区段（900 起），低于笔记卡片
- 新建分支输入条（`canvas/BranchInputNode.tsx`）：新显示、聚焦时置顶
- 聚焦输入（`canvas/GhostInputNode.tsx`、`canvas/BranchInputNode.tsx`）：聚焦时调用 `setFocusedInput`，Canvas 分配到 1600 区段；失焦或卸载时清理

## 毛玻璃与透明底组件

**适用范围**：画布上除卡片本身以外的弹出内容统一切换为毛玻璃材质：透出一点背景、背景被模糊、浮层自身内容清晰。卡片本身与其内部按钮（IconButton、重新提问 / 新建分支、发送按钮等）**不使用**毛玻璃，卡片背景保持不变；设置弹窗等不透明模态也不适用。

### 材质类与参数

材质定义在 `frontend/src/styles/theme.css`，提供两档：

| 类名 | 用途 |
| --- | --- |
| `.glass-surface` | 默认浮层材质：工具栏按钮、画布 Panel / 提示、Toast、猜你想问（建议箭头 + 自定义方向输入）、分支输入条、附件展开层、卡片元问题 composer |
| `.glass-surface-airy` | 更通透的一档：参考资料抽屉（sources drawer）与「我的提问」抽屉，白底 / 浅色主题下也不显得“实” |

参数集中在 `:root` 顶部，便于统一调整（浅色主题 `[data-theme="light"]` 下另有覆盖值）：

| 变量 | 含义 | 默认值 |
| --- | --- | --- |
| `--glass-alpha` | 背景不透明度，越低越透 | `72%` |
| `--glass-blur` | 背景模糊半径 | `12px` |
| `--glass-saturate` | 背景饱和度增强 | `140%` |
| `--glass-alpha-airy` | 通透档背景不透明度 | `58%` |
| `--glass-blur-airy` | 通透档背景模糊半径 | `18px` |

实现方式（两档一致，airy 取对应变量）：

```css
background: color-mix(in srgb, var(--bg-panel) var(--glass-alpha), transparent);
-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
```

浅色主题（`[data-theme="light"]`）下 `--glass-alpha` 降为 `62%`、`--glass-blur` 提到 `16px`，airy 档降为 `44%` / `22px`，保证白色背景上通透但文字仍可读。文字颜色继续使用 `text-ink` / `text-body` / `text-muted`，不额外改动。

### 约定与降级

- **禁止再写半透明纯色背景**（`bg-panel`、`bg-ghost-bg`、内联 `color-mix(...)` 等），需要统一材质时直接加 `.glass-surface` 或 `.glass-surface-airy`，避免背景叠加变浑；
- 需要保留各自的边框、圆角与阴影，只替换背景材质，**不得改变布局与尺寸**；
- 选中态仍用 `bg-accent-dim` 覆盖背景（Tailwind 工具类优先级高于 components 层），不影响毛玻璃类本身；
- **拖动降级**：卡片拖动期间 Canvas 外层带 `is-node-dragging` class，样式层把两种毛玻璃临时降级为 `background: var(--bg-panel)` 且关闭 `backdrop-filter`，松手后自动恢复，并用 120ms 过渡避免闪烁；
- 参考资料抽屉自身高度拖拽、空格平移期间同样退化为不透明 `bg-panel`（组件内条件切换）；
- 暂停态遮罩保留原有的 `bg-panel/55 + backdrop-blur-sm`；设置弹窗保持不透明背景。

## 笔记连接线交互

- **连接点位置**：问答卡片在底部工具栏一行、靠近右边框（`ANSWER_LINK_DOT`：`right: 6`、`bottom: 26`）；笔记卡片在标题行最左侧、靠近左边框（`NOTE_LINK_DOT`：`left: 6`、`top: 20`）。
- **连接点尺寸**：圆点直径随卡片正文字号缩放（`calc(9px * var(--card-font-scale))`）；`answerLinkAnchor` / `noteLinkAnchor` 必须传入同一比例，否则连线端点与视觉圆心会错位。
- **无方向**：可从任一端拖拽发起，连接只表示关联，不表示父子关系；同一对卡片重复连接时提示「连接已存在」。
- **同类不连**：问答卡片只能连笔记卡片，笔记卡片只能连问答卡片；拖拽期间只高亮对侧类型的连接点。
- **吸附**：指针落在可连接卡片的**整张矩形范围内**即吸附到该卡片连接点；同时保留连接点 24px 屏幕距离内的吸附。优先选择指针所在卡片，多张卡片重叠时选择连接点距离最近者。
- **释放动作**：在目标卡片矩形内松开即建立连接；从问答卡片出发且未命中笔记卡片时，按 `preferences.noteLinkReleaseAction`（或按住 Shift）决定是否新建空白笔记并连接；从笔记卡片出发未命中问答卡片则取消。
- **悬停 Delete**：悬停连线变强调色；按 `Delete` 删除当前悬停的连线。边的 `id` 直接使用后端连接 `id`（`data.linkId` 同步回传），删除时按真实 id 请求，采用乐观更新，删除后清空 hover 记录。
- **视觉状态**：空闲态为透明底 + 强调色边框；拖拽期间起点与可连接连接点为实心强调色并带光环/放大；被吸附者光环更明显，动画短促可中断。
- **颜色与线型**：连线颜色取 `preferences.noteLinkColor`、粗细取 `noteLinkWidth`、线型取 `noteLinkStyle`，设置修改后立即生效；hover 仍使用强调色。
- **底层渲染**：笔记连接线与逻辑连线一样始终位于卡片之下，不参与卡片动态层级。

## 卡片字号缩放约定

- **两个变量**：`--card-font-size` 控制卡片正文；`--card-font-scale = cardFontSize / 14` 控制所有固定像素元素（`applyTheme` 写入）。
- **不只是文字**：卡片内的图标、图标按钮、附件标签、辅助小字、思考过程、停止 / 重试 / 暂停按钮、提交按钮、笔记卡片标题按钮都必须用该比例缩放，禁止只放大正文。
- **工具类**：文本用 `.card-scale-11` / `.card-scale-12` / `.card-scale-13`；图标用 `.card-scale-icon`（14px 基准）/ `.card-scale-icon-sm`（12px 基准）；IconButton 自带 `.card-icon-button`，其 SVG 自动缩放。其它尺寸写 `calc(Npx * var(--card-font-scale))`。
- **输入区**：元问题卡片、提问抽屉、自定义方向、分支输入条的 textarea 字号统一取 `var(--card-font-size)`；输入框内的工具栏按钮与附件标签同步缩放。
- **提问抽屉高度**：只读与编辑态都不固定高度、不出现滚动条；抽屉以 `bottom-full` 为锚点，内容越多越向上扩展，底边保持不动。
- **提示位置**：PDF 页数、模型能力等红色提示统一放在提交按钮左侧，不放在左侧操作组。
- **连接点**：笔记连接点直径随字号缩放，连线端点函数必须传入相同比例。

## 模态标记

图片查看器已移除；设置弹窗的根节点带有 `data-modal-open="true"`。全局 `Delete` 删除快捷键据此判断当前是否有模态浮层，避免在设置打开时误删画布卡片。

## 键盘快捷键一览

| 按键 | 行为 |
| --- | --- |
| `Space` + 左键拖动 | 平移画布（任意位置，包括卡片文字和未聚焦输入框） |
| 鼠标中键拖动 | 平移画布 |
| 滚轮 | 指针位于卡片正文、思考过程、笔记正文等 `.nowheel` 区域时滚动该区域内容，其余区域缩放画布；按住 Space 时滚轮一律缩放画布。仅当「设置 → 画布 → 指针 → 触摸板逻辑」选择「触摸板（实验性）」时启用触控板手势：双指滑动平移画布、双指捏合缩放画布（指针位于可滚动区域时保留原生滚动，捏合始终缩放）；按住 Space 时双指滑动一律平移画布，捏合与鼠标滚轮仍缩放。一次连续手势内判定固定，指针经过卡片或猜你想问不会切换行为；平移与缩放按帧插值，中途变向立即跟随；松手后是否滑行遵循「设置 → 显示 → 画布拖动惯性」；横向滑动不会触发浏览器前进 / 后退手势。默认「鼠标」模式保持标准滚轮行为 |
| `Esc` | 按 LIFO 顺序关闭最后打开的浮层 / 抽屉 |
| `Tab`（仅笔记正文编辑中） | 插入 4 个空格 |
| `Delete` | 删除当前选中的卡片（元问题卡片除外） |
| `Ctrl/Cmd + Z` | 撤销当前画布的上一步操作（含卡片尺寸修改） |
| `Ctrl/Cmd + S` | 保存当前画布 |

## 火山方舟适配

- **provider 字段**：`deepseek` / `ark` / `openai`，默认 `deepseek`（`backend/app/services/settings.py` 的 `PROVIDERS`，前端类型 `ModelProvider`）。设置页下拉顺序固定为 DeepSeek → 火山方舟 → OpenAI 兼容，「OpenAI 兼容」固定最底。
- **配置字段**：页面设置为 `arkApiKey` / `arkBaseUrl` / `arkModel`，数据库列为 `ark_api_key` / `ark_base_url` / `ark_model`；Key 加密存储，读取接口只返回 `arkApiKeyMasked`。`ARK_API_KEY` / `ARK_BASE_URL` / `ARK_MODEL` 仅在 local 模式作为兜底；服务器模式不读取这些环境变量，Key 只来自当前用户设置，地址与模型使用硬编码默认值（`https://ark.cn-beijing.volces.com/api/v3`、`doubao-seed-2-1-pro-260915`）。
- **协议选择**：
  - 基础对话使用 Chat Completions（OpenAI SDK，`{base_url}/chat/completions`）；`thinking` 是顶层扩展字段，通过 `extra_body` 发送 `{"thinking": {"type": "enabled" | "disabled"}}`（默认开启）；不发送 DeepSeek 专有的 `reasoning_effort`、`title` 与 `tools`。
  - 开启联网搜索时使用 Responses API（`POST {base_url}/responses`，`stream: true`），声明 `tools: [{"type": "web_search", "sources": ["doubao"]}]`，系统消息合并为 `instructions`，PDF 附件转为 `input_file`。解析事件：`response.output_text.delta`、`response.reasoning_text.delta` / `response.reasoning_summary_text.delta`、`response.output_text.annotation.added`、`response.web_search_call.completed`、`response.completed`、`response.failed`。
- **强制搜索回落**：强制搜索仅有 DeepSeek 的预检索实现；`provider=ark` 时即使配置为 `forced` 也按智能搜索处理（不预检索、不声明 DeepSeek 工具、悬停面板不显示强制搜索开关），前端保存设置时把 `webSearchMode` 归为 `smart`。
- **会话标题**：仅 DeepSeek 在根卡片首次回答时通过 `enable_title` 请求标题；火山方舟不发送该参数、不生成画布标题。
- **来源展示**：火山方舟只产出 `sources` 列表，不在正文插入 `[n]` 角标（详见「搜索结果与引用角标展示约定」）。

## 文件输入

- **kind 分类**：`backend/app/services/attachments.py::_kind_of` 按 MIME 与扩展名判定 `image` / `text` / `pdf` / `video` / `audio` / `other`；图片使用 MIME 白名单，视频 / 音频 / 文本使用扩展名白名单。
- **provider 匹配注入**：附件元数据 `provider` 记录解析方（`ark` / `deepseek`，未解析为 `null`）；`build_message_parts(node, provider)` 遇到 `meta.provider` 与当前服务商不一致时跳过该附件（附件本身仍保留），避免把无效 `fileId` 传给模型。文本附件不区分服务商，始终按文本注入（单文件 20000 字符、合计 60000 字符上限）。
- **ark 注入**：图片 / 视频 / 音频 / PDF 上传到 Files API（`POST {base_url}/files`，Bearer Key，`purpose=user_data`），轮询 `GET {base_url}/files/{id}` 直到 `status=active` 才保存 `fileId`（最长约 60 秒，失败只记日志并保留附件）。注入内容块为 `image_url` / `video_url` / `input_audio` / `file`，均只带 `file_id`；联网的 Responses 路径只有 PDF 转 `input_file`，其它附件类型跳过。
- **DeepSeek 与 OpenAI 兼容**：DeepSeek 继续用 Files API（`purpose=text_recognition`）解析 PDF / Office；OpenAI 兼容保持图片 / 文本注入。
- **附件回读**：`GET /api/attachments/{id}` 对 `pdf` / `image` / `text` / `video` / `audio` 返回 `Content-Disposition: inline`（中文文件名用 RFC 5987 `filename*` 编码），其它类型按 `attachment` 下载；前端 `window.open` 后由浏览器直接预览，避免被下载器按附件捕获。
- **PDF 页数提示**：上传接口的 `AttachmentDTO` 返回 `pageCount`（非 PDF 为 `null`）；前端 `PdfPageWarning`（`canvas/AttachmentComposer.tsx`）在任一 PDF `> 30` 页或合计 `> 30` 页时提示；总页数或单个 PDF `> 100` 页时提示「pdf页数过多，可能超出模型上下文」。提示统一放在提交按钮左侧（`PdfPageWarning` 与 `ArkCapabilityWarning` 同组），四个输入位置（元问题卡片、提问抽屉、自定义方向、分支输入条）保持一致。
- **Files API 过期**：方舟文件默认保存 7 天（1–30 天可在方舟控制台配置）；`fileId` 与 API Key / 账号绑定，更换 Key 或账号后旧 `fileId` 可能失效，需要重新上传附件。

## 搜索结果与引用角标展示约定

- **统一的 `sources` 结构**：所有服务商都向前端提供 `sources` 数组，前端序号按 `sources` 下标 + 1（从 1 开始），只识别 `[n]` / `【n】`，不解析服务商私有引用字段。
- **正文角标按服务商区分**：DeepSeek（智能搜索与强制搜索）按引用位置在正文插入可点击的 `[n]` 角标；火山方舟只产出 `sources` 列表、**不插 `[n]` 角标**，前端照常展示「参考 N 篇资料」抽屉。
- **智能搜索遇到用户链接**：最后一条用户消息含 URL 时，后端只声明 `deepseek_read_url`，**不声明** `deepseek_web_search`（二者同时声明且开启思考时，本轮会走深度思考搜索而不阅读用户链接）；并在最后一条消息之前注入链接编号映射 system 消息，原用户消息保持不变。无 URL 时仍声明 `deepseek_web_search`；强制搜索模式不受影响，不声明 `deepseek_read_url`。
- **输入链接编号规则**：按用户文本中的出现顺序提取，重复 URL 只算第一次，最多前 10 个（与服务商限制一致）；前端胶囊编号必须与此顺序一致。正文引用不使用该编号。
- **链接胶囊从输入框抽离**：四个问题输入位置（元问题、自定义方向、分支输入、提问抽屉）在粘贴与失焦时调用 `lib/urlChips.ts` 的 `splitUrls()`，把链接从文本移出并存入独立状态（本地 `useUrlChips` 或 store 的 `branchUrlChips` / `ghostUrlChips`），输入框只保留正文；提交前用 `composeWithUrls()` 按胶囊顺序把链接各占一行追加到问题末尾，保证后端仍只识别最后一条用户消息中的链接，且编号顺序与胶囊一致。`usePasteAttachments` 返回布尔值：文件或超长文本已按附件处理时跳过链接识别。
- **链接胶囊交互**：单击胶囊延迟 220ms 打开链接（裸域名补 `https://`，新标签并带 `noopener`），双击在延时内取消打开并进入内联编辑（Enter 保存、Esc 取消、失焦保存）；编辑值经 `replaceUrl()` 按链接规则归一化并保持原编号顺序、自动去重，非法值则保持原链接。
- **两套编号不得混用**：输入链接编号（「链接1 / 链接2…」）与来源角标 `[n]`（对应 `sources` 下标 + 1）是两套独立编号；提示词须明确告知模型二者不可互换。
- **DeepSeek 智能搜索必须在落库前转换**：DeepSeek 智能搜索（模型自主联网）的 `message.annotations` 中，`type=url_citation` 的条目按 `content` 的 Unicode 码点计数，须在落库前用 `apply_citations` 按 `end_index` 插入 `[n]`；URL 不在 `sources` 中时补一条来源，保证序号连续。未转换会导致重新打开画布后角标丢失。
- **done 事件携带最终正文**：DeepSeek 带引用的回答在 `done` 事件中额外返回 `answer`（最终正文），前端用其覆盖流式累积文本，保证流式结束后立即显示角标；无 `annotations` 或失败时保持原有 `{"status": "done"}` 结构；火山方舟只推送 `sources`，`done` 仍为 `{"status": "done"}`。
- **来源页也要进入 sources**：服务端工具调用里的 `sources` 与 `page`（`{url,title,published_at}`）都归一化为来源，去重后按首次出现顺序编号，保证打开 / 阅读网页产生的引用也能找到对应条目。
- **新增服务商同样适用**：未来接入新服务商时必须产出 `sources`；能给出精确引用位置的（如 DeepSeek）按 `end_index` 在落库前转换正文 `[n]`，无法给出位置的（如火山方舟）只产出 `sources`、不得伪造角标。若新服务商支持读取用户链接，也必须遵循上述约定：按出现顺序去重取前 10 个编号、注入链接映射、与角标编号严格区分。
- **不改变前端渲染协议**：后端只负责数据标准化，前端仍按既有规则渲染 `sources` 与 `[n]` 角标，不新增事件类型或字段含义。

## 模型选择输入框约定

- **统一形态**：所有服务商的模型名输入都使用「文本输入框 + 自定义候选浮层」（`SettingsDialog.tsx` 的 `ModelPicker`）；不使用原生 `<select>`，也不使用 `datalist`（高度不可控，一次可见候选项过少）。DeepSeek 与火山方舟已使用该组件；OpenAI 兼容不预置候选，使用纯文本输入（模型名由服务商决定）。
- **聚焦清空**：输入框获得焦点时清空显示值，浮层直接列出全部候选；不能因为已有值而只过滤出少数候选。点击已聚焦的输入框且浮层已关闭时，重新展开候选。
- **失焦恢复**：聚焦后没有输入、也没有选择就失焦时，恢复原来的模型；选择候选或手动输入有效模型后失焦则保留新值。手动填写的接入点 / 模型 id 允许保留。
- **显示名称**：候选项只显示易读名称（如 `Doubao-Seed-2.1-lite`），不显示冗长的完整 id；去掉末尾 6 位版本号，把 `2-1` 形式转成 `2.1`；仅当多个版本同名时才附加版本号。
- **只列 LLM**：候选只保留 `output_modalities` 包含 `text` 的模型，排除图片、视频、3D、向量化等生成模型；无法获取能力时使用内置 LLM 候选。
- **字母排序**：候选项按显示名称的字母顺序排序（`localeCompare`），不按接口返回顺序。
- **一次多显示**：浮层高度由 `visibleCount` 控制（默认 9 项，约 296px），内部独立滚动，减少滚轮操作；候选很多时不要把列表截断成固定几项。
- **不被裁剪**：浮层使用 `fixed` 定位，坐标按输入框的 `getBoundingClientRect()` 计算，避免被设置弹窗的滚动容器裁剪；下方空间不足 220px 时向上展开，高度按可用空间收缩。选项卡滚动或窗口缩放时收起浮层。
- **宽度**：设置行右侧控件列统一为 `380px`、最大 `46%`；不要为了展示更多候选去加宽输入框，展示数量由浮层高度解决。
- **新增服务商**：接入新服务商时，模型选择框必须复用上述交互（输入框 + 可滚动浮层、聚焦清空、失焦恢复、名称显示、字母排序、只列 LLM）。

## 下拉框统一约定

- **统一形态**：所有下拉框（服务商、释放连线动作等）都使用毛玻璃浮层，不再使用原生 `<select>`；列表容器样式与模型候选浮层一致（`glass-surface` + `rounded-lg` + `border-subtle` + `shadow-xl`）。
- **复用实现**：使用 `SettingsDialog.tsx` 的 `SelectRow`（只读下拉）与 `ModelPicker`（可输入模型选择），二者共用 `useFloatingMenu` 处理定位与收起，不要各自重写。
- **定位与收起**：浮层使用 `fixed` 定位并按触发元素 `getBoundingClientRect()` 计算坐标，避免被设置弹窗的滚动容器裁剪；下方空间不足时向上展开。页面滚动、窗口缩放、点击外部或失焦时收起，浮层内部滚动不触发收起。
- **显示项数可调**：`SelectRow` 与 `ModelPicker` 均提供 `visibleCount` 参数（默认 9 项），高度按 `visibleCount * 32 + 8` 估算并与可用空间取小；选项较多时由浮层内部滚动。
- **交互**：点击选项选中并关闭；当前值用强调色高亮；选项按钮 `onMouseDown` 阻止默认行为，避免浮层先因失焦关闭。
- **新增下拉框**：复用上述组件，不要新增原生 `<select>`。

## 服务器设置与数据边界

- **设置归属**：local 模式使用 `app_settings`（固定 `id=1`）；server 模式使用 `user_settings`（每个用户一行，`user_id` 为主键）。server 模式下 `settings._settings_row()` 在用户为空时返回 `None`，不得回落到 `app_settings`。
- **密钥隔离**：server 模式的三个 Key（`api_key` / `openai_api_key` / `ark_api_key`）只读取当前用户设置行；地址、模型与开关使用硬编码默认值，禁止回落到 `backend/.env`。`.env` 只在 local 模式作为兜底。
- **新用户初始化**：注册时先 `db.flush()` 取得用户主键，再写入空的 `UserSetting` 行，避免在未 flush 时使用 `user.id`（此时仍为 `None`）。
- **恢复默认**：`settings.reset()` 遍历设置列，跳过 `id` / `user_id` / `updated_at` 与三个 Key 字段，其余置 `None`；新增设置列会自动纳入重置，不需要改代码。
- **浏览器缓存**：前端不得把 Key 或敏感设置写入 `localStorage` / `sessionStorage`；目前仅「已看过开发中提示」标记使用 `localStorage`，Mock 模式在 `sessionStorage` 中只保存脱敏 Key。
- **数据外发**：仅在回答、联网搜索、文档解析时向当前服务商发送「根 → 当前节点」上下文与所选附件；不得发送其他账号数据、未选中服务商的 Key 与配置。新增任何外部请求都必须按此边界审查。

## 更新日志写作约定

- **分类前缀**：每条更新必须以分类前缀开头：`新增：` / `优化：` / `修复：` / `说明：` / `文档：` / `版本：`。
- **建议顺序**：同一版本内尽量按 新增 → 优化 → 修复 → 说明 → 文档 → 版本 排列；修复项用 `修复：`，优化项用 `优化：`，不要写「调整」「改进」这类无前缀描述。
- **分类含义**：`说明：` 用于使用限制、外部依赖与注意事项；`文档：` 只写文档变更；`版本：` 只写版本号升级。
- **未发布版本的修复整合**：同一版本仍在开发中时，针对该版本新增 / 改动功能的修复直接并入对应条目，不单独写 `修复：`；`修复：` 只用于修复此前已发布版本的已知问题。例如 0.3.10 开发过程中给 0.3.10 新功能补的 bug，应合并进 0.3.10 的对应条目，而不是新增一条「修复：」。
- **中英同步**：`readme.md` 与 `readme_en.md` 内容保持一致；英文对应前缀为 `Added:` / `Improved:` / `Fixed:` / `Notes:` / `Docs:` / `Version:`。
- **版本与 hotfix**：默认每次对话递增一个小版本；hotfix 只在用户明确指定时创建，并写在对应版本的末尾。
- **文档约定** : 每次修改功能后检查是否需要更新部署文档，判断是否需要将一些要求写入开发文档。


## 失焦判定规则

“失焦” 本质：**当前拥有焦点的对象，不再是它；焦点被转移、回收、销毁。浏览器 / GUI 内核维护一条全局的「当前焦点」，判定就是这条指针的变化。**

下面按前端（最常用），顺带提桌面端、移动端。

### 一、浏览器（DOM）标准判定规则

浏览器内部维护一个：
`document.activeElement` —— 当前拥有焦点的元素。

判定成立的几种场景（任意一条）：

1. 用户点击别的可聚焦元素；
2. Tab / Shift+Tab，键盘把焦点移走；
3. 代码执行 `other.focus()`，抢走焦点；
4. 当前元素被 `hidden`、`disabled`、从 DOM 移除，变成不可聚焦；
5. 焦点跑到 window 之外（切窗口、切 Tab）；
6. 弹窗、dialog、下拉拦截焦点，把焦点挪走。

对应的事件：

- **`blur`**：元素失去焦点；不冒泡；不可取消；`event.relatedTarget` = 拿到焦点的那个元素（有可能 null）W3C
- **`focusout`**：同样是失焦，但是会冒泡；适合在父容器统一监听一堆输入框；顺序：`blur` → `focusout`MDN Web Do...

> 
> 事件顺序（A → B）
> `blur(A)` → `focusout(A)` → `focus(B)` → `focusin(B)`