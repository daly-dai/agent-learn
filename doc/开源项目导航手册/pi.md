# pi —— 主参考（我们 = pi 思想的 Next.js 重写）

> [返回索引](index.md)

**定位**：本项目架构的源头。monorepo 分包，TypeScript。学它的**分层纪律**与**教学可读性**。
**组织哲学**：`packages/` 按职责分包：`agent`（内核）/ `coding-agent`（产品）/ `ai`（模型适配）/ `protocol`（协议）/ `telemetry`（观测）。功能长在 `core/` 具体文件里，一文件一职责。

## 目录结构（只列核心，非完整树）

```
E:\agents-read\pi\
├─ packages/
│  ├─ agent/src/            ← 内核（最重要的目录）
│  │  ├─ agent.ts           ← 引擎循环（主参考）
│  │  ├─ agent-loop.ts      ← 双层循环 / 批处理 / 停止条件
│  │  └─ harness/
│  │     ├─ agent-harness.ts  events.ts  reducer.ts  types.ts  messages.ts  ← 事件协议/状态归约
│  │     ├─ session/          ← 会话树：session.ts / jsonl.ts / context.ts / memory.ts / state.ts
│  │     ├─ compaction/       ← 压缩：compaction.ts（848 行）/ branch-summarization.ts / utils.ts
│  │     └─ tools/            ← 工具：bash.ts / edit.ts / edit-diff.ts / read.ts / write.ts / image.ts / path-utils.ts
│  ├─ coding-agent/src/core/ ← 产品层（52 文件，扁平）
│  │  ├─ agent-session.ts  session-manager.ts  bash-executor.ts  exec.ts   ← 会话/终端
│  │  ├─ slash-commands.ts  skills.ts  settings-manager.ts  project-trust.ts
│  │  └─ usage-totals.ts  export-html  session-export.ts  model-registry.ts
│  ├─ ai/                   ← 模型适配层（provider 差异关这里）
│  ├─ evals/                ← 验证与评估（vitest 配置 + src/test）
│  └─ tui/  protocol/  telemetry/  server/  client/  session-backends/
└─ .pi/                     ← 用户配置目录（配置即文件思想）
```

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | Agent 循环（双层 while / 停止条件） | `packages/agent/src/agent-loop.ts` + `agent.ts` | ✅ 走读 01 |
| **C** 上下文 | 会话树 / buildContext / jsonl codec | `harness/session/{session,context,memory,jsonl,state,index}.ts` | ✅ 走读 03 |
| **C** 上下文 | 真摘要压缩（generateSummary） | `harness/compaction/compaction.ts` + `branch-summarization.ts` | ✅ 走读 04 |
| **T** 工具 | 工具系统（bash/read/write/edit） | `harness/tools/*.ts` | ✅ 走读 05 |
| **E** 执行 | 产品层（bash-executor / session-manager） | `coding-agent/src/core/{bash-executor,session-manager,agent-session}.ts` | ✅ 走读 12 |
| **O** 可观测 | 事件协议 / AgentTool 定义 | `harness/events.ts` + `types.ts` | ✅ 走读 02 |
| **G** 治理 | 项目信任（resolveProjectTrusted / trust store / defaultProjectTrust） | `coding-agent/src/core/project-trust.ts` + `coding-agent/src/cli/project-trust.ts`（UI 上下文） | 未精读 |
| **V** 验证 | 测试 / 评测（evals：行为级模型后端评测，vitest + *.eval.ts；test/ 是评测基建自身单测） | `packages/evals/`（vitest.config + src/*.eval.ts） | 未精读 |
| 附加 | 模型适配（多 provider） | `packages/ai/` | ✅ 略读（走读 02 对照） |
| 附加 | 终端 UI | `packages/tui/` | 未精读 |

## 搜索配方

- **语言**：TypeScript，直接读 `*.ts`。
- **找功能**：先猜包名（`compaction` → `harness/compaction/`），再在该目录内 grep 函数名。
- **grep 示例**：`grep -rn "generateSummary" packages/agent/src/harness/compaction/`。
- **注意**：pi 的 `node_modules` 巨大，搜索时排除。
