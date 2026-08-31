# deepseek-harness（DSH）—— 功能全景 / 插件化

> [返回索引](index.md)

**定位**：我正在运行的 harness（DeepSeek Harness），50+ 包 = 完整功能目录。学**功能清单**（todo/hooks/skill/schedule/sandbox…）与**插件化组织**。
**组织哲学**：一能力一包（`packages/core/agent-loop`、`packages/todo`、`packages/hooks`…），**cordis DI + slot 注册**；能力 seam 三件套（Definition/Provider/Consumer）。**官方文档是中文的，且质量极高——优先读文档再读代码**。

## 目录结构（50 包只列我们用到的）

```
E:\agents-read\deepseek-harness\
├─ docs/                         ← ★ 官方中文文档（先读这里！）
│  ├─ architecture.zh.md         ← 架构总览
│  ├─ capability-seams.zh.md     ← seam 三件套
│  ├─ tool-catalog.zh.md  tool-execution-pipeline.zh.md
│  ├─ config-catalog.zh.md  persistence-catalog.zh.md  module-graph.zh.md
│  └─ subsystems/  cookbook/  user/
├─ packages/
│  ├─ core/
│  │  ├─ agent-loop/src/         ← 引擎循环：agent.ts / runtime-context.ts / tool-calls.ts
│  │  ├─ session/src/            ← 会话内核：surface.ts / chunk-rows.ts / preparation.ts / repair.ts
│  │  └─ tools/                  ← 工具注册
│  ├─ compaction/                ← 压缩四包：compaction / compaction-basic / tool-result-pruner / command-compact
│  ├─ session/                   ← 持久化族：session-persistence-jsonl / session-projection / session-title-*
│  ├─ todo/  hooks/  skill/  subagent/  sandbox/  shell/  schedule/  goal/  plan/  jobs/
│  ├─ llm/  mcp/  settings/  credentials/  guard/  context/
│  └─ client/                    ← 前端（ui-primitives 原语库 + ui-conversation + ui-layout + ui-sidebar…）
└─ apps/  examples/  scripts/
```

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | 引擎循环 | `packages/core/agent-loop/src/agent.ts` | ✅ 走读 09（架构）/ 24（压缩） |
| **L** 生命周期 | todo（任务面板） | `packages/todo/` | ✅ 走读 07 |
| **L** 生命周期 | subagent（8 种实现） | `packages/subagent/` | ✅ 走读 10 |
| **L** 生命周期 | schedule / goal / plan / jobs | `packages/{schedule,goal,plan,jobs}/` | 未精读（C 阶段用） |
| **L** 生命周期 | 循环卫生护栏（repeat-tool-reminder 重复工具提醒 + timeout-policy 工具超时） | `packages/guard/{repeat-tool-reminder,timeout-policy}/` | 未精读 |
| **L** 生命周期 | workflow：多 agent 扇出编排（workflow + ralph 工具 + worker-thread） | `packages/workflow/`（workflow/workflow-worker-thread/tool-workflow/tool-ralph） | 未精读 |
| **C** 上下文 | 会话架构（session/log/surface 三件套） | `packages/core/session/src/{surface,chunk-rows,preparation,repair}.ts` | ✅ 走读 07/09/24 |
| **C** 上下文 | 压缩系统（触发/选区/事务/总结/剪枝） | `packages/compaction/{compaction,compaction-basic,tool-result-pruner}/` | ✅ 走读 24 |
| **E** 执行 | sandbox + shell + terminal + subprocess | `packages/{sandbox,shell,terminal,subprocess}/` | ✅ 走读 17（sandbox+shell） |
| **T** 工具 | 工具注册 + MCP | `packages/core/tools/` + `packages/mcp/` | 未精读 |
| **V** 验证 | runtime-diagnostics：运行时自检 invariants（验证包数据关系不变量） | `packages/runtime-diagnostics/invariants/` | 未精读 |
| **V** 验证 | test-support（测试支持：agent-loop-testkit / llm-mock-server / session-snapshot） | `packages/test-support/` | 未精读 |
| 附加 | hooks 注册表 | `packages/hooks/` | ✅ 走读 13 |
| 附加 | skill（目录常驻 + 正文按需） | `packages/skill/` | ✅ 走读 15 |
| 附加 | feedback：人类反馈采集（/feedback 会话评价 + message-feedback 逐消息评分，**非遥测**） | `packages/feedback/{command-feedback,message-feedback}/` | 未精读 |
| 附加 | 前端原语库（UI） | `packages/client/ui-primitives/` + `ui-layout/` 等 | ✅ 走读 18（部分） |

## 搜索配方

- **语言**：TypeScript。**文档优先**：`docs/*.zh.md` 是中文且高质量，先读文档定位再读代码。
- **找功能**：包名即功能名（`todo` = 任务面板），直接进 `packages/<名>/src/`。
- **grep 示例**：`grep -rn "toolPairingBalanced\|compactRegion" packages/compaction/`（排除 node_modules）。
- **注意**：50 包目录**不要全列**，按功能名进对应包；搜索时务必排除 `node_modules`。
