# doc/plan/future-plans —— 未来规划（暂缓项的设计要点）

> 来源：PLAN.md 第十一章（2026-08-26 PLAN 拆解时移入 doc/plan/）。**⏳ 全部暂缓**，等主线跑稳再回来；每项开工前先回看本页设计。

## 思考过程渲染

模型处于"思考模式"时会在 `reasoning_content` 字段返回推理链（V4 系列支持）。届时四步落地：① `types.ts` 加 `reasoning` 内容块；② 适配器捕获 `reasoning_content`（流式 `delta.reasoning_content` + 非流式 `message.reasoning_content`）；③ 回传 assistant 消息时把 `reasoning_content` 原样带回去，否则工具调用会报错；④ UI 渲染成默认折叠的「思考过程」块。

## 模型版本

model id 会持续演进（当前 V4 flash / pro）。`DEFAULT_MODEL` 只是兜底，正式使用一律在 `.env.local` 用 `DEEPSEEK_MODEL` 显式指定。

## 工作区选择（完整版，多工作区）

让 agent 能在多个工作区之间选择，而不是硬编码 `workspace/`。暂缓原因：它是跨切面功能（数据模型 + API + 前端 + 安全），且会动摇「单一 workspace 围栏」这个安全教学基础，等 Phase 4（终端）跑稳后再评估。设计要点（想清楚再动手）：
- **核心原则：工作区选择器是「换围栏」，不是「拆围栏」**——每个工作区仍然是路径沙箱（`resolveInsideWorkspace` 的参数从固定 workspaceRoot 变成当前工作区路径），白名单外的路径一律拒绝，否则"选择任意路径"等于绕过沙箱。
- **工作区定义走白名单**：如 `.env.local` 的 `WORKSPACES=path1;path2`（和 `ALLOW_FILE_DELETE` 同一种「策略配置」思路）；备选：扫描 `./workspaces/*` 子目录。推荐白名单——最安全、最教学。
- **会话 ↔ 工作区绑定**：现状会话头 `cwd` 只存字符串，切换工作区后旧会话失真。推荐 `.sessions/<workspaceId>/<sessionId>.jsonl` 按工作区分目录——切换工作区 = 会话列表跟着换，互不污染。
- **基础设施变化**：`workspaceRoot` 从模块级常量变成每个请求解析当前工作区；`toolRegistry` 现在是模块级单例（绑定 workspaceRoot），需要按工作区建 registry 或改成接收 root 参数；系统提示词里"你运行在安全工作区（workspace/）"要改成当前工作区名。
- **前端**：工作区切换器（侧栏上方），切换 = 会话列表刷新 + 转录稿清空（复用 `useSessions` 的"换 id 即换数据"模式）。
- **轻量版备选**：只想换一个目录时，只做 `WORKSPACE_ROOT` 环境变量（一处改动，沙箱跟随），不用等完整版。

## UI 视觉打磨（暂缓）

核心功能跑稳后再回头调视觉。已记录的问题：Phase 3 人工确认弹框的样式（用户反馈不喜欢当前形态）、会话侧栏等。原则不变：交互正确优先于美观，视觉升级参考「界面设计语言」（`doc/plan/ui-design.md`）的走纸记录仪语言。

## fetch 调用封装（暂缓）

前端 8 处手写 fetch（`use-sessions.ts` 4 处 + `use-agent-run.ts` 4 处），存在链式 `.then`、重复 headers/错误处理、`.catch(() => {})` 静默吞错等痛点。封装方向：`app/lib/http.ts` 提供 `api<T>(url, { method, body, signal })`——自动 `Content-Type: application/json`、`!ok` 时抛带服务端 error 消息的 `ApiError`、调用方用 async/await。覆盖 7 处普通 JSON 请求（会话列表/历史/新建/重命名/删除/清空/approve）；**SSE 流式 `POST /api/chat` 除外**（它要 `res.body` 交给 `readStream`，保持原样）。顺带可消除 `cancelled` 手写竞态标志（换 AbortController）。

- **实现前补记（已确认，2026-08-20，两轮调整后定案）**：**两个正交的抽象，两层目录**（用户第二轮意见：plugins 只放通用能力，接口定义进专门的 api 文件夹）：
  - `plugins/` = **通用能力插件**（与业务无关、可复用）：`plugins/http/` 放 `api<T>()` + `ApiError`（全项目唯一 fetch 样板；方法类型限定实际用到的 GET/POST/PATCH/DELETE，**不做 PUT**；`body` 有值才加 Content-Type + stringify；`signal` 透传 AbortController）。以后其他插件（终端、工作区…）并列放在 `plugins/` 下。
  - `api/` = **业务接口清单**（本项目专属，与服务端 route 一一对应）：按 REST 资源分模块 `sessions/`、`chat/`，每个模块 `index.ts` 定义语义化接口函数（method 在此消化，调用方见不到）、`types.ts` 放参数/返回类型。`api/` 依赖 `plugins/http`，hooks 只依赖 `api/`——依赖单向。**命名沿革（2026-08-20 定案）**：最初放根目录 `api/`，会与 Next.js 强约定的 `app/api/`（服务端路由位置，route.ts 只能放那里）撞名混淆；用户定案改名 **`app/services/`**（与 `app/lib/`、`app/components/` 平级）。`app/` 下只有 page.tsx/route.ts 等特定文件名参与路由，普通 .ts 文件不产生路由，放 `app/` 下安全。
  - **`sendMessage`（SSE）不收进 `api<T>`**（它要原始 `res.body` 交 `readStream`），但定义仍收口在 `app/services/chat/index.ts`，注释写明原因。
  - 类型搬家：`SessionSummary` 从 `use-sessions.ts` re-export（`session-list.tsx` 的 import 不变）；**`ToolApprovalRequest` 不搬家**——它是弹框 UI 状态类型（含 toolName/args 用于展示），不是接口参数类型（接口只要 `{toolCallId, allow}`），借此区分「接口类型 vs UI 状态类型」。
  - 顺手修两处：① `approve` 的 fetch 移出 setState updater（React 反模式，updater 理论上可能被调用两次）；② 两处手写 `cancelled` 竞态标志换 AbortController（挂载/切会话 effect 里 `controller.abort()` 即取消请求，catch 里按 `AbortError` 名显式忽略）。
