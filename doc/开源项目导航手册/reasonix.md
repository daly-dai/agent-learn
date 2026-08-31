# Reasonix —— 前端 UI / 交互设计（Go + Wails + React）

> [返回索引](index.md)

**定位**：DeepSeek Reasonix。Go 后端（`internal/` 93 包）+ Wails 桌面前端。**UI 方面是主参考**（面板、审批卡、任务面板、记忆设计）。
**组织哲学**：后端一概念一包（`permission` / `shellsafe` / `memory` / `trajectory`…）；前端 `desktop/frontend/` React。

## 目录结构（UI 详细 + 后端简）

```
E:\agents-read\DeepSeek-Reasonix-main-v2\
├─ desktop/frontend/          ← ★ UI 主战场
│  └─ src/
│     ├─ components/editors/  ← 代码编辑器组件（HljsCode/HljsDiff/LineNumberCode/codeSearch）
│     ├─ components/  custom/  lib/  store/  locales/  __tests__/  test-support/
├─ internal/                  ← Go 后端（93 包，按需进）
│  ├─ agent/                  ← 引擎（run_loop.go / execution_engine.go / session.go / compact.go / subagent_*）
│  ├─ permission/  shellsafe/  shellparse/  shellrun/  guardian/  runtimepolicy/  ← 审批 + 终端安全
│  ├─ memory/  trajectory/  telemetry/  event/  crashreport/   ← 记忆 / 观测
│  ├─ sandbox/  environment/  ← 执行环境
│  ├─ skill/  hook/  taskcatalog/  taskmonitor/  goaleval/  jobs/
└─ cmd/  sdk/  docs/
```

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | 引擎（run_loop / execution_engine / session） | `internal/agent/`（run_loop.go / execution_engine.go / session.go / compact.go / subagent_*） | 走读 18 部分 |
| **L** 生命周期 | 任务面板 / todo 交互 | `internal/taskcatalog/` + `taskmonitor/` + 前端 | ✅ 走读 18（Phase 5 已抄） |
| **L** 生命周期 | goal 评估 | `internal/goaleval/` | C10/C11 排队 |
| **C** 上下文 | 记忆分层设计 | `internal/memory/` + `retrieval/` | ✅ 走读 14/18（B6 排队） |
| **C** 上下文 | 会话目录 / 对账（catalog/lineage/reconcile） | `internal/sessioncatalog/` | 未精读 |
| **C** 上下文 | 会话指令队列（前端投递 steering；仅 RecoverOrphanedInFlight 带崩溃恢复） | `internal/sessioninbox/`（store/disk/ops） | 未精读 |
| **E** 执行 | 沙箱 + 终端执行 | `internal/sandbox/` + `internal/shellrun/` | 未精读 |
| **G** 治理 | 审批智能（静态分析只读放行） | `internal/shellsafe/` + `internal/permission/` | ✅ 走读 18（B1 已抄） |
| **G** 治理 | guardian：LLM 安全评审器（guardian.go/policy）+ runtimepolicy：运行时约束/守卫（constraints/guards） | `internal/guardian/` + `internal/runtimepolicy/` | 未精读 |
| **O** 可观测 | 轨迹 / 遥测 / 事件流（event = 类型化事件 + Sink，agent→前端渲染协议） | `internal/trajectory/` + `internal/telemetry/` + `internal/event/` + `internal/crashreport/` | 未精读 |
| **V** 验证 | 测试环境辅助（testenv：测试家目录设置） | `internal/testenv/home.go` + 前端 `test-support/` + `__tests__/` | 未精读 |
| 附加 | 产品端面板（tether + Reasonix 对照） | `desktop/frontend/src/` 全局 | ✅ 走读 18 |
| 附加 | 代码高亮 / diff 组件 | `desktop/frontend/src/components/editors/` | 未精读 |

## 搜索配方

- **语言**：Go 后端 + React 前端。**后端**：包名即概念（`shellsafe` = 终端安全），进 `internal/<名>/`。
- **前端**：组件在 `desktop/frontend/src/components/`，逻辑在 `store/` 与 `lib/`。
- **grep 示例**：后端 `grep -rn "ReadOnly\|isReadOnly" internal/shellsafe/`；前端 `grep -rn "TaskPanel\|todo" desktop/frontend/src/`。
- **注意**：`internal/agent/` 有 370 个文件（大量测试），**只看非 `_test.go` 文件**，按文件名猜职责（`compact.go` = 压缩）。
