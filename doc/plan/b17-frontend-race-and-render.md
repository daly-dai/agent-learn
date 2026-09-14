# B17 前端切会话竞态 + 渲染优化（详案）

> **来源**：PLAN.md 7.3 B17（体检报告行动②⑥）。2026-09-01 C13 收尾后开写详案——useCommandMenu 已拆干净（page.tsx 550+→336 行），B17 决策区改动面变小，且 ④"输入框常驻"正落在 hook 持有的 input/console 上。
>
> **⚠️ 补记 1（2026-09-02）已改写 ① 的方向**：正文 ①② 仍是初稿（方案 X abort），补记 1 记录"四家会话模型对照 + 方案 Y（session-owner）决策"——**以补记 1 为准**：不写过渡 abort，① 收窄为止血最小步或并入新条目（session-owner 多会话并行）。读本详案先读补记 1。
>
> **范围**：纯前端（`app/`），不碰 `lib/agent/index.ts`（红线）。后端 SSE 协议不变（方案 Y 的前端 runStore 在 services 层之上，协议无需改）。

## 一、前因后果：这五个问题为什么值得修

### 1. 切会话竞态（行动②）——真实 bug，不是理论问题

**现状**：`use-agent-run.ts` 里，历史拉取（`fetchHistory`）有 `AbortController`（L103-133，切会话/卸载时 `controller.abort()`），但**发消息的 SSE 流（`send`）没有任何取消机制**（L268-299），`runCommand` 也没有。

**后果**：会话 A 正在流式输出 → 用户切到会话 B →
- A 的 `message_update` 帧继续被 `applyFrame` 消费 → **把 A 的文本追加进 B 的转录稿**
- A 的 `done` 帧把 A 的 stats/todos/contextPressure **写进 B 的读数盘**
- A 的 `tool_output` 帧污染 B 的 bash 实时输出

这就是"旧 run 帧污染新会话"。历史上只修了"历史拉取"这一半，SSE 流这半一直没补——因为切会话时前端通常先点了停止，但**停止是异步的**（POST /stop），窗口期帧照样进来。

**为什么 C6 工作区选择必须先有它**：切工作区 = 会话列表整体换 + 转录稿清空，是"切会话竞态"的放大版。没有 B17① 的地基，C6 一上线就踩同一个坑。

### 2. TaskPanel dismissed 跨会话串（行动②顺手项）

`page.tsx` L294 `<TaskPanel todos={todos} sessionId={currentId} />`。TaskPanel 内部 `useState(() => localStorage.getItem(dismissKey(sessionId)))`——**useState 只在挂载时初始化**。切会话时组件不卸载（同一个 TaskPanel 实例），dismissed 停留在旧会话的值，**新会话该显示的任务面板可能被旧会话的"已关闭"标记藏掉**（或反过来）。

### 3. 流式渲染全树重渲染（行动⑥）——每 delta 一次 O(n) 重渲染

**现状**（page.tsx L244-252 + L210）：

```tsx
messages.map((msg, i) => (
  <MessageRow key={...} message={msg} live={...} toolOutputs={toolOutputs} />
))
const rows = foldEvents(observed);  // 每次渲染全量重折叠
```

三个放大点：
- `MessageRow` **没有 memo**：每来一个 `message_update` delta，`setMessages` 产生新数组 → 所有行重渲染
- `Markdown` **没有 memo**：每行都重新跑 react-markdown 解析（highlight.js 高亮是重活）
- `foldEvents(observed)` **每次渲染全量重折叠**：observed 每帧 append，折叠随行数增长，长会话是 O(n²)

流式输出时这就是"每 token 全树重渲染 + 全量重折叠"。

### 4. 底部决策区三选一——输入框被卸载

**现状**（page.tsx L312-390）：

```tsx
{pendingApproval ? <ApprovalDialog/> : pendingAsk ? <AskUserCard/> : <form>…输入框…</form>}
```

审批/提问卡出现时**输入框整个卸载**，卡关闭后重建。后果：
- 输入框的**焦点、IME 状态、滚动位置**丢失（用户打到一半的草稿虽然存在 hook 的 input 里，但输入体验被打断）
- 命令面板（C13）挂在 consoleFrame 上，输入框卸载时它也一起没了

### 5. 渲染平铺原则（纪律，体检报告⑦衍生）

面板内状态用**提前 return 平铺**，不用嵌套三元（`renderDetailBody` 五层三元的示范已在 repos 讨论过）。repos/page.tsx 已有 `if (skip) return null` 的先例。这条是 code-review 层面的规范，随 ④ 落地一起执行。

