# pi —— 主参考（我们 = pi 思想的 Next.js 重写）

> [返回索引](index.md)

- **锚点（写死，别漂）**：本地检出 `E:\agents-read\pi`，commit `890f920884f6d21fc7617d236ef9e1cc5d7a0ef8`（2026-09-21），各包 `version` = `0.86.1`。**本文所有路径/行号绑定这一版。**
- **定位**：本项目架构的源头。monorepo 分包，TypeScript。学它的**分层纪律**与**教学可读性**。
- **组织哲学**：`packages/` **按职责分包，包名即功能名**——想找什么功能直接进同名包。内核（`agent`）与产品（`coding-agent`）是**两个独立的包**，产品层通过公开 API 组合内核，不 fork 内核。

> ⭐ **要梳理「基于 pi 核心包开发的业务 agent」，先看附件 [pi-接缝清单.md](pi-接缝清单.md)**——三层接缝（循环内核 / 会话内核 / 产品层）+ 真实 `file:line` + 对照作业单。那份回答"**从哪入手**"，本文回答"**pi 里有什么、在哪**"。

## 一、`packages/` 下 12 个条目各是什么（11 个包 + 1 个分组目录；描述是包自己的 `description` 原文）

| 包 | name | 定位 | 我们关心吗 |
|---|---|---|---|
| `agent` | `@earendil-works/pi-agent-core` | General-purpose agent with transport abstraction, state management, and attachment support | ⭐ **内核**，主参考 |
| `coding-agent` | `@earendil-works/pi-coding-agent` | Coding agent CLI with read, bash, edit, write tools and session management | ⭐ **产品层**，主参考 |
| `ai` | `@earendil-works/pi-ai` | Unified LLM API with automatic model discovery and provider configuration | ⭐ 模型适配层（provider 差异关这里） |
| `telemetry` | `@earendil-works/pi-telemetry` | Vendor-neutral telemetry contracts and typed schema utilities | ⭐ O 层契约 |
| `tui` | `@earendil-works/pi-tui` | Terminal User Interface library with differential rendering | 附加（UI 主参考仍是 Reasonix） |
| `protocol` | `@earendil-works/pi-protocol` | Transport-neutral CBOR protocol for remote pi sessions | 附加（远程会话） |
| `client` | `@earendil-works/pi-client` | Transport-neutral client for remote pi sessions over framed CBOR bytes | 附加 |
| `server` | `@earendil-works/pi-server` | experimental server package for pi | 附加（自标 experimental） |
| `durable` | `@earendil-works/pi-durable` | Durable conversation, task, and document runtime for Pi | 附加 |
| `chord` | `@earendil-works/chord` | Application composition runtime for services, replicated state, RPC, and plugins | 附加 |
| `evals` | `@earendil-works/pi-evals` | （无 description） | ⭐ V 层：评测基建（**内含一个真实的降权沙箱**） |
| `session-backends/` | ⚠️ **分组目录，本身无 `package.json`** | workspace 分组目录，**组内**住着已发布的真包：`sqlite-node/` = `@earendil-works/pi-session-backend-sqlite-node` v0.86.1（旧名 `pi-storage-sqlite-node`） | 未读 |

---

## 二、⚠️ 2026-09-21 结构订正（旧版本卡已失效）

**本卡上一版的结构停在更早的 revision，多处对不上。** 逐条核实结果：

