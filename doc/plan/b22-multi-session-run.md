# B22 多会话并行 run —— session-owner 架构（详案）

> **来源**：2026-09-01 用户提出"A 在输出、切到 B、A 应该继续跑"（方案 Y），09-02 拆分自 B17①。决策与四家对照见 `doc/plan/b17-frontend-race-and-render.md` 补记 1；参考精读见 `workspace/精读走读-session-projection-multi-run.md`。
>
> **状态**：✅ 完成（2026-09-02 施工、09-04 浏览器人工验收通过；实现细节与详案偏差见文末补记）
>
> **范围**：纯前端（`app/`）+ `lib/` 无改动（红线 `lib/agent/index.ts` 不碰）。服务端 SSE 协议不变、route.ts 不改。

## 一、要解决的问题

**现状**（use-agent-run.ts）：一份 useState 装"当前会话"的全部 run 状态。切会话 = `resetLocal()` 清空 → 拉新会话历史。但：
1. **A 会话正在跑的 SSE 流没有 abort**，帧继续被 `applyFrame` 消费 → A 的文本/统计/审批 **污染 B 的界面**
2. **A 的 run 被"遗忘"**：切走后前端不再收它的帧（resetLocal 清空后 applyFrame 写的还是同一份 state，等于 A 的进度对用户不可见）

**目标**（用户拍板 2026-09-02）：
- A 在后台跑，切到 B——A **继续跑**，B 界面干净
- 会话列表：A 显示运行状态点（执行中 loading / 结束绿点 / 等审批·askUser 黄点），**只显示非当前会话**
- 切回 A：跑完 → 完整结果；还在跑 → **实时流式接上**
- 停止按钮只停当前选中会话

## 二、架构：run 状态的 owner 从 UI 变会话

```
现状：UI = run 状态的所有者                目标：会话 = run 状态的所有者，UI 只投影
useAgentRun 一份 useState                 runStore = Map<sessionId, RunState>（zustand）
  └ sessionId 变 → resetLocal 清空         每个 run 的 SSE 消费循环独立、写自己的桶
                                            UI 只订阅「当前 sessionId」的投影
                                            切走 → A 的桶继续累积；切回 → 直接看最新
```

对齐参考（精读结论）：
- **zustand selector = DSH useProjection 同构**：`useRunStore(s => s.runs[sessionId])` 的引用稳定性 = "值引用只在帧落地时变化"
- **DSH 客户端"从不折叠、收成品值"** → 我们把 SSE 帧折叠成 RunState 的**纯函数**抽出来（`run-fold.ts`），store 只做桶管理
- **opencode "per-key 串行"** → 同会话 run 中禁发（保持现状 loading 门控），跨会话并行

## 三、文件结构（新/改）

```
app/lib/run-fold.ts     【新】纯函数：RunState + StreamFrame → RunState（无 React、无 IO，可单测）
app/lib/run-store.ts    【新】zustand store：桶管理 + 消费循环编排（start/stop/hydrate/delete）
app/lib/use-agent-run.ts【改】变薄：投影当前会话 + 触发 hydrate，对外签名不变（page.tsx 少改动）
app/components/session-list/* 【改】每会话行加状态点（只非当前会话显示）
```

### 1. run-fold.ts —— 帧折叠纯函数（对齐 DSH ProjectionDefinition.apply）

```ts
// RunState：一桶会话的完整 run 状态（就是现在 useAgentRun 的 state 集合）
export type RunState = {
  messages: AgentMessage[];
  observed: ObservedEvent[];
  loading: boolean;
  error: string;
  runId: string;
  model: string;
  stats: SessionStats;
  pendingApproval: ToolApprovalRequest | null;
  pendingAsk: PendingAsk | null;
  toolOutputs: Record<string, string>;
  todos: TodoItem[];
  compacting: boolean;
  contextPressure: ContextPressure | undefined;
  commandFeedback: string;
  commandRunning: boolean;
  // 状态点派生依据：当前 run 处于什么阶段
  runPhase: "idle" | "running" | "waiting-approval" | "waiting-ask" | "done" | "error";
};

export const EMPTY_RUN: RunState = { ... }; // loading:false, phase:"idle", …

// 一帧推进一桶状态：纯函数、无副作用。这就是现在 use-agent-run.ts
// applyFrame 里 switch 的搬运——搬出 React 后变成可单测的纯折叠。
export function foldRunFrame(state: RunState, frame: StreamFrame): RunState;

// 历史恢复（fetchHistory 结果 → 桶）：纯函数
export function applyHistory(state: RunState, history: ChatHistoryResult): RunState;

// 命令执行完成回填
export function applyCommandResult(state: RunState, result: { messages; stats; todos; contextPressure; feedback }): RunState;
```

