# opencode —— 终端 Agent 完整实现参考

> [返回索引](index.md)

> 2026-08-31 新增（用户本地 git 仓库，浅克隆），已接入 C15 更新面板（**dev 分支**）。按"新增参考项目 SOP"填导航卡。

- **定位**：opencode（原 anomalyco，终端 AI 编码 agent）。学**完整产品级 agent**：agent loop / session / 审批 / 模型 provider 分层——比 pi 更"工业产品"、比 codex 更贴近我们（同为 TS）。
- **组织哲学**：Bun + Turborepo monorepo。**核心分两层**：`packages/opencode`（CLI + agent 编排层，agent loop 在 `src/agent/agent.ts`）+ `packages/core`（底层 "Session Runtime" 引擎，`src/session/`）。`packages/llm`（LLM 协议）/ `packages/protocol`（HttpApi）/ `packages/server`（HTTP）。

## ⚠️ 2026-09-14 订正：工具层有**两套并存的完整实现**

**本卡原来只写了 `packages/opencode/src/tool/`。这就是 A5 复核四家 web 能力时把 opencode 漏在对照之外的原因**（详见 `doc/plan/a5-web-search.md` §7.14.5 / §7.15）。查工具必须两边都看：

| | `packages/opencode/src/tool/` | `packages/core/src/tool/` |
|---|---|---|
| 文件数 | **40** | **20** |
| 形态 | `X.ts` 实现 + **`X.txt` 描述文件**成对（工具描述外置成 txt） | `Tool.make({ description, input, output, execute, toModelOutput })`——应用工具与内置工具**同一个类型** |
| 架构文档 | — | ⭐ **`AGENTS.md`（59 行）**：representations / construction / registration / permissions / output / **current gaps** 六节，是读工具的入口 |
| `webfetch.ts` | **192 行** | **218 行** |
| `websearch.ts` | **143 行** | **260 行** |
| 独有 | `task.ts`（子智能体）/ `lsp.ts` / `truncate.ts` / `truncation-dir.ts` | `http-body.ts` / `builtins.ts` / `application-tools.ts` / `registry.ts` |

`core/src/tool/AGENTS.md` 自称 **V2 core**，但**哪套是当前主线未核**（两边功能集不同、都完整）。**先读 core 的 `AGENTS.md`**——它是唯一一份把工具子系统讲清楚的文档。

## 目录结构（只列核心）