| 旧卡写的 | 实际（`890f920`） |
|---|---|
| `harness/reducer.ts` | ❌ **不存在** → 移到 `harness/runtime/reducer.ts` |
| `harness/session/jsonl.ts`（单文件） | ❌ **不存在** → 长成目录 `harness/session/jsonl/`（`codec` / `io` / `repo` / `storage` / `types` / `fork` / `legacy-v3`） |
| `harness/session/state.ts` | ❌ **不存在** |
| `harness/events.ts` | ✅ **仍然存在**（上一版订正时我曾误报它消失，此处更正） |
| 未提及 | 🆕 `harness/runtime/`（`drive/` 十个文件 · `restore` · `transcript` · `lane` · `progress`）、`harness/pico3/`（`kinds/` 七个 kind）、`harness/execution/`（`tools` / `assistant` / `effect-gate`）、`harness/hooks.ts`、`harness/system-prompt.ts`、`harness/skills.ts`、`harness/prompt-templates.ts`、`harness/result.ts`、`harness/env/nodejs.ts`、`harness/session/testing/`、`src/search/` |
| 未提及 | 🆕 `packages/agent/docs/`（12 篇 + 3 个子目录 `mobile-handoff/` `pico/` `work-packages/`，**与 `src/` 平级**）。⚠️ **pico3 的真规格在 `docs/pico/v3/`，不是 `docs/pico-v3.md`**（见下） |
| 未提及 | 🆕 包 `chord`、`durable`；`coding-agent/src/` 拆出了 `cli/` `modes/` `experimental/`；新增 `examples/`（13 个 SDK 示例 + 78 个扩展示例）与 `docs/`（30 篇）——**两者都在包根、与 `src/` 平级** |
| `coding-agent/src/core/` 52 文件扁平 | 仍是 52 个 `.ts`，但长出了子目录 `extensions/` `tools/`（含 `renderers/`）`compaction/` `export-html/` |

> **两条教训（都来自这次订正，都值得记住）**：
> 1. **别凭印象下判断**：我一度用"目录名的印象"报出「`harness/events.ts` 已不存在」——**实际存在**。修法不是更小心，而是**下判断前先 `Test-Path`**。目录名会骗人，记忆更会。
> 2. ⭐ **路径存在 ≠ 内容属实**（SOP 里早写过这条，我还是踩了）：我写"pico3 的设计文档是 `docs/pico-v3.md`"——该文件**确实存在**，但它自述 "Design under discussion … not existing package exports"（**已过时**），它描述的 `TaskRole` / `drive()` / `Storage` 形状在 `pico3` 源码里 **0 命中**；真规格在 `docs/pico/v3/`。**"文件在不在"能靠 `Test-Path` 查，"文件讲的是不是这个东西"只能打开读。**

---

## 三、目录结构（只列核心）

```
E:\agents-read\pi\
├─ packages/
│  ├─ agent/src/                          ← ⭐ 内核（最重要的目录）
│  │  ├─ agent.ts                         ← Agent 类（有状态封装）
│  │  ├─ agent-loop.ts                    ← 引擎循环（runAgentLoop / agentLoop）
│  │  ├─ types.ts                         ← ⭐ 低层接缝全在这（AgentLoopConfig / AgentTool / AgentEvent）
│  │  ├─ harness/                         ← 会话内核（比 agent.ts 高一层）
│  │  │  ├─ agent-harness.ts              ← ⭐ AgentHarness + HookMap + HarnessEvent
│  │  │  ├─ types.ts context.ts messages.ts result.ts config.ts
│  │  │  ├─ system-prompt.ts skills.ts prompt-templates.ts   ← 提示词 / 技能 / 模板
│  │  │  ├─ hooks.ts events.ts telemetry.ts
│  │  │  ├─ session/                      ← 会话树（jsonl/ 子目录 = 存储编解码）
│  │  │  ├─ compaction/                   ← 压缩 + 分支摘要
│  │  │  ├─ tools/                        ← 内置工具 bash/read/write/edit/image
│  │  │  ├─ runtime/                      ← 🆕 durable 驱动（drive/ restore/ transcript/ lane/）
│  │  │  ├─ pico3/                        ← 🆕 **与主 harness 并行的实验性独立内核**（先读 docs/pico/v3/）
│  │  │  ├─ execution/                    ← 🆕 工具/助手执行 + effect-gate（每次 drive pass 的准入闸门）
│  │  │  ├─ env/nodejs.ts  utils/         ← 执行环境 / 输出捕获 / 截断
│  │  └─ search/                          ← 搜索索引
│  ├─ agent/docs/                         ← 🆕 12 篇设计文档 + 3 个子目录（与 src/ 平级！先读这个）
│  ├─ coding-agent/src/                   ← ⭐ 产品层
│  │  ├─ main.ts cli.ts index.ts          ← 入口
│  │  ├─ cli/                             ← 参数 / 认证 / 信任 / 会话选择
│  │  ├─ core/                            ← 52 个 .ts（agent-session / session-manager / sdk / extensions/ …）
│  │  ├─ modes/                           ← interactive（TUI）+ rpc
│  │  ├─ extensions/                      ← llama.cpp 集成
│  │  └─ experimental/                    ← micro / mini / plugins / services（未核）
│  ├─ coding-agent/examples/              ← ⭐⭐ 与 src/ 平级：sdk/（13 个台阶）+ extensions/（78 个样板）
│  ├─ coding-agent/docs/                  ← ⭐ 与 src/ 平级：30 篇官方文档（读代码前先读它）
│  ├─ ai/  telemetry/  tui/  protocol/  client/  server/  durable/  chord/  evals/
│  └─ session-backends/                   ← 无 package.json
└─ .pi/                                   ← 项目自己的配置（extensions/ prompts/ skills/）——"配置即文件"
```