> **为什么抽纯函数**：① B8 单测排队前先给逻辑层铺路（帧折叠最容易测：给 state + frame → 断言 state）② 对齐 DSH"领域是纯折叠单元、框架只驱动"哲学 ③ use-agent-run 现在 366 行里 switch 逻辑占大头，搬出去后 hook 只剩订阅。

### 2. run-store.ts —— zustand store + 消费循环

```ts
type RunStore = {
  runs: Record<string, RunState>;        // sessionId → 桶（Record 比 Map 对 zustand selector 更友好）
  startRun: (sessionId: string, text: string) => void;   // 发消息：建桶 → SSE 消费循环 → 逐帧 foldRunFrame
  stopRun: (sessionId: string, runId: string) => void;   // abort 本地流 + POST /stop（只停当前会话语义）
  hydrate: (sessionId: string) => Promise<void>;         // fetchHistory → applyHistory（切到冷会话时）
  deleteRun: (sessionId: string) => void;                // 删会话时清理桶 + abort 在跑流
  runCommand: (sessionId: string, line: string) => Promise<boolean>; // C13：执行 + 回填
};

export const useRunStore = create<RunStore>()((set, get) => ({ ... }));
```

**消费循环编排**（startRun 内部）：
```ts
// 关键：每个 run 一个独立 readStream 循环，闭包捕获自己的 sessionId
// ——帧只写自己的桶，天然隔离，不需要 abort 也不需要 sessionId 校验
async function consumeRun(sessionId: string, res: Response, apply: (f: StreamFrame) => void) {
  await readStream(res.body!, (frame) => {
    // 写桶：foldRunFrame(get().runs[sessionId] ?? EMPTY_RUN, frame)
    //       然后 set({ runs: { ...prev.runs, [sessionId]: next } })
    // 其他会话的桶引用不变 → 它们的订阅不触发（zustand selector 天然保证）
  });
}
```

### 3. use-agent-run.ts —— 变薄成投影

```ts
export function useAgentRun(sessionId: string) {
  // 只订当前会话的桶。sessionId 没桶（冷会话）→ hydrate 触发后补上。
  const run = useRunStore((s) => s.runs[sessionId] ?? EMPTY_RUN);

  // 切会话时：若桶不存在（刷新后/新会话）→ hydrate 拉历史
  useEffect(() => { void hydrateIfMissing(sessionId); }, [sessionId]);

  // 其余全是薄转发：send = startRun(sessionId, text)；approve/answerAsk/stop 同现在，
  // 只是作用对象从"这份 state"变成"这个桶"。返回结构与现在一致 → page.tsx 几乎不用改。
}
```

**page.tsx 改动**：列表保鲜 effect 里补"非当前会话 run 结束"的刷新判断（或简化：任何 run 的 done 帧都 refresh 列表）。

### 4. 会话列表状态点

- **数据**：SessionList 每行用一个极轻 selector：
  ```ts
  const phase = useRunStore((s) => s.runs[sessionId]?.runPhase ?? "idle");
  // 只取 runPhase（一个小字符串），不订 messages —— A 每帧更新时列表不重渲
  ```
- **显示规则**（用户拍板）：`currentId === sessionId` 时不显示（当前会话主体界面已有状态展示）；非当前会话才显示：
  - `running` → loading 动效（CSS 呼吸/旋转点）
  - `waiting-approval` / `waiting-ask` → 黄点
  - `done` → 绿点
  - `idle` / `error` → 不显示（error 由会话内横幅展示，列表不重复）

> **注意**：done 是"跑完"的绿点依据——run 结束后桶里 phase 保持 `done`，直到下一次 startRun 变 running。切走再切回，绿点仍在（说明"这个会话上次跑完了"，用户要的）。

## 四、验收标准