## 二、解决方案（五点对应）

### ① SSE 流 AbortController + applyFrame 会话校验

**改 `app/services/chat/index.ts`**：`sendMessage` 加 `opts?: { signal?: AbortSignal }` 透传给 `fetch`（照抄 `fetchHistory` 模式，L82-88）。

**改 `use-agent-run.ts`**：
- 加一个 `runControllerRef = useRef<AbortController | null>(null)`：`send` 和 `runCommand` 启动时 `runControllerRef.current = new AbortController()`，传入 `sendMessage`/`executeCommand`，`finally` 里置 null
- **切会话/卸载时 abort**：现有历史拉取 effect（L103-133）的清理函数里补 `runControllerRef.current?.abort()`
- **applyFrame 兜底校验**：abort 是异步的（浏览器可能还有已排队的帧），`applyFrame` 开头比对发起 run 时的 sessionId 与当前 sessionId，不一致直接丢弃——双保险（abort 是主手段，校验是防窗口期）

> 为什么"停止按钮"不够：停止是 POST /stop 通知服务端，服务端再断流，有往返延迟；abort 是本地立即断流，两者叠加才稳。

### ② TaskPanel 加 key

`page.tsx` L294 改为：

```tsx
<TaskPanel key={currentId} todos={todos} sessionId={currentId} />
```

切会话 = key 变 = 组件强制重挂载 = useState 重新读 localStorage。一行修复。

### ③ memo 三层

- **`MessageRow` 包 `React.memo`**（message-row/index.tsx 导出处）。注意 `toolOutputs` 每次 setToolOutputs 都是新对象，memo 会失效——所以**只有包含 `toolCallId` 的那行该拿到最新输出**，其他行传 `undefined`（page.tsx 里 `toolOutputs={msg.role === "assistant" && msg.content.some(b => b.type === "toolCall") ? toolOutputs : undefined}`，或 memo 比较函数 `areEqual` 忽略无关字段）
- **`Markdown` 包 `React.memo`**（app/markdown.tsx）：children 不变不重跑解析
- **`foldEvents` 用 `useMemo`**（page.tsx L210）：`const rows = useMemo(() => foldEvents(observed), [observed])`——observed 每帧 append 时确实要重算，但**派生链路不再每次渲染都跑**（phase/turn 同理，可一并 useMemo）

### ④ 输入框常驻 + 覆盖层

`page.tsx` 决策区改法：

```tsx
{/* 输入框永远在 */}
<form className={styles.console}>…</form>
{/* 审批/提问是覆盖层，absolute 盖在输入框位置，不进 grid 流 */}
{pendingApproval && (
  <div className={styles.decisionOverlay}>
    <ApprovalDialog request={pendingApproval} onApprove={approve} />
  </div>
)}
{pendingAsk && (
  <div className={styles.decisionOverlay}>
    <AskUserCard ask={pendingAsk} onAnswer={answerAsk} />
  </div>
)}
```

业务上两 panel **天然互斥**（串行 run 同时只会等一个请求），无需优先级判断——`&&` 各自独立即可。CSS：`.decisionOverlay { position: absolute; bottom: 100% / inset; }` 盖住输入框，输入框 `disabled` 防误输入。

**C13 联动**：命令面板本来就挂在 consoleFrame（absolute），输入框常驻后行为不变；审批/提问期间 `disabled` 已由 loading 控制，命令面板不会误弹。

### ⑤ 平铺化（随 ④ 一起）

决策区从嵌套三元 → 独立 `&&` + 覆盖层，本身就是平铺。repos/page.tsx 的嵌套三元（L280-307 五层）顺手平铺成 if/return（B17 原计划的示范点）。

## 三、验收标准

| # | 验收 |
|---|---|
| ① | 会话 A 发长任务（慢模型）→ 立刻切会话 B → B 的转录稿/读数盘/todos **无 A 内容**；A 的 done 帧不触发 B 的列表刷新（无错误横幅） |
| ① | run 进行中点"停止"仍正常（回归：stop 按钮功能不变） |
| ② | 会话 A 关闭任务面板 → 切 B → B 的任务面板**正常显示**（不被 A 的 dismissed 藏掉）；再切回 A → 仍关闭 |
| ③ | 流式输出时 React DevTools Profiler：只有**更新中的那一行**重渲染（不是全树）；停止后不再有渲染 |
| ③ | 长会话（几十条消息）滚动时无卡顿（foldEvents 不再每帧全量重折叠） |
| ④ | 审批/提问卡出现时**输入框仍在 DOM**（内容/焦点可恢复）；卡关闭后输入框可立即输入；命令面板（/ 弹出）行为与现在等价 |
| ④ | 串行 run 中审批与提问不会同时出现（互斥保持） |
| ⑤ | grep 决策区无嵌套三元；repos/page.tsx 无五层三元（tsc + 人工 review） |