---

## 四、功能 → 位置映射（按 ETCLOVG 七层）

> 每条的路径都已 `Test-Path` 核实存在（79/80 通过，唯一失败项即上文订正掉的 `harness/reducer.ts`）。
> **缩写口径**：表中 `harness/` = `packages/agent/src/harness/`，`core/` = `packages/coding-agent/src/core/`，`docs/` 按所在包就近取。
> **「已读」列的诚实口径**：✅ 走读 01-05 / 12 是在**更早的 revision** 上读的，结论仍有效但**行号已失效**；标"未读"就是没读过。

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | 引擎循环（低层） | `packages/agent/src/agent-loop.ts` + `agent.ts` | ✅ 走读 01（旧版） |
| **L** 生命周期 | 会话内核 / lanes / durable drive | `packages/agent/src/harness/agent-harness.ts` + `harness/runtime/` | 未读 |
| **L** 生命周期 | **pico3**——⚠️ **与主 harness 并行的实验性独立内核**，不是"重构层"（`package.json` 里导出为 `./experimental/pico3`，自称 "intentionally separate from the package root"） | `packages/agent/src/harness/pico3/` ⬅ **先读** `packages/agent/docs/pico/v3/`（`hardening-handoff.md` / `plugins.md` / `view-and-events.md`） | 未读 |
| **L** 生命周期 | 产品层会话编排 | `packages/coding-agent/src/core/{agent-session,agent-session-runtime,agent-session-services}.ts` | ✅ 走读 12（旧版） |
| **C** 上下文 | 会话树 / jsonl codec | `packages/agent/src/harness/session/`（+ `session/jsonl/`） | ✅ 走读 03（旧版） |
| **C** 上下文 | 压缩 + 分支摘要 | `packages/agent/src/harness/compaction/` | ✅ 走读 04 |
| **C** 上下文 | 提示词 / 技能 / 模板装入 | `harness/{system-prompt,skills,prompt-templates}.ts` | 未读 |
| **C** 上下文 | 会话文件格式（有专门的文档） | `packages/coding-agent/docs/session-format.md` | 未读 |
| **T** 工具 | 内置工具（bash/read/write/edit/image） | `packages/agent/src/harness/tools/` | ✅ 走读 05（旧版） |
| **T** 工具 | 工具输出捕获 / 截断 / 落盘 | `harness/utils/{output-capture,truncate,shell-output}.ts` | 未读 |
| **T** 工具 | 工具执行 + **每次 drive pass 的效果准入闸门**（abort/close 后不许再开工；管工具、hook、provider 流、等待。**不做"哪些副作用工具被允许"的策略判定**——那是 hook 的活） | `packages/agent/src/harness/execution/`（`tools.ts` / `effect-gate.ts`，64 行） | 未读 |
| **T** 工具 | 产品层工具 + 渲染器（渲染器"**不含工具本体**"，只合并 `renderCall` / `renderResult`） | `packages/coding-agent/src/core/tools/`（+ `renderers/`；同目录还住 `truncate` / `path-utils` / `edit-diff` 等共享件） | 未读 |
| **T** 工具 | ⭐ **业务工具入口**（`defineTool` / `ToolDefinition`） | `packages/coding-agent/src/core/extensions/types.ts` | ✅ 已读（骨架） |
| **E** 执行 | shell / FS 抽象（`Shell` / `FileSystem` / `ExecutionEnv`） | `packages/agent/src/harness/types.ts` + `harness/env/nodejs.ts` | 未读 |
| **E** 执行 | bash 执行器（产品层） | `packages/coding-agent/src/core/{bash-executor,exec}.ts` | ✅ 走读 12 |
| **E** 执行 | ⚠️ **内核零沙箱**（`grep -i sandbox packages/agent/src` = **0 命中**），但沙箱**并非只在示例扩展** | ① 示例扩展：`examples/extensions/sandbox/`（`@anthropic-ai/sandbox-runtime`）＋ `gondolin/`（micro-VM）② ⭐ **真实降权沙箱在 V 层**：`packages/evals/src/harness.ts`（`enterToolSandbox`）＋ `evals/src/docker.ts` 注入 `PI_EVAL_SANDBOX_UID/GID` ③ "身处沙箱"的适配：`coding-agent/src/bun/restore-sandbox-env.ts` ＋ `ai/src/utils/provider-env.ts` | 未读 |
| **O** 可观测 | 低层事件协议 `AgentEvent` | `packages/agent/src/types.ts`（`:448`） | ✅ 走读 02（旧版） |
| **O** 可观测 | 高层事件 `HarnessEvent` + 钩子 | `harness/agent-harness.ts`（`:388` / `:430`） | ✅ 已读（骨架） |
| **O** 可观测 | 遥测契约 + 类型化 schema | `harness/telemetry.ts` + `packages/telemetry/` + `docs/{telemetry,telemetry-schema}.md` | 未读 |
| **O** 可观测 | 会话导出（json / html） | `packages/coding-agent/src/core/{session-export.ts,export-html/}` | 未读 |
| **O** 可观测 | 崩溃日志 / 诊断 / 事件总线 / 时序 | `core/{crash-log,diagnostics,event-bus,timings,cache-stats}.ts` | 未读 |
| **V** 验证 | 评测基建（harness + docker + 容器沙箱） | `packages/evals/`（`src/harness.ts` / `docker/entrypoint.ts`） | 未读 |
| **V** 验证 | ⭐ 存储一致性 / 基准测试套件 | `packages/agent/src/harness/session/testing/`（`conformance/` + `benchmark/` + `storage-decorator`） | 未读 |
| **G** 治理 | 项目信任（用户/全局 + CLI 扩展） | `core/{project-trust,trust-manager}.ts` + `cli/project-trust.ts` + `examples/extensions/project-trust.ts` | 未读 |
| **G** 治理 | 审批 / 保护（**都是示例扩展**） | `examples/extensions/{permission-gate,protected-paths,confirm-destructive,dirty-repo-guard}.ts` | 未读 |
| **G** 治理 | 内核拦截钩子（业务治理的真正落点） | `harness/agent-harness.ts:464`（`before_tool`）／ `agent/src/types.ts:285`（`beforeToolCall`） | ✅ 已读 |
| **G** 治理 | 凭据存储 / OAuth / 运行时凭据 | `core/{auth-storage,runtime-credentials}.ts` + `cli/auth-command.ts` | 未读 |
| 附加 | 模型适配（多 provider / 自动发现模型） | `packages/ai/` | ✅ 略读 |
| 附加 | 终端 UI（差分渲染） | `packages/tui/` | 未读 |
| 附加 | 远程会话（CBOR over RPC） | `packages/protocol/` + `client/` + `server/` + `modes/rpc/` + `docs/rpc.md` | 未读 |
| 附加 | durable 运行时（会话/任务/文档） | `packages/durable/` + `docs/pico-v5.md` | 未读 |
| 附加 | 应用组合运行时（服务 / 复制状态 / RPC / 插件） | `packages/chord/` | 未读 |
| 附加 | 官方文档（30 篇，**读代码前先读它**） | `packages/coding-agent/docs/` | 部分已读 |