```
opencode/
├─ packages/
│  ├─ opencode/src/            ← CLI + agent 编排层
│  │  ├─ agent/agent.ts        ← agent loop（@opencode/Agent Service）
│  │  ├─ session/              ← session.ts / processor.ts / llm.ts / compaction.ts
│  │  ├─ tool/                 ← 40 文件：X.ts 实现 + X.txt 描述成对
│  │  ├─ provider/             ← 模型适配
│  │  └─ permission/evaluate.ts← 审批
│  ├─ core/src/                ← Session Runtime 引擎（底层）
│  │  ├─ session/              ← run-coordinator / execution / projector / context-epoch / store / sql
│  │  ├─ tool/                 ← ⭐ 20 文件 + AGENTS.md：V2 工具子系统（webfetch / websearch / http-body）
│  │  ├─ tool-output-store.ts  ← ⭐ 工具输出超限落盘（2000 行 / 50KB / 保留 7 天）
│  │  └─ permission/ + permission.ts ← ⭐ 审批（V2；webfetch/websearch 用的是这里的 PermissionV2）
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
| **T** 工具 | 工具子系统架构（**读工具的入口**） | `packages/core/src/tool/AGENTS.md` | ✅ 已读 |
| **T** 工具 | 工具实现 + 注册（**两套并存，都要看**） | `packages/core/src/tool/` ⬅ V2 ／ `packages/opencode/src/tool/` | 部分已读 |
| **T** 工具 | **抓网页**（web 侧 T 层参考） | `packages/core/src/tool/webfetch.ts`（218 行）＋ `packages/opencode/src/tool/webfetch.ts`（192 行） | ✅ 已读（core 那份） |
| **T** 工具 | **本地联网搜索**（走 MCP 调 Exa / Parallel） | `packages/core/src/tool/websearch.ts`（260 行）＋ `packages/opencode/src/tool/websearch.ts`（143 行） | ✅ 已读（core 那份） |
| **T** 工具 | HTTP body 有界收集（先看 `content-length`，超限**抛错**） | `packages/core/src/tool/http-body.ts`（30 行） | ✅ 已读 |
| **T** 工具 | ⭐ **工具输出超限落盘 + 可回读**（`outputPaths` 回给模型） | `packages/core/src/tool-output-store.ts`（211 行） | ✅ 已读（头部） |
| **G** 治理 | 审批（**两处都有，主次未核**） | `packages/opencode/src/permission/evaluate.ts` ／ `packages/core/src/permission/` + `permission.ts` | 未读 |
| 附加 | 模型 provider 适配 | `packages/opencode/src/provider/` + `packages/llm/` | 未读 |
| 附加 | 官方文档 | `packages/docs/`（MDX） | 未读 |
| 附加 | **子智能体** | `packages/opencode/src/tool/task.ts` + `task.txt` | 未读（C3 时可看） |

> **E/O/V 层**：E（执行）在 `packages/core/src/session/execution/`（目录仅 local.ts，主体在 session/runner + run-coordinator）；O（可观测）未定位到 agent 侧遥测组件（`packages/http-recorder/` 是**测试录制回放** cassettes，归 V）；V（验证）见 `packages/http-recorder/`（record/replay cassettes）——已打开文件确认。`packages/stats/` 是**独立公开统计网站**（SolidStart 站点 + ingest API，类似 opencode.ai/stats），非 agent 侧组件，不列入映射。

## ⭐ 工具层已读结论（引用这些，不要重读）

- **`core/src/tool/AGENTS.md` 的硬约束**（原文禁止项）：*"Do not add a second executable entry type, registry-owned executor, authorization callback, output-path callback, or legacy normalization path."* —— **只允许一条执行入口**，注册表不拥有执行器。
- ⭐ **一条精确的区分**：*"Definition filtering is catalog visibility, not execution authorization."* —— 把工具从模型可见的清单里滤掉 ≠ 阻止它执行；**"模型看不见"和"拦住了"是两件事**。
- ⭐ **两套限额是分开的**（对我们直接有用）：*"Producer capture limits are separate."* —— 生产者捕获上限（如 bash 的 `maxOutputBytes`，要如实报告丢了多少）vs **模型输出上限 + 托管落盘（只在这一层做截断、只在这一层产生 `outputPath`）**。我们目前是**一个 `maxOutputChars` 管到底**。
- **输出有界 + 落盘**：`tool-output-store.ts` —— `MAX_LINES = 2000` / `MAX_BYTES = 50KB` / `RETENTION = 7 天`，目录 `tool-output`，**把 `outputPaths` 回给模型**（超限不是"丢掉"，是"留一份、给路径"）。
- **`websearch.ts` 的关键事实**（详见 A5 详案 §7.15）：
  - 它是**本地工具**，走 **MCP** 调 `mcp.exa.ai/mcp` 或 `search.parallel.ai/mcp`；文件头明确写它与 **provider 托管的搜索是两条路**。
  - ⭐ 它的**工具描述里塞了当前年份**：`The current year is ${new Date().getFullYear()}.` —— 但那是**模块顶层求值**（`export const description`），**长跑进程会拿到过期年份**；我们放在**每次请求现取**，是更稳的那个。
  - `NO_RESULTS` 明写"没找到，换个查询词"——**独立印证了我们"绝不返回空字符串"**。
  - 返回**一整段 text**（"给模型的上下文串"交给后端，`contextMaxCharacters` 控制），不像我们**自己解析来源列表 + round-robin + 排版**。
  - `selectProvider` 用 `checksum(sessionID) % 2` **按会话哈希分流** Exa / Parallel。
  - 搜索也要 `permission.assert` 弹框 → 再次印证它的安全模型是「**人批准**」。

## 搜索配方

- **语言**：TypeScript（Bun + turbo）。
- **找功能**：先读根 `CONTEXT.md`（术语表，读引擎前必看）；`packages/opencode/src/` 按目录名定位（tool/session/provider/permission）。
- **⚠️ 找工具**：**两处都要看**——先读 `packages/core/src/tool/AGENTS.md`，再按工具名在 `core/src/tool/` 和 `opencode/src/tool/` **各开一次**（两边同名文件都完整，内容不同：core 的更长、opencode 的带 `.txt` 描述）。
- **grep 示例**：审批 `grep -rn "permission\|approve" packages/core/src/permission*`；工具 `ls packages/core/src/tool/ packages/opencode/src/tool/`。
- **注意**：`packages/core` 是底层引擎（多与数据库/sql 打交道），**一般**产品逻辑优先看 `packages/opencode`——**但工具是例外**：core 侧是 V2 主线、且只有它带架构文档。
