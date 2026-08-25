# agent-loop 纯净性改造 · 改动点全览（方案 B：完全贴合 pi）

> 触发：2026-08-24，用户指出 `RunAgentLoopOptions` 里混入了 `onTodoWrite`/`onAskUser` 两个**业务名**回调——agent-loop（引擎）被业务污染。
> 判据（用户定）：**agent-loop 原则上不允许污染，除非 pi 也是这么做的。** 精读 pi 后确认：pi 的引擎不认识任何业务（context 闭包注入 + 事件外推），所以我们要对齐 pi。
> 定位：这是 **A4 之外的独立架构修正**，比新功能更重要（"内核稳定、能力外挂"）。
> 2026-08-24 定稿：**方案 B（完全贴 pi）**——业务 hooks 走「工厂参数 + 闭包烙」，引擎只传「运行时参数」（signal/onChunk），连"递容器"都不做。决策点①②③ 见文末。

---

## 0. 问题定位（确认版）

**污染点**：`lib/agent.ts` 的 `RunAgentLoopOptions` 里有 `onTodoWrite`、`onAskUser` 两个业务字段。引擎被迫"认识" todo 和提问。

**真正的根源（比"用了回调"更本质）**：
- `app/api/chat/route.ts` 顶部：`const toolRegistry = createToolRegistry(workspaceRoot)` —— **模块级单例**
- 工具是全局的 → 拿不到"每次请求的 store / send"
- 才被迫用"引擎透传回调"这条绕路，让引擎当"搬运工"

pi 的答案：**工具不是单例，而是每次会话/请求组装时闭包捕获 context**。所以它不需要引擎透传。

---

## 1. 设计意图（先把"为什么"讲透）

对齐 pi 的三条精髓（全部有 pi 源码对应）：

1. **每请求组装工具**（业务 context 闭包注入），不是"引擎透传回调"
   - pi：`createCodingAgentHarness`（业务组装层）每次发起会话时组装，`toolContext = { env }`（create-harness.ts:99）
2. **引擎只传「运行时参数」，不传任何业务、也不递"容器"**
   - pi：引擎 `execute(toolCallId, params, signal, onUpdate)`（agent-loop.ts:679）——**4 个独立参数**，没有 context 参数
   - 业务 context 是 `createCodingAgentHarnessTool` 用**闭包烙**进工具的（create-harness.ts:35）：`execute: (id, params, signal, onUpdate) => tool.execute(id, params, signal, onUpdate, context)`
3. **工具签名区分「运行时参」和「闭包参」，靠位置天然分开**
   - 闭包参（业务 hooks/env）→ **工厂函数参数**（`createTodoTool(hooks)`），烙进 execute 身体
   - 运行时参（signal/onChunk）→ **execute 执行参数**（`execute(args, {signal, onChunk})`），引擎每次传

改造后：
- 业务能力装进 `ToolHooks`（onTodoWrite/onAskUser），由 route.ts 组装时**通过工厂参数闭包烙进**需要它的工具
- 引擎 `RunAgentLoopOptions` 去掉 `onTodoWrite`/`onAskUser`；`executeToolCall` 只透传运行时参数
- **引擎从头到尾不知道 hooks 存在**（连"容器"都不递，最彻底地干净）

```
现在：  工具单例 → 引擎 options 里有 onTodoWrite/onAskUser → 引擎透传
目标：  每请求组装工具（工厂参数收 hooks 闭包烙） → 引擎只传运行时参，无业务回调、无容器
```

---

## 2. 逐文件改动点（方案 B · 完全贴 pi）

### 2.1 `lib/tools/types.ts` —— 定义核心类型（引擎不认识的内容都在这）

**新增** `ToolHooks`（业务回调袋），**替换** `ToolExecutorOptions`（只留运行时参）：

```ts
// 业务回调袋：引擎不认识里面是什么，工具在"工厂参数"里接收并闭包烙入
export type ToolHooks = {
  onTodoWrite?: (todos: TodoItem[]) => Promise<void> | void;
  onAskUser?: (questions: AskQuestion[]) => Promise<string[]> | string[];
};

// 运行时执行上下文：每次工具调用都不同，引擎每次执行时传
export type ToolExecutorOptions = {
  signal?: AbortSignal;              // 取消（每次 run 不同）
  onChunk?: (text: string) => void;  // bash 流式（每次执行不同）
};
// ↑ onTodoWrite / onAskUser 从这里【删掉】——它们搬进 ToolHooks，走工厂参数
```

**设计要点**：业务和运行时**彻底分家**——hooks 走工厂参数（闭包烙），signal/onChunk 走执行参数（引擎传）。引擎的 `executeToolCall` 只碰 `ToolExecutorOptions`，不认识 `ToolHooks`。

