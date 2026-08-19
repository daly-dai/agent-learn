# Agent Loop 详解 —— 逐段讲解 + 全局视角

> 配合 `lib/agent.ts`、`lib/types.ts`、`app/api/chat/route.ts`、`app/page.tsx` 一起阅读。
> 这份文档回答三件事：**每个事件是什么、使用端怎么接收、为什么这么设计**。

---

## 0. 全局视角：一张图看懂整个系统

```
浏览器 page.tsx ──fetch POST /api/chat──▶  route.ts（第一个使用端）
                                              │
                                              │ 1. createUserMessage 造用户消息
                                              │ 2. runAgentLoop({ ..., onEvent })
                                              │ 3. onEvent 里把事件写进 SSE 流
                                              ▼
                                        runAgentLoop（引擎，无 UI / 无 HTTP）
                                        ├─ model.complete()   ← "大脑"（接口）
                                        ├─ toolRegistry       ← "手脚"（接口）
                                        └─ emit(event)        ← "过程广播"
                                              │
                                              ▼
                          SSE 流 ──▶  page.tsx（第二个使用端）
                                      ├─ 每条 event → 追加进 Event Timeline
                                      ├─ message_start → 实时画消息气泡
                                      └─ done → 覆盖为最终结果
```

**核心认知：`runAgentLoop` 是「库 / 引擎」，不是整个应用。** 它不 import React、不 import HTTP，只做两件事：

1. 产出**结果数据** `newMessages`（最终对话记录）；
2. 广播**过程事件** `events`（每一步发生了什么）。

**使用端（消费者）** = 调用它、并消费这两个产物的一方。本项目里有两级使用端：

| 层级 | 文件 | 消费什么 | 拿去干什么 |
|---|---|---|---|
| 服务端 | `app/api/chat/route.ts` | `onEvent` 回调 + `newMessages` | 边跑边把事件写进 SSE 流，最后发 `done` |
| 浏览器 | `app/page.tsx` | SSE 流里的帧 | 实时渲染聊天区 + 右侧事件时间线 |

---

## 1. 事件的两条通道：为什么「又回调又返回」

`emit`（`lib/agent.ts`）同时做两件事：

```ts
const emit = (event) => {
  events.push(event);          // ① 存进本地数组，最后 return（拉取式 pull）
  options.onEvent?.(event);    // ② 立刻推给外部回调（推送式 push）
};
```

这是**两种互补的消费模式**，让引擎不依赖任何一种消费者：

- **① 返回值 `events` 数组（拉取式）**：适合「跑完一次性处理」——测试、批处理、日志落盘。
- **② `onEvent` 回调（推送式）**：适合「边跑边处理」——流式输出（SSE）、实时日志、中途中止、权限弹窗。

**以前你看到的「重复」**：`route.ts` 里 `onEvent` 把事件收进 `sessionEvents`，而 `runAgentLoop` 返回的 `result.events` 根本没用——同一个事件被收集了两遍。这是教学 demo **故意同时展示两种模式**。真实项目通常二选一：

- 流式 → 只用 `onEvent`（改造后的 B 方案就是这么做的）；
- 一次性 → 不传 `onEvent`，`await` 后直接用 `result.events`。

---

## 2. 逐段讲解 `runAgentLoop`

### 2.1 初始化（Step 1）

```ts
const events: AgentEvent[] = [];
const emit = (event) => { events.push(event); options.onEvent?.(event); };
const context = [...options.messages];   // 复制，避免改调用方原数组
const newMessages: AgentMessage[] = [];
const maxTurns = options.maxTurns ?? 6;
emit({ type: "agent_start" });
```

- `context` 是「工作副本」：循环会往里 push，复制一份是为了**副作用隔离**。
- `newMessages` 是「本轮产出」：最终 return 给调用方。
- `maxTurns` 是「保险丝」：防止模型一直调工具导致无限循环。

### 2.2 主循环：让模型「想」一次（Step 3）

```ts
for (let turn = 1; turn <= maxTurns; turn++) {
  emit({ type: "turn_start", turn });
  const assistant = await options.model.complete({...});
  context.push(assistant);       // 进入上下文
  newMessages.push(assistant);   // 记录产出
  emitMessageLifecycle(assistant, emit);
```

- 每轮开头发 `turn_start`，让使用端知道「新一轮开始了」。
- `model.complete` 是**接口**（`TeachingModel`），引擎不关心它是 MockModel 还是真实 LLM——这叫**依赖倒置**。