| # | 场景 | 预期 |
|---|---|---|
| 1 | A 发长任务（慢模型）→ 立刻切 B | B 转录稿/读数盘**无 A 内容**；A 的帧不触发 B 渲染 |
| 2 | 上一步，看会话列表 | A 行有 loading 动效；B 行无状态点（当前会话） |
| 3 | A 跑到一半要审批（写文件）→ 切 B | B 界面**无审批卡**；列表 A 行黄点 |
| 4 | 切回 A | 审批卡出现，可正常允许/拒绝；处理完 A 继续跑 |
| 5 | A 跑完 → 切回 A | 看到**完整结果**（done 帧权威值，无需重新拉） |
| 6 | A 还在跑 → 切回 A | **实时流式接上**（切走期间累积的进度可见，新帧继续增长） |
| 7 | run 进行中点"停止" | 只停当前会话；其他会话后台 run 不受影响（回归） |
| 8 | 冷启动/刷新后进会话 | 走 hydrate 拉历史（与现状一致）；无 run 的桶不显示状态点 |
| 9 | A、B 同时跑 | 两桶独立累积互不串；页面一次只看当前会话（回归） |
| 10 | 删除正在跑的会话 | 桶清理 + 流 abort，无残留报错 |

**单元测试**（`run-fold.test.ts`，vitest，纯函数先行）：给 EMPTY_RUN + 各类帧（run/event 各子型/done/error/tool_output/tool_todo/compacting/ask_user_request）断言 foldRunFrame 输出；applyHistory/applyCommandResult 同。

**回归**：`tsc --noEmit` + 全套 vitest（38 文件 332 用例 + 新增 run-fold）绿；浏览器人工走 1-10 场景 + 正常对话/审批/提问三条路径。

## 五、施工顺序（每步可运行）

1. **run-fold.ts + run-fold.test.ts**（纯函数 + 单测，先绿）——把 use-agent-run.ts 的 applyFrame switch 原样搬过来改签名
2. **run-store.ts**（zustand）：桶 + startRun 消费循环 + hydrate/stop/delete
3. **use-agent-run.ts 变薄**：投影 + hydrate 触发，对外签名不变 → page.tsx 不动先验证（tsc + 浏览器：单会话行为与现在完全一致）
4. **多会话验证**：A 跑中切 B（场景 1/2/5/6）
5. **会话列表状态点**（CSS + 行组件）
6. **审批/提问隔离验证**（场景 3/4）
7. 收尾：列表保鲜补非当前 run、回归全绿

## 六、已知边界（决策记录）

- **刷新丢实时观察**（用户暂不接受、记未来项）：runStore 内存态，刷新丢；服务端 run 继续跑完落盘，回 A 拉历史看结果。补实时需 run 脱离请求生命周期（opencode Session Runtime 形态），见 PLAN 7.3 衍生项锚点。
- **服务端 per-session 串行**（并发 POST 同会话）归 B11 会话级运行锁，本详案只做前端"loading 禁发送"门控（保持现状）。
- **多 run 并行上限**：用户拍板不限，但浏览器并发 fetch 有浏览器自身限制（~6 连接/域），超出排队由浏览器处理，非本项目逻辑。
- **B22 不动 route.ts**：done 帧已是权威值；如未来要"刷新重连"，先做"run 状态服务端可查"再谈 seq 裁决（精读结论：现在不需要）。

## 七、工作区前瞻（用户 2026-09-02 提问）

runStore 以**全局唯一 sessionId**（manager.ts `s_时间戳_随机`）为 key，天然不撞工作区。**约束**：runStore 不感知工作区（不做"一个工作区一个 store"）；订阅按 sessionId 粒度；列表状态点逻辑不耦合"当前会话列表"派生——C6 时列表数据源换"当前工作区的会话集合"即可，runStore 零改动。

## 八、实现补记（2026-09-02 施工 → 09-04 验收，与详案的偏差与实测）

**施工顺序落地**：① run-fold.ts + run-fold.test.ts（26 用例先绿）→ ② run-store.ts → ③ use-agent-run.ts 变薄 → ④ page.tsx / session-row 接线 → ⑤ 浏览器人工验收（用户 09-04 确认场景 1-10 全过）。

**与详案的偏差**（实现中发现更细的取舍，均对齐参考结论）：

