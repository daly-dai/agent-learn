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

## 最新动向（2026-09-14 侦察：617 commits / 09-01 → 09-14）

> 比静态结构更能说明**工业界这半个月把力气花在哪**。以后用 `/repos` 页面重跑。
> 按触及文件数排序：`tui` 2304 / `core` 1494 / **`app-server` 系列 ~1010** / `ext` 275 / **`exec-server` 127** / **`guardian-context` 119** / **Windows 沙箱 ~200**（`windows-sandbox-rs` 110 + `windows-sandbox-service` 57 + `mxc-sandbox` 35）/ **`network-proxy` 108** / `thread-store` 104 / `codex-mcp` 89 + `rmcp-client` 84。

### ⭐ 1. 网络策略沙箱 —— 我们最大的真空

`codex-rs/network-proxy/`（**README 写得很完整，是企业 agent 治理的教科书**）

- 本地 HTTP 代理（默认 `127.0.0.1:3128`）+ SOCKS5（`8081`），按域名白名单放行
- 域名模式：`*.example.com`（仅子域）/ `**.example.com`（含 apex）；全局 `*` 被拒
- **"limited" 模式 = 只读网络**（只放 GET/HEAD/OPTIONS），靠 HTTPS MITM 强制方法策略
- **内网保护**：`allow_local_binding=false` 时禁 loopback / 私网，防 DNS rebinding（README 诚实标注"低层还得靠防火墙"）
- ⭐ **exec-policy → network 联动**：`NetworkPolicyDecider` 收到 `command` + `exec_policy_hint`——用户批准过 `curl *`，同源网络请求就自动放行
- **审计**：每个决策发 OTEL 事件 `codex.network_proxy.policy_decision`，**故意不记完整 URL / query**
- 两条原则：**deny 永远赢过 allow**；**没有 allow 条目时默认全拒**（fail-closed）

### ⭐ 2. Windows 沙箱 —— 我们在 Windows 上开发，唯一可用的工程参考

| 位置 | 是什么 |
|---|---|
| `codex-rs/mxc-sandbox/` | 走 Microsoft **MXC `BaseContainerRunner`**（需 Windows PSEC）；不碰 AppContainer / 不改 host ACL / 不提权 |
| `codex-rs/windows-sandbox-rs/` | 原有 Windows 沙箱后端（带 `sandbox_smoketests.py`） |
| `codex-rs/windows-sandbox-service/` | 沙箱服务形态 |

**两个和我们踩过同一类坑的地方**：

- **Windows 命令行长度上限** → MXC 适配器改用 **env chunk 传参**（每块 ≤4096 字节、payload ≤1MB），helper 创建进程前移除。我们 `bash-runner` 的 `cmd /c "chcp 65001 & pwsh -EncodedCommand <base64>"` 是**同一问题的另一种解法**——可以对照着讲。
- 明确要求**同时测 `powershell.exe` 和 `pwsh.exe`**，不能只测 `cmd.exe`。

### 3. 远程执行主机（exec-server）—— 我们完全没有

`codex-rs/exec-server/` + `exec-server-protocol`（JSON-RPC over WebSocket）

- 进程 RPC：`process/start` / `read`（`afterSeq` 游标 + 长轮询）/ `write` / `terminate`，输出按 `seq` 流式
- 文件 RPC：`fs/readFile` / `open`+`readBlock`+`close` / `writeFile` / …，每个请求可带 `sandbox` 策略对象
- `process/exited` 带 **`sandboxDenied`** —— 让流式客户端不必再发一次 `process/read` 就能拿到沙箱拒绝信息
- 远程模式：注册到 environment registry + **Noise relay**，按 `stream_id` 多路复用，**断线可 resume**

### 4. Guardian：LLM 审批评审 —— 我们只做了静态分析

`codex-rs/core/src/guardian/` + `codex-rs/guardian-context/`

- 文件即架构：`approval_request` / `decision` / `review` / `review_session` / `reviewer_config` / **`input_budget`** / **`request_budget`** / `coverage` / `feedback` / `prompt`
- 关键认知：**审批不只是"规则匹配"，还可以是"有预算管理的 LLM 评审会话"**
- 上下文装配单独成 crate（`guardian-context`：transcript 收集 + truncation，同步审查与异步评分共用）

### 5. 服务端形态（app-server 系列 ~1010 touches）

`codex-rs/app-server/` + `-protocol` + `-transport` + `-daemon`

> **正对我们已知的缺口**：PLAN 里 B22 衍生未来项"刷新后重连正在跑的 run"要求 **run 脱离 HTTP POST 生命周期**——app-server 就是这个问题的工业解。**记录，不排期。**

### 6. 其他值得知道的

| 位置 | 是什么 | 我方对照 |
|---|---|---|
| `codex-rs/ext/` + `core-plugins/` | **外部扩展 / 插件体系** | 我们的 B5 是**内部** hooks，层次不同（不必抄） |
| `codex-rs/code-mode/` + `-host` + `-protocol` + `-runtime` | **Code Mode**（整块子系统，4 个 crate） | 对应我们砍掉的 C9 代码执行器——看一眼再决定 |
| `codex-rs/shell-escalation/` | **提权协议**：沙箱内 `execve` 被拦截 → 服务端答 `Run` / `Escalate` / `Deny`（提权 = 到沙箱外跑） | 审批→提权是另一条路 |
| `codex-rs/worktree/` | git worktree 做**物理**会话隔离 | 我们是逻辑多会话（B22） |
| `codex-rs/otel/` + `analytics/` | OTel 遥测标准 | 我们是本地 jsonl 轨迹 |
| `codex-rs/agent-graph-store/` `agent-identity/` `agent-roles/` | 多 agent / 身份 / 角色 | 对应 C3 子智能体 |

> **明确不抄**：`cloud-tasks`（云端任务）、`voice-host` + `realtime-webrtc`（语音）、`secrets` / `keyring-store` / `aws-auth` / `workload-identity`（企业身份密钥基础设施）——**我们不需要企业身份体系**。

---

## 搜索配方

- **语言**：Rust。**只看结构不看实现语法**。
- **找功能**：crate 名即功能名（`execpolicy` = 审批），进 crate 后看 `src/` 下文件名。
- **grep 示例**：`grep -rn "roll_over\|TokenBudget" codex-rs/core/src/`。
- **注意**：Bazel 工程，顶层文件多（`.bzl`），搜索直接进 `codex-rs/` 目录。
