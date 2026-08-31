# codex —— 工业毕业形态（Rust）

> [返回索引](index.md)

**定位**：OpenAI Codex CLI，Bazel + Rust workspace（`codex-rs/` 下 100+ crates）。学**工业级工程形态**：审批引擎、沙箱、rollout 记录。
**组织哲学**：一能力一 crate（`execpolicy` / `sandboxing` / `rollout` / `skills` / `hooks` / `memories`…），核心在 `core` crate。**读结构不读语法**：重点看模块怎么切、接口怎么定。

## 目录结构（codex-rs/ 下挑核心 crate）

```
E:\agents-read\codex\codex-rs\
├─ core/                ← 核心 crate（agent 循环 + 会话 + 工具编排）
│  └─ src/
│     ├─ agent/  session/  state/  tasks/        ← 循环/会话/状态/任务
│     ├─ compact.rs  rollout.rs  shell.rs         ← 压缩 / 轨迹 / 终端（顶层扁平）
│     ├─ exec_policy/  sandboxing/  guardian/     ← 审批 / 沙箱 / 守护
│     ├─ tools/  mcp_tool_call/                   ← 工具 / MCP
│     └─ skills.rs  agents_md.rs  web_search.rs
├─ execpolicy/          ← 独立 crate：策略引擎（policy/rule/parser/decision/amend）
├─ sandboxing/  linux-sandbox/  windows-sandbox-rs/  ← 沙箱三件套
├─ rollout/  rollout-trace/  ← 工业级轨迹记录与压缩
├─ skills/  hooks/  memories/  ← 扩展机制
├─ tools/               ← 独立 crate：tool_call / tool_definition / tool_search / mcp_tool
├─ app-server/  cli/  tui/
└─ state/  thread-store/  history/
```

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **G** 治理 | 执行策略引擎（审批规则化/决策/改写） | `codex-rs/execpolicy/src/{policy,rule,parser,decision,amend}.rs` | ✅ 走读 06 |
| **G** 治理 | Guardian 审批决策（approval_request/review，GuardianReviewDecision） | `codex-rs/core/src/guardian/`（approval_request.rs/review.rs/review_session.rs） | 未精读 |
| **G** 治理 | 进程加固（禁 core dump / 禁 ptrace / 清 LD_PRELOAD） | `codex-rs/process-hardening/src/lib.rs` | 未精读 |
| **E** 执行 | OS 级沙箱（bwrap/AppContainer/Seatbelt） | `codex-rs/{sandboxing,linux-sandbox,windows-sandbox-rs}/` | ✅ 走读 08 |
| **O** 可观测 | rollout 记录与压缩（产品会话记录持久化） | `codex-rs/rollout/`（lib/recorder/compression） | ✅ 走读 11 |
| **O** 可观测 | rollout-trace：本地调试轨迹（**not telemetry**，opt-in，`CODEX_ROLLOUT_TRACE_ROOT` 开启；原始事件 bundle + 离线 reducer `codex debug trace-reduce` 归约语义图） | `codex-rs/rollout-trace/`（writer/reducer/bundle） | 未精读 |
| **T** 工具 | 工具 crate（tool_call/tool_definition/tool_search/mcp_tool） | `codex-rs/tools/` + `core/src/tools/` | ✅ 走读 16 |
| **L** 生命周期 | 循环 + 会话 + 任务 | `codex-rs/core/src/{agent,session,state,tasks}/` | ✅ 走读 16 |
| **C** 上下文 | 压缩（tasks/compact.rs + auto_compact_window） | `codex-rs/core/src/{compact.rs, tasks/compact.rs, session/turn.rs}` | 走读 24 补充 |
| **C** 上下文 | 记忆（memories crate：read 注入/引用 + write 两阶段提取整合） | `codex-rs/memories/`（read/ + write/） | ✅ 走读 14 |
| **C** 上下文 | Guardian 审批的上下文证据装配（transcript 收集/truncation，同步审查+异步评分共用） | `codex-rs/guardian-context/src/{transcript,truncation,entry}.rs` | 未精读 |
| 附加 | 扩展机制（skills / hooks） | `codex-rs/{skills,hooks}/` | ✅ 走读 14 |
| 附加 | 斜杠命令（slash_input / parse_slash_name） | `codex-rs/tui/src/bottom_pane/slash_input.rs` | C13 详案已读 |
| 附加 | @文件匹配（mention / fuzzy_file_search） | `codex-rs/core/src/mention_syntax.rs` + `file-search/` | C14 详案已读 |

> **V 验证层**：约 140 个 crate，**无独立 eval crate**（有测试基建 `codex-test-binary-support`）；测试模式 = 内联 `*_tests.rs` 单测为主（88 crate）+ 35 crate 带 `tests/` 集成目录（core/tests、cli/tests、tools/tests 等），约 21 个 crate 无测试——工业形态用"每 crate 自带测试"。

## 搜索配方

- **语言**：Rust。**只看结构不看实现语法**。
- **找功能**：crate 名即功能名（`execpolicy` = 审批），进 crate 后看 `src/` 下文件名。
- **grep 示例**：`grep -rn "roll_over\|TokenBudget" codex-rs/core/src/`。
- **注意**：Bazel 工程，顶层文件多（`.bzl`），搜索直接进 `codex-rs/` 目录。