> **七层都有东西，没有一个"该仓库无此项"**——唯一要特别标注的是 **E 层的沙箱**：pi 在**内核里零沙箱实现**，隔离能力分散在扩展与评测基建两处（见上表）。这与 codex（内核级 `sandboxing/`）是两种路线，对照价值很高。

> ⚠️ **命名陷阱（按名字 grep 会踩）**：`packages/agent/docs/mobile-handoff/02-plugins/02-sandbox/` 里的 "sandbox" 是**代码试验场**（membrane / facet 实验），**不是 OS 沙箱**。

---

## 五、⭐ 业务 agent 的三个起点（对"在 pi 上做业务 agent"最直接）

1. **`packages/coding-agent/examples/sdk/01-minimal.ts` → `13-session-runtime.ts`** —— 13 级台阶，从"全默认最小用法"到"全替换、零发现"。**这是"怎么用 pi 搭一个业务 agent"的标准答案**，比读 `core/` 的 52 个文件快得多。索引见 `examples/sdk/README.md`。
2. **`packages/coding-agent/examples/extensions/`（78 个）** —— 每一个都是一个可运行的业务特性样板，按主题分组：
   - 治理/安全：`permission-gate` `protected-paths` `project-trust` `sandbox/` `gondolin/`
   - 业务工具：`todo.ts`（工具 + 命令 + 自渲染 + 状态持久化）`dynamic-tools.ts` `structured-output.ts` `subagent/`
   - 命令/UI：`plan-mode/` `preset.ts` `handoff.ts` `qna.ts` `custom-footer.ts`
   - 提示词/压缩：`pirate.ts` `claude-rules.ts` `custom-compaction.ts` `trigger-compact.ts`
   - 资源发现：`dynamic-resources/`（`resources_discover`）
   - 自定义 provider：`custom-provider-anthropic/` `custom-provider-gitlab-duo/`