### 2.2 各工具 `execute` 签名改造（两条路线，按"是否需要业务"分）

**路线一：需要业务的工具（todo / ask-user）——工厂参数收 hooks 并闭包烙**

`todo/index.ts`：
```ts
export function createTodoTool(hooks: ToolHooks): RegisteredTool {
  return {
    name: "todo_write",
    // ...description/parameters 不变
    async execute(args) {                       // ← 第二参 options 删掉！
      const todos = validateTodos(args.todos);
      await hooks.onTodoWrite(todos);           // ← 用烙进来的 hooks（闭包参），不靠执行参数
      const counts = countTodos(todos);
      return { content: [text(`已更新任务清单：${counts.pending} 待办...`)], details: { todos, counts } };
    },
  };
}
```

`ask-user/index.ts`：同样，`createAskUserTool(hooks)`，`execute(args)` 里 `await hooks.onAskUser(questions)`。

**路线二：不需要业务的工具（list/read/write/edit/delete/grep/find/write-note/bash）——只处理运行时参**

- **纯文件工具**（list/read/write/edit/delete/grep/find/write-note）：`execute(args)` **签名不变**（它们本来就只收 args，见 grep 确认：全部 `async execute(args)`）。**零改动**。
- **bash**：`execute(args, options)` → 保留第二参，但 options 现在只含 `{ signal, onChunk }`（运行时参）。`options?.signal` / `options?.onChunk` 不变（`bash/index.ts:43-44`）——它本来就只用运行时参，**不需要 hooks**。

### 2.3 `lib/tools/index.ts` —— 组装层（每请求 + 工厂参数传 hooks）

```ts
export function createToolRegistry(
  workspaceRoot: string,
  hooks: ToolHooks,   // 业务回调，只传给需要它的工具工厂
): ToolRegistry {
  const registry = new ToolRegistry();

  // 文件工具 + bash：不需要 hooks，工厂签名不变
  for (const tool of [
    createListTool(workspaceRoot),
    createReadTool(workspaceRoot),
    createWriteNoteTool(workspaceRoot),
    createWriteTool(workspaceRoot),
    createEditTool(workspaceRoot),
    createDeleteTool(workspaceRoot),
    createGrepTool(workspaceRoot),
    createFindTool(workspaceRoot),
    createBashTool(workspaceRoot),
  ]) {
    registry.register(tool);
  }

  // 需要业务的工具：把 hooks 传进工厂，它自己闭包烙（贴 pi：context 烙进工具）
  registry.register(createTodoTool(hooks));
  registry.register(createAskUserTool(hooks));

  return registry;
}
```

**关键**：只有 todo/ask-user 接收 hooks 并烙；其余工具零改动。这对应 pi 的 `createCodingAgentHarnessTool(裸工具, context, prompt)`——context 只烙进需要它的工具。

### 2.4 `lib/agent.ts` —— 引擎去业务化（红线核心，改得最少）

```ts
// RunAgentLoopOptions：删掉 onTodoWrite / onAskUser（业务字段）
RunAgentLoopOptions = {
  systemPrompt, messages, tools, model, toolRegistry,
  maxTurns?, beforeToolCall?, onEvent?, signal?,
  onToolOutput?,   // 保留：运行时流（决策点 2：留在引擎）
};

// executeToolCall 只透传运行时参（不再有 onTodoWrite/onAskUser 字段）
async function executeToolCall(toolCall, toolRegistry, toolOptions?: {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;   // ← 只有运行时参
}): Promise<ToolResultMessage> { ... }
```

调用处（agent.ts:313-322）从：
```ts
{
  signal: options.signal,
  onChunk: (text) => options.onToolOutput?.(toolCall.id, text),
  onTodoWrite: options.onTodoWrite,     // ✗ 删
  onAskUser: options.onAskUser,         // ✗ 删
}
```
改成：
```ts
{
  signal: options.signal,
  onChunk: (text) => options.onToolOutput?.(toolCall.id, text),
}
```

**引擎不再有** `onTodoWrite`/`onAskUser` 字段。这就是"loop 删无用代码"。

### 2.5 `app/api/chat/route.ts` —— 每请求组装 + 工厂参数注入 hooks（唯一接口层改动）

```ts
// 删掉模块级单例（第 57 行）：const toolRegistry = createToolRegistry(workspaceRoot)

// POST 内、store 创建之后，每请求组装一次：
const toolRegistry = createToolRegistry(workspaceRoot, {
  onTodoWrite: async (todos) => {
    await store.appendTodo(todos);          // 闭包捕获"这次请求"的 store
    send({ type: "tool_todo", todos });
  },
  onAskUser: (questions) => askUserAnswer(questions, recorder.runId, send),
});
```

