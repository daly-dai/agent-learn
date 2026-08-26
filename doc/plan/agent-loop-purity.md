# doc/plan/agent-loop-purity —— agent-loop 纯净性改造（施工补记）

> 来源：PLAN.md "agent-loop 纯净性改造·实现前补记"段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**（`6b87976`），保留作施工历史。
> 完整改动点全览见 `doc/01-agent-loop-纯净性改造.md`（方案 B 定稿版）。

> 触发：用户指出 `RunAgentLoopOptions` 里混入 `onTodoWrite`/`onAskUser` 两个业务名回调——引擎（agent-loop）被业务污染。判据（用户定）：**agent-loop 原则上不允许污染，除非 pi 也是这么做的。** 精读 pi 后确认：pi 的引擎不认识任何业务（context 闭包注入 + 事件外推），所以对齐 pi。

**核心思想（方案 B · 完全贴 pi）**：业务 hooks 从「引擎 options 透传」改为「工厂参数 + 闭包烙」——引擎只传运行时参数（signal/onChunk），连"递容器"都不做。pi 源码对应：

- 引擎调用工具：`execute(toolCallId, params, signal, onUpdate)` —— 4 个运行时参数，无 context（`pi-agent-core/src/agent-loop.ts:679`）
- 业务 context 注入：`execute: (id, params, signal, onUpdate) => tool.execute(id, params, signal, onUpdate, context)` —— 闭包烙（`pi-agent-core` 的 `create-harness.ts:35`）
- 组装：`createCodingAgentHarness` 每次会话组装，`toolContext = { env }`（create-harness.ts:99）

**改动（一句话版）**：

- **`lib/tools/types.ts`**：新增 `ToolHooks`（onTodoWrite/onAskUser）；`ToolExecutorOptions` 删掉这两个业务字段（只留 signal/onChunk 运行时参）
- **工具工厂**：`todo`/`ask-user` 改 `createXxxTool(hooks)`，`execute(args)` 用烙进来的 hooks；其余 7 个文件工具 + bash **零改动**（本就只收 args / 只用运行时参）
- **`lib/agent.ts`**（红线核心）：`RunAgentLoopOptions` 删 `onTodoWrite`/`onAskUser`；`executeToolCall` 只透传 signal/onChunk
- **`app/api/chat/route.ts`**（唯一接口层改动）：删模块级单例，POST 内每请求组装 `createToolRegistry(workspaceRoot, hooks)`，hooks 闭包捕获当次 store/send
- **测试**：todo/ask-user 测试改 `createXxxTool(hooks)` + `execute(args)`

**决策点（已定稿）**：① hooks 用工厂闭包（贴 pi `createCodingAgentHarnessTool`）② `onToolOutput` 留在引擎（= pi execute 第 4 参 onUpdate）③ `beforeToolCall` 审批钩子保留（pi 同款）。

**验收**：`RunAgentLoopOptions`/`ToolExecutorOptions` 无业务字段；todo/ask-user 通过闭包拿到 hooks（不经引擎）；`pnpm test`（84 用例）全绿 + `tsc --noEmit` 通过；行为与 A4 commit 前完全一致（无功能回归）。