**回归**：`tsc --noEmit` + 全套 vitest（38 文件 332 用例）保持绿；浏览器人工走一遍正常对话 + 工具审批 + 模型提问三条路径。

## 四、施工顺序（每步可运行）

1. services/chat `sendMessage` 加 signal（纯透传，tsc 可过）
2. use-agent-run：runControllerRef + send/runCommand 接线 + 切会话 abort + applyFrame 校验
3. TaskPanel `key={currentId}`（一行）
4. MessageRow / Markdown memo + toolOutputs 按行下发 + foldEvents useMemo
5. page.tsx 决策区改覆盖层 + CSS
6. repos/page.tsx 嵌套三元平铺
7. 按验收表逐条过 + 回归

> **测试**：本项以手动验收 + tsc + 现有单测回归为主。hook 层单测等 B8（@testing-library/react 引入、组件 API 冻结信号）后再补——竞态逻辑（applyFrame 校验）届时可抽纯函数测。

---

## 补记 1：切会话竞态的架构级讨论 —— 方案 Y（session-owner）取代 abort 补丁（2026-09-01 讨论，2026-09-02 成文）

> **触发**：详案初稿把 ① 写成"abort + applyFrame 校验"（方案 X），用户追问两个问题，把讨论推向架构层：
> 1. "A 在输出我切到 B，A 应该继续跑"——abort 会把 A 的前端观察掐断，与用户直觉冲突
> 2. "我们不是抄 pi 吗？pi 需要面对这问题吗？TUI 不需要考虑吗？"——逼出"交互形态决定会话模型"的判断
> 随后用户要求对照 **opencode / reasonix / dsh** 做综合评价（2026-09-01 实际翻源码验证，非道听途说）。

### 1. 四家会话模型对照（源码实证）

| 项目 | 形态 | 会话模型 | 源码证据 |
|---|---|---|---|
| **pi** | TUI | 前台**一个** AgentSession；会话内串行（run 中发消息 = `steer()`打断 / `followUp()`排队）；切会话 = `rebindCurrentSession` 整个换前台 | `coding-agent/src/modes/interactive/interactive-mode.ts` L554-556（`runtimeHost.session` 单数）；`core/agent-session.ts` L925（`isIdle` 定义） |
| **Reasonix** | Go TUI + 桌面 | `Agent.sess` = "one conversation owns"；**切会话只在空闲时允许**；steerQueue（run 中插话排队） | `internal/agent/agent.go` L286-288、L581-592（注释原文：*"only swaps it via SetSession while idle"*） |
| **opencode** | TS TUI + server | **引擎层已分 key 并发**：*"Serializes execution for each key while allowing different keys to run concurrently"*；`SessionStore` 按 sessionID 组织 | `packages/core/src/session/run-coordinator.ts` L5-6；`store.ts` L15+ |
| **DSH** | Web harness | **session 是 run 的所有者，UI 只订阅投影**（useProjection / ChatNodeSeat 只订自己的 Node source）；chatperf 系列 commit 都是在此之上的每帧最小更新 | `packages/client/ui-conversation/`（导航手册走读 18）+ 2026-09-01 chatperf 批次 |

### 2. 结论：交互形态 → 架构映射，不是谁先进

- **TUI 系（pi / Reasonix）不需要方案 Y**：一个终端 = 一个前台会话，你"切去 B" = 离开 A 的现场（pi 换前台、Reasonix 干脆只在空闲时允许换）。并行发生在**进程级**（多开终端）。"run 不取消、切走继续"在 TUI 里物理上不存在。
- **opencode 是分水岭**：引擎层已把会话做成 owner（run-coordinator 跨 key 并发是一等公民），TUI 只是消费者。
- **DSH 把 session-owner 做成标配**：Web 形态（左侧会话列表 + 随时点）的用户心智天然是"多线程"。
- **对我们的裁决**：我们是 Web + 会话列表 UI，用户心智与 DSH 用户一致 → **方案 Y 不是"高级功能"，是形态匹配**。范本 = DSH（UI 投影）+ opencode（引擎并发）。pi/Reasonix 值得学的是"会话内串行"纪律（steer/followUp 队列 = 我们 `loading` 禁发送的完整版，B17④"输入框常驻"与 followUp 同思路），不是它们的会话切换模型。