### 2.3 异常终止：为什么 `return` 而不是 `throw`

```ts
if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
  emit({ type: "turn_end", ... });
  emit({ type: "agent_end", messages: newMessages });
  return { newMessages, events };
}
```

这里的「异常」是**模型层异常**（`stopReason: "error"` / 用户中断 `"aborted"`），不是 `runAgentLoop` 自己崩了。

- `return` = **受控收尾**：把「到目前为止的半截对话 + 过程」交出来，前端还能渲染，而不是白屏。
- `throw` = **连档案都生产不出来**，调用方只能显示一句「出错了」。

对比：
- `return` 让前端优雅呈现「出错前的完整过程」；
- `throw` 让前端拿不到任何中途产物。

### 2.4 提取工具调用：类型守卫

```ts
const toolCalls = assistant.content.filter(
  (block): block is ToolCallContent => block.type === "toolCall",
);
```

`assistant.content` 是 `Array<TextContent | ToolCallContent>`（文本块或工具调用块）。普通 filter 之后 TS **仍认为是联合类型**，无法访问 `.name`。

`(block): block is ToolCallContent` 是**类型谓词（type guard）**：告诉 TS「返回 true 时这个 block 一定是 ToolCallContent」，于是数组被窄化成 `ToolCallContent[]`。

等价于 `message.ts` 里的 `isTextContent`，只是**内联写在了 filter 里**。

### 2.5 没有工具调用 → 正常结束

```ts
if (toolCalls.length === 0) {
  emit({ type: "turn_end", ... });
  emit({ type: "agent_end", messages: newMessages });
  return { newMessages, events };
}
```

模型直接给出文本答案（`stopReason: "stop"`），不需要工具，循环结束。

### 2.6 逐个执行工具 + 审批（Step 5）

```ts
const decision = await decideToolCall(toolCall, options.beforeToolCall);
if (decision.action !== "allow") {
  emit({ type: "tool_permission", ... });
}
```

审批是**三选一**：`allow`（放行）/ `block`（拦截）/ `rewrite`（改写参数）。

- `allow` 太普通，**不打事件**，避免刷屏；
- `block` / `rewrite` 是「值得记录」的敏感操作，发 `tool_permission` 事件留审计痕迹。

`decideToolCall` 的作用是**补齐默认值**：使用端没传 hook 时默认返回 `allow`，保证 `decision` 永远有值，后面就能放心用 `decision.action` 而不是处处 `decision?.action`。

```ts
if (decision.action === "block") {
  const blockedResult = createBlockedToolResult(toolCall, decision.reason);
  ...push...
  emitMessageLifecycle(blockedResult, emit);
  continue;   // 跳过执行，处理下一个工具
}
```

`block` 不真正执行，而是**伪造一条 `isError=true` 的 toolResult** 回给模型，让模型看到「被拦截了」而不是卡死。

```ts
const executableToolCall =
  decision.action === "rewrite"
    ? { ...toolCall, arguments: decision.args }   // 用新参数
    : toolCall;                                   // 用原参数

emit({ type: "tool_execution_start", ..., args: executableToolCall.arguments });
const toolResult = await executeToolCall(executableToolCall, options.toolRegistry);
...
emit({ type: "tool_execution_end", ... });
emitMessageLifecycle(toolResult, emit);
```

**关键：`toolResult` 必须 push 进 `context`**，模型下一轮才能「看到」工具结果——这就是 ReAct 的**短期记忆**。

`tool_execution_start` 的 `args` 只传**参数**（`executableToolCall.arguments`），不是整个 toolCall 对象。

### 2.7 超出最大轮次 → guardrail（Step 7）

```ts
const guardrail = createLoopGuardrailMessage(maxTurns);
newMessages.push(guardrail);
emitMessageLifecycle(guardrail, emit);
emit({ type: "agent_end", messages: newMessages });
```

模型一直调工具没完没了时，注入一条 `stopReason: "error", errorMessage: "max_turns_exceeded"` 的兜底消息，明确告诉使用端「是被上限截断的，不是正常回答」。

---

## 3. 事件协议一览（12 种）

定义在 `lib/types.ts`，靠 `type` 字段区分的**可辨识联合类型**：

