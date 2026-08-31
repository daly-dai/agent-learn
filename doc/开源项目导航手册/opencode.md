# opencode —— 终端 Agent 完整实现参考

> [返回索引](index.md)

> 2026-08-31 新增（用户本地 git 仓库，浅克隆），已接入 C15 更新面板（**dev 分支**）。按"新增参考项目 SOP"填导航卡。

- **定位**：opencode（原 anomalyco，终端 AI 编码 agent）。学**完整产品级 agent**：agent loop / session / 审批 / 模型 provider 分层——比 pi 更"工业产品"、比 codex 更贴近我们（同为 TS）。
- **组织哲学**：Bun + Turborepo monorepo。**核心分两层**：`packages/opencode`（CLI + agent 编排层，agent loop 在 `src/agent/agent.ts`）+ `packages/core`（底层 "Session Runtime" 引擎，`src/session/`）。`packages/llm`（LLM 协议）/ `packages/protocol`（HttpApi）/ `packages/server`（HTTP）。

## 目录结构（只列核心）

```
opencode/
├─ packages/
│  ├─ opencode/src/            ← CLI + agent 编排层
│  │  ├─ agent/agent.ts        ← agent loop（@opencode/Agent Service）
│  │  ├─ session/              ← session.ts / processor.ts / llm.ts / compaction.ts
│  │  ├─ tool/                 ← 每工具一文件 + registry.ts
│  │  ├─ provider/             ← 模型适配
│  │  └─ permission/evaluate.ts← 审批
│  ├─ core/src/                ← Session Runtime 引擎（底层）
│  │  ├─ session/              ← run-coordinator / execution / projector / context-epoch / store / sql
│  │  └─ tool/ + database/
│  ├─ llm/  protocol/  server/ ← LLM 协议 / HttpApi / HTTP
│  └─ docs/                    ← MDX 官方文档
└─ CONTEXT.md                  ← ★ 领域词汇表（读引擎前必看）
```

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | agent loop | `packages/opencode/src/agent/agent.ts` | 未读 |
| **C** 上下文 | 会话 / 压缩 | `packages/opencode/src/session/`（session/processor/llm/compaction） | 未读 |
| **C** 上下文 | Session Runtime 引擎（run-coordinator/context-epoch） | `packages/core/src/session/` | 未读 |
| **T** 工具 | 工具注册 | `packages/opencode/src/tool/`（每工具一文件 + registry.ts） | 未读 |
| **G** 治理 | 审批 | `packages/opencode/src/permission/evaluate.ts` | 未读 |
| 附加 | 模型 provider 适配 | `packages/opencode/src/provider/` + `packages/llm/` | 未读 |
| 附加 | 官方文档 | `packages/docs/`（MDX） | 未读 |

> **E/O/V 层**：E（执行）在 `packages/core/src/session/execution/`（目录仅 local.ts，主体在 session/runner + run-coordinator）；O（可观测）未定位到 agent 侧遥测组件（`packages/http-recorder/` 是**测试录制回放** cassettes，归 V）；V（验证）见 `packages/http-recorder/`（record/replay cassettes）——已打开文件确认。`packages/stats/` 是**独立公开统计网站**（SolidStart 站点 + ingest API，类似 opencode.ai/stats），非 agent 侧组件，不列入映射。

## 搜索配方

- **语言**：TypeScript（Bun + turbo）。
- **找功能**：先读根 `CONTEXT.md`（术语表，读引擎前必看）；`packages/opencode/src/` 按目录名定位（tool/session/provider/permission）。
- **grep 示例**：审批 `grep -rn "permission\|approve" packages/opencode/src/permission/`；工具 `ls packages/opencode/src/tool/`。
- **注意**：`packages/core` 是底层引擎（多与数据库/sql 打交道），产品逻辑优先看 `packages/opencode`；主分支是 `dev`（非 main）。