3. **`packages/coding-agent/docs/`（30 篇）** —— `extensions.md`（扩展全文档）· `sdk.md` · `sessions.md` · `session-format.md` · `security.md` · `containerization.md` · `compaction.md` · `skills.md` · `prompt-templates.md` · `providers.md` · `rpc.md`。

**两条从示例里读到的硬事实**（可直接引用）：

- ⭐ **业务状态的正确存法**：状态存进**工具结果的 `details`**（随会话持久化），在 `session_start` 时用 `ctx.sessionManager.getBranch()` 回放重建——**这样 fork 才安全**。示例原文：*"Store state in tool result details for proper forking support"*。
- ⭐ **字符串枚举必须用 `StringEnum`**（`@earendil-works/pi-ai` 导出）：`Type.Union([Type.Literal(...)])` **在 Google API 上不工作**。这是 provider 兼容性的硬约束，不是风格问题。

---

## 六、搜索配方

- **语言**：TypeScript，直接读 `*.ts`。
- **找功能**：**先猜包名**（`compaction` → `harness/compaction/`），再在该目录内 grep 函数名。
- **找业务怎么接内核**：直接进 `examples/`（`sdk/` 看装配，`extensions/` 看扩展点），**不要从 `core/` 硬读**。
- **⚠️ 读 `pico3/` / `runtime/` 之前先读 `packages/agent/docs/`**——设计文档在 `docs/`（`harness.md` / `values.md` …）与 `docs/pico/v3/`（pico3 三件套）。**别读错 `docs/pico-v3.md`，那份已过时**（其模型在 pico3 源码里零命中）。硬读会迷路。
- **grep 示例**（均实测命中）：
  ```bash
  grep -rn "runAgentLoop" packages/agent/src/agent-loop.ts        # 循环入口（:101 / :127）
  grep -n  "before_tool" packages/agent/src/harness/agent-harness.ts   # 工具拦截钩子（:464）
  grep -n  "defineTool" packages/coding-agent/src/core/extensions/types.ts  # 业务工具入口（:512）
  grep -rn "loadSkills" packages/agent/src/harness/skills.ts      # 技能加载（:51）
  ls packages/coding-agent/examples/extensions/                   # 78 个示例一览
  ```
- **注意**：pi 的 `node_modules` 巨大，搜索时**务必排除**；`packages/coding-agent/src/experimental/`（micro / mini / plugins / services）属**未核区域**，别当依据。

## 七、我们（本项目）与 pi 的对应关系

| pi | 我们 | 备注 |
|---|---|---|
| `packages/agent`（内核） | `lib/` | 公共门面 `lib/index.ts`；红线文件 `lib/agent/index.ts` |
| `packages/coding-agent`（产品层） | `app/` | `app/api/*` + `app/components/*` |
| `packages/ai`（provider 差异） | 适配层 | 我们的规矩：provider 字段只允许出现在适配层 |
| `packages/coding-agent/examples/` | —— | **我们没有对标物**：这可能是 pi 最值得抄、我们最缺的一块 |