1. **`runPhase` 落库字段 → 改成派生 `deriveRunPhase(run)`（run-fold.ts）**：详案把 `runPhase` 设计成桶字段，施工时发现它是纯派生态（pendingApproval > pendingAsk > loading > lastOutcome），落库会引入"字段与派生不一致"的维护面 → 改为不落库、每次渲染重算（对齐 task-panel show / B20 状态派生精神）。桶里只存事实字段 `lastOutcome: "none"|"done"|"error"`（done/error 帧写入，startRun 重置为 none）——状态点/决策区全从它派生。
2. **`freshRun(base)` 起点函数**（详案只有 EMPTY_RUN）：新 run 起点 = 保留 messages/todos/stats/contextPressure（多轮对话跨 run 延续）、清 run 瞬态（observed/loading/error/runId/model/pending*/toolOutputs/compacting/commandFeedback/lastOutcome）；容器字段给新引用（不与 EMPTY_RUN 共享数组，避免"折叠从不原地改但调用方持有旧引用"的隐性雷）。startRun 用它而非 EMPTY_RUN——否则第二轮消息会把第一轮 messages 冲掉。
3. **store 动作签名补齐**：详案列的 startRun/stopRun/hydrate/deleteRun/runCommand 外，实现还搬进了 `approve` / `answerAsk` / `setError`（原 use-agent-run 里对审批卡/提问卡/错误横幅的处理全跟状态一起迁 store，否则切会话审批卡就丢了——验收场景 3/4 的保障）；use-agent-run 只剩纯转发。
4. **stopRun 不 abort 本地流**（与详案"abort 本地流 + POST /stop"不同）：POST /stop 是**受控收尾**——服务端引擎 return 半截档案，`done` 帧照发（含 contextPressure/stats/todos 权威值）。若本地 abort，done 被掐断 → 占用/统计不刷新。本地 abort 只留给 deleteRun（桶都没了，流自然无用）。readStream 加 `signal` 参数（sse.ts）为 deleteRun 服务。
5. **消费循环帧折叠放 `set` 函数式里**（run-store.ts startRun）：`set((state) => ... foldRunFrame(state.runs[sessionId], frame))` —— 在 set 回调内取最新桶，避免闭包捕获旧桶 + 多次 set 竞态。帧在途时桶已被删 → 原样返回丢弃。
6. **`replaceRun` 只替换一个桶**：其他会话桶引用不变 → 它们的订阅不触发（zustand selector 引用比较天然保证）。这是"切会话后 A 每帧更新不触发 B 视图重渲"的机制实现（非手动优化）。
7. **hydrate 语义**：桶不存在才拉历史（`hydrateIfMissing`）；拉回时桶已存在（竞态：刚 startRun / 并发 hydrate / 切回在跑会话）→ 不覆盖，让在跑的继续（done 帧是权威值，历史快照不该盖它）。
8. **列表保鲜升级**（page.tsx）：原「当前会话 loading 跳变 → refresh」只覆盖前台会话 → 改用 `useRunStore.subscribe` 订阅**任一会话**桶的 `loading: true→false`（含 done/error/停止/网络断）都 refresh 列表——B22 后后台会话跑完也要刷新左侧（预览/时间/排序）。用 loading 跳变而非 done 帧事件：覆盖没有 done 帧的收尾路径。
9. **状态点 selector 极轻**：SessionRow 里 `useSessionRunPhase(session.id)`（run-store.ts 导出）selector 返回一个小字符串（RunPhase）——桶每帧更新时 phase 不变 → 行组件不重渲（列表 A 每帧刷新时只有 A 行变，其他行不动）。状态点用 `data-phase` 属性 + CSS（B21 的 data-\* 语义化顺手复用），只显示非当前会话。
10. **activeAborts / deletedSessions 不进 store state**：AbortController 是运行时句柄不是 UI 状态，放 state 会让订阅误触发；已删会话标记防"hydrate 在途时删了会话、返回后复活桶"。

**验收结果**：`tsc --noEmit` 0 错误；`run-fold.test.ts` 26 用例全绿；全套 39 文件 358 用例全绿（原 38/332 + run-fold 26）；浏览器人工验收场景 1-10 全过（用户 2026-09-04 确认）——A 跑中切 B 界面干净 / 列表状态点只非当前会话 / 审批卡按桶隔离切回还在 / 切回实时接上 / 删在跑会话无残留报错。

**坑**：① 沙箱跑 vitest 启动即 EPERM（vitest 内部 spawn worker 被受限模式挡，非测试失败）——需完整权限跑；② git diff 输出中文经 pwsh 管道变乱码是显示问题（ConstrainedLanguage 噪音），文件本身 UTF-8 正常；③ `EMPTY_RUN` 的 ZERO_STATS 是共享常量对象，折叠不原地改所以安全，但 freshRun 后 stats 引用仍共享——stats 是只读展示值，无写路径，可接受。
