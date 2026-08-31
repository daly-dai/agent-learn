# langchainjs —— LangChain JS 生态参考

> [返回索引](index.md)

> 2026-08-31 新增（用户本地 git 仓库，浅克隆），已接入 C15 更新面板（main 分支）。按"新增参考项目 SOP"填导航卡。

- **定位**：LangChain 官方 JS 框架。学**新一代 agent 框架（ReactAgent + middleware 中间件体系）**与**工具/模型/记忆生态**——我们"工具与协议"层的对照参考。
- **组织哲学**：pnpm monorepo。`libs/` 下包按职责分：`langchain`（新 agent 框架）/ `langchain-core`（抽象）/ `langchain-classic`（旧版 AgentExecutor/memory）/ `langchain-mcp-adapters`（MCP 工具适配）/ `providers/`（31 个模型/向量库/工具源包）。

## 目录结构（只列核心）

```
langchainjs/
├─ libs/
│  ├─ langchain/src/agents/     ← 新 agent 框架（123 文件）
│  │  ├─ ReactAgent.ts          ← 主 agent 类（React 循环）
│  │  ├─ middleware/            ← ~20 个中间件（hitl/pii/summarization/重试/todoList…）
│  │  ├─ nodes/                 ← AgentNode / ToolNode / Before/After 节点
│  │  └─ transformers/          ← subagent / tool-call 转换
│  ├─ langchain-core/src/       ← 抽象：runnables/ / tools/ / messages/ / language_models/
│  ├─ langchain-classic/src/    ← 旧版：agents/executor.ts + memory/
│  └─ providers/                ← 31 个模型/向量库/工具源包
└─ examples/src/                ← 可运行示例（createAgent / multi-agent）
```

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | agent loop（新框架 ReactAgent） | `libs/langchain/src/agents/ReactAgent.ts` + `nodes/` | 未读 |
| **L** 生命周期 | 中间件体系（HITL/重试/子任务/限流/todoList） | `libs/langchain/src/agents/middleware/` | 未读 |
| **L** 生命周期 | subagent / tool-call 转换（run 流 stream transformer，createSubagentTransformer/createToolCallTransformer） | `libs/langchain/src/agents/transformers/`（subagent.ts/tool-call.ts） | 未读 |
| **L** 生命周期 | agent loop（旧版经典） | `libs/langchain-classic/src/agents/executor.ts` | 未读 |
| **T** 工具 | 工具接口 / 工具注册 | `libs/langchain-core/src/tools/` + `libs/langchain-mcp-adapters/` | 未读 |
| **C** 上下文 | 记忆（旧版） | `libs/langchain-classic/src/memory/` | 未读 |
| 附加 | 模型接入（provider 包） | `libs/langchain-core/src/language_models/` + `libs/providers/langchain-*` | 未读 |
| 附加 | runnable/流式原语 | `libs/langchain-core/src/runnables/` | 未读 |
| 附加 | 可运行示例 | `examples/src/createAgent/`、`examples/src/multi-agent/` | 未读 |

> **E/O/V/G 层**：langchainjs 是**框架层**不是 harness——执行环境（E）、可观测（O）、验证（V）、治理（G）不在这里（由消费它的应用负责），按七层逐项核对后**明说无此项**，不硬凑。

## 搜索配方

- **语言**：TypeScript（pnpm + turbo）。
- **⚠️ langgraph 不在本仓库**：`@langchain/langgraph` 等只是外部 npm 依赖——想学 agent 编排/图/持久化**读这里会落空**，去 LangGraph.js 官方文档。
- **grep 示例**：agent 中间件 `grep -rn "middleware" libs/langchain/src/agents/`。
- **注意**：`docs/core_docs/` 是未初始化的 git submodule（只有 README 占位），本地无架构文档，架构方向看根 README 与 `libs/langchain/README.md`。
