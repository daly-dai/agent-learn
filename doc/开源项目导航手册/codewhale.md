# CodeWhale —— Rust 审批 / hooks 对照

> [返回索引](index.md)

- **定位**：Rust crate 化 agent。学审批四档、approval_log、todo_snapshot、session_resume。
- **组织哲学**：crate 名即功能名，进 `crates/<名>/src/`。

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **G** 治理 | 审批四档 / approval_log | `crates/execpolicy/` | ✅ 走读 06（审批）/ 14（对照 hooks） |
| **L** 生命周期 | agent 循环 | `crates/agent/` | 未精读 |
| **L** 生命周期 | workflow 编排（workflow/ = IR+校验；workflow-js/ = QuickJS 沙箱运行 JS 编排程序） | `crates/workflow/`（fleet_*/gates/elevation）+ `crates/workflow-js/` | 未精读 |
| **C** 上下文 | 状态 / session_resume（SQLite + session_index.jsonl，SessionSource） | `crates/state/` | 未精读 |
| **L** 生命周期 | workflow 实例运行后端（lane：tmux/inline/vm/ci 运行时） | `crates/lane/`（runtime + registry） | 未精读 |
| **T** 工具 | 工具系统 | `crates/tools/` + `crates/mcp/` | 未精读 |
| **O** 可观测 | telemetry | `crates/telemetry/` | 未精读 |
| **E** 执行 | 命令契约 / dispatch 形状（FEAT-014 原型，**不实现执行**；真实分发在 tui + core） | `crates/command-contract/`（facets/handler/metadata/types） | 未精读 |
| 附加 | hooks / TUI / CLI / 配置 / 密钥 | `crates/{hooks,tui,cli,config,secrets}/` | ✅ 走读 14（hooks） |

- **搜索**：crate 名即功能名，进 `crates/<名>/src/`。
- **已读**：✅ 走读 06/14（对照过审批与 hooks 思想）。