| 事件 | 含义 | 谁发 | 使用端能干嘛 |
|---|---|---|---|
| `agent_start` | 整个循环开始 | 引擎 | 显示「开始」 |
| `agent_end` | 整个循环结束 | 引擎 | 显示「结束」，拿到 messages |
| `turn_start` / `turn_end` | 每一轮边界 | 引擎 | 看模型跑了几轮 |
| `message_start` | 消息出现（气泡占位） | 引擎 | 画气泡 |
| `message_update` | 消息内容追加（delta） | 引擎 | 逐 token 追加渲染 |
| `message_end` | 消息完成 | 引擎 | 标记气泡完成 |
| `tool_execution_start` / `tool_execution_end` | 工具开始/结束 | 引擎 | 显示工具进度、参数、结果 |
| `tool_permission` | 审批（block/rewrite） | 引擎 | 审计「谁拦截了什么」 |
| `compaction` | 上下文压缩 | （本版未用） | 显示内存整理 |

消费者用 `switch (event.type)` 处理；`page.tsx` 里的 `default: { const _: never = type }` 是**穷尽性检查**——以后新增事件类型时，TS 会在消费者处报错逼你处理。

---

## 4. 为什么整体要这么设计（好处）

1. **观察者模式**：`emit` + `onEvent` 就是经典发布-订阅。引擎不知道订阅者是谁，UI/网络/日志这些「脏活」全部由外部决定 → **关注点分离**。
2. **事件溯源**：`events` 是只追加的过程日志，可**回放、审计、调试、教学**（右侧 Timeline 就是它的意义）。
3. **可辨识联合类型**：协议演进变成**编译期保障**。
4. **协议解耦流式/非流式**：`message_start/update/end` 照着真实 token 流式模型的形状设计。MockModel 一次性返回所以三件事背靠背瞬间发完，但**换真实流式模型时前端一行不用改**。
5. **依赖倒置**：引擎依赖 `TeachingModel` / `ToolRegistry` / `BeforeToolCall` 等接口，换实现不动内核。

---

## 5. 没有这些事件会怎么样？

**答案：Agent 仍能跑出正确答案，但会变成黑盒。**

- ✅ 保留的：用户问 → 模型答 → 工具结果 → 最终答案，`messages` 这条数据链完整。
- ❌ 失去的：

| 能力 | 对应事件 |
|---|---|
| 实时进度（边跑边看） | 所有事件 + `onEvent` 推送 |
| 看模型跑了几轮 | `turn_start` / `turn_end` |
| 看工具调了什么、结果、是否失败 | `tool_execution_start` / `tool_execution_end` |
| 中途取消 | 靠事件/流式知道「现在跑到哪」 |
| 权限审计 | `tool_permission` |
| 教学/调试 | 右侧 Timeline |

一句话：**`messages` 是结果（state），`events` 是过程（observability）。结果保证正确性，过程保证可观测、可审计、可交互、可调试。**

---

## 6. 常见疑问 FAQ

- **Q：异常终止为什么要 return 结果？** 见 §2.3。
- **Q：为什么要 return events？** 见 §1——给「拉取式」消费者用；不传 `onEvent` 的调用方（测试/CLI）就靠它拿过程。
- **Q：filter 里的 `block is ToolCallContent` 是什么？** 见 §2.4——类型守卫。
- **Q：`message_update` 为什么存在？** 见 §4.4——为真实 token 流式预留的协议形状。
- **Q：`toolResult` 为什么要 push 进 context？** 见 §2.6——短期记忆。
- **Q：SSE 和普通 JSON 响应的区别？** 见 `route.ts` 顶部注释——SSE 是边跑边推的单向流。

---

## 7. 改造后各文件的职责

| 文件 | 角色 | 职责 |
|---|---|---|
| `lib/types.ts` | 协议 | 定义消息/事件/工具的类型，前后端共用 |
| `lib/message.ts` | 辅助 | 造消息、提取文本 |
| `lib/model.ts` | 接口 | 定义「大脑」的契约 |
| `lib/mockModel.ts` | 模型实现 | 关键词驱动的模拟模型（含演示延迟） |
| `lib/tools.ts` | 工具 | 文件系统工具 + 安全边界 |
| `lib/agent.ts` | **引擎** | ReAct 循环，产出结果 + 广播事件 |
| `app/api/chat/route.ts` | **使用端（服务端）** | 用 `onEvent` 把事件写进 SSE 流 |
| `app/page.tsx` | **使用端（浏览器）** | 读取 SSE 流，实时渲染消息 + 时间线 |