**注**：`signal`/`onChunk` 仍在引擎执行时注入（运行时参，每次调用不同）；业务 hooks 走工厂参数闭包烙（组装时）。二者彻底分家。

### 2.6 测试改参

- `todo/index.test.ts`：`tool.execute(args, { onTodoWrite })` → `createTodoTool(hooks)` + `tool.execute(args)`
- `ask-user/index.test.ts`：`tool.execute(args, { onAskUser })` → `createAskUserTool(hooks)` + `tool.execute(args)`
- 纯文件工具测试：不变（本来就 `execute(args)`）
- bash 测试：若传过 options 则保留 `{ signal, onChunk }`

---

## 3. 决策点（已定稿，方案 B）

| # | 决策 | 定稿 | pi 对应 |
|---|---|---|---|
| 1 | **hooks 怎么传给工具** | **工厂闭包**：`createTodoTool(hooks)`，只有需要业务的工具接收并烙进闭包 | pi `createCodingAgentHarnessTool(裸工具, context, prompt)` 把 context 烙进工具（create-harness.ts:35） |
| 2 | **`onToolOutput`（bash 流式）** | **留在引擎**（运行时流，非业务污染） | pi 引擎 execute 的第 4 参 `onUpdate`（agent-loop.ts:683） |
| 3 | **引擎 `beforeToolCall`（审批）** | **保留**（通用钩子） | pi `AgentLoopConfig.beforeToolCall`（agent-loop.ts:619） |

**定稿原则**：引擎只保留「通用概念」（运行时参数、事件、通用钩子）；**业务（todo/ask）一律走工厂闭包**，引擎连"递容器"都不做——这是与 pi 一字不差的彻底版。

---

## 4. 涉及文件清单（最终版）

| 文件 | 改动性质 |
|---|---|
| `lib/tools/types.ts` | 新增 `ToolHooks`；`ToolExecutorOptions` 删掉 `onTodoWrite`/`onAskUser` |
| `lib/tools/index.ts` | `createToolRegistry(workspaceRoot, hooks)`；todo/ask-user 工厂收 hooks，其余不变 |
| `lib/tools/todo/index.ts` | `createTodoTool(hooks)`，`execute(args)` 用烙的 hooks |
| `lib/tools/ask-user/index.ts` | `createAskUserTool(hooks)`，`execute(args)` 用烙的 hooks |
| `lib/tools/{list,read,write,write-note,edit,delete,grep,find}/index.ts` | **零改动**（本来就 `execute(args)`） |
| `lib/tools/bash/index.ts` | 保留第二参（运行时 signal/onChunk），不需 hooks；可不动或微调注释 |
| `lib/agent.ts` | 删 `onTodoWrite`/`onAskUser` 字段 + 透传段（红线核心） |
| `app/api/chat/route.ts` | 删模块级单例；POST 内每请求组装 + 工厂参数注入 hooks（唯一接口层改动） |
| `lib/tools/{todo,ask-user}/index.test.ts` | 改 `createXxxTool(hooks)` + `execute(args)` |

> 其他路由（approve/stop/ask-user/sessions）**不创建 registry**（grep 证实 `createToolRegistry` 只在 route.ts 出现），**不动**。

---

## 5. 这个改造学到的知识点（拆解目标）

1. **为什么 agent-loop 必须纯净**：内核越小越稳，能力全在接口实现和组装层。
2. **"每请求组装" vs "单例"**：单例拿不到动态 context，被迫引擎透传；pi 用每请求组装避开。
3. **"业务 context 闭包注入" vs "引擎透传回调"**：前者业务烙进工具、引擎无感；后者引擎被迫认识业务。
4. **"运行时参 vs 闭包参"**：靠位置天然分开——业务走「工厂参数」烙，signal/onChunk 走「执行参数」引擎传；引擎 execute 只传 4 个运行时参（pi agent-loop.ts:679）。
5. **组装方 vs 使用方**：工具在组装层（route.ts = create-harness 角色）生成并烙业务，loop 只消费不生成。
6. **偏函数（partial application）**：`createCodingAgentHarnessTool` 本质是用闭包做偏函数——固定业务参数（context），只暴露引擎要传的运行时参数。
7. **泛型缝隙（generic seam）**：pi 用 `TContext extends object` 留缝隙，业务层填充，引擎不见内容。

> 本文档是"决策点 + 改动点"全览。核心概念（每请求组装 / 闭包注入 / 事件外推）可拆出来单独讲透。