### 3. 竞态定性升级：从"实现 bug"到"架构缺口"

四家里**只有我们**是"单份 useState 装多 run 帧"（use-agent-run 单会话状态机 + 服务端天然支持多 run 并行——每次 POST 独立 store + runControllers 按 runId 管理）。pi/Reasonix 单前台无并发所以没这问题；opencode/DSH 引擎层已分 key。所以它不是补丁能治的"实现细节 bug"，是**抄 pi 内核时把产品层形态也抄成了单会话**的架构缺口。

### 4. 决策（用户拍板方向，B17 拆分待确认）

- **方案 X（abort）在 Y 落地后是死代码**——Y 不但不需要 abort，abort 反而破坏"A 后台继续"（Y 要求 A 的流一直活着、一直往桶里写）。所以不写过渡的 abort。
- **B17 收窄**：① 改为"止血最小步"（或直接并入新条目）；②③④⑤ 不变（TaskPanel key / memo / 覆盖层 / 平铺）
- **新增条目（session-owner 多会话并行）**：run 状态 owner 从 UI 变会话——`runStore = Map<sessionId, RunState>`，每会话独立消费 SSE、独立累积；UI 只订阅当前 sessionId 的投影。**开工前先精读 DSH `useProjection`/session surface + opencode `run-coordinator`**（有明确"为什么抄"：Web 形态必然 + 服务端已支持 + 两家现成范本）。
- **服务端已支持并行**（route.ts：每次 POST 独立 store + runControllers 按 runId），方案 Y 主要改前端。
- **A 的工具审批策略**：切走期间 A 等到审批 → 没人答 → 5 小时超时自动拒绝（现状兜底，可接受）。

---

## 补记 2：②③④⑤ 实现完成（2026-09-14 施工记录，**待浏览器验收**）

> **背景**：① 已由 B22（session-owner）拆走并落地，本批只做 ②③④⑤。代码写完后**未提交**，在 2026-09-14 会话里被重新发现（PLAN 状态仍标"排队"，与实际不符）。

### 改动清单（5 文件，+143 / −68）

| 文件 | 改动 |
|---|---|
| `app/markdown.tsx` | **③** `Markdown` 包 `memo`——react-markdown + rehypeHighlight 是重活，流式时只有变化的那行 children 值变，浅比较直接跳过 |
| `app/components/message-row/index.tsx` | **③** `MessageRow` 包 `memo` |
| `app/page.tsx` | **③** `foldEvents` / 派生数据 `useMemo`（消 O(n²) 重折叠）；**③** `toolOutputs` 只下发给含 `toolCall` 的 assistant 行（避免全量新引用让 memo 失效）；**②** `<TaskPanel key={currentId} …/>`；**④** 决策区改 `decisionHost` + `{pendingApproval && …}` / `{pendingAsk && …}` 独立条件（替换原三选一嵌套三元） |
| `app/page.module.css` | **④** `.decisionHost` 覆盖层样式 |
| `app/repos/page.tsx` | **⑤** 抽出 `UpdateBody` 组件，五层嵌套三元 → **平铺提前 return** |

### 与详案初稿的差异（记录，避免以后对不上）

- 详案 §二 ④ 写的是 `styles.decisionOverlay`，**实际类名是 `decisionHost` + 复用 `decisionBar`**——覆盖层容器换名，卡片本身样式复用。
- 详案 §二 ③ 预言了 `toolOutputs` 新引用会让 memo 失效，**实际按"按行下发"解决**（不是比较函数），与预判一致。
- ⑤ 不只是"决策区平铺"，还**顺手把 repos/page.tsx 的示范点做了**（抽组件而非内联 if）。

### 验收状态：**已通过**（2026-09-14 用户确认此前已验收）

- 详案 §三 的浏览器验收项（流式只有更新行重渲染 / 长会话不卡 / 审批提问时输入框仍在 DOM / 命令面板行为等价 / 两 panel 互斥）—— **用户确认此前已过**
- `tsc --noEmit` **通过**（2026-09-14 沙箱实测，exit=0）
- ⚠️ 详案 §三写的回归基线"38 文件 332 用例"**已过期**——当前静态计数为 **41 文件 / 368 用例**
- ⚠️ vitest **沙箱里跑不了**（vite 8 内部 spawn 触发命名管道 EPERM，属沙箱限制非代码问题）→ 回归需本地跑

> **教训**：本项代码写完并验收过，但**从未提交**，一挂就是十来天，PLAN 状态也跟着停在"排队"——**收尾不 commit = 工作不存在**。
