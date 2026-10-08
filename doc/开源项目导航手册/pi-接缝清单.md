# pi 接缝清单 —— 对照「基于 pi 核心包的业务 agent」用

> [返回索引](index.md) ｜ 项目卡：[pi.md](pi.md)

**这份东西解决什么问题**：你要读一个**基于 pi 核心包开发的业务 agent**，但业务代码不在手边 / 不在本机。此时"从业务目录树入手"是错的——你会在里面迷路，因为没有判据区分「这是 pi 本来就有的」和「这是业务自己长出来的」。

**正确的入手点**：业务 agent 的全部业务性 = **它在 pi 的接缝上塞了什么**。所以先在本文件里把接缝钉死（基准），再去业务项目逐条对号入座（增量）。**业务代码一行都不看，也能先把基准吃透。**

**锚点（写死，别漂）**：本地检出 `E:\agents-read\pi`，commit `890f920884f6d21fc7617d236ef9e1cc5d7a0ef8`（2026-09-21），各包 `version` = `0.86.1`。
⚠️ 行号是**这一版**的行号。业务项目依赖的 pi 版本若不同，**先对齐版本再照行号翻**——接缝会随版本变。

---

## 第 0 步（必做）：先确定业务项目站在哪一层

pi 不是"一个核心包"，是一摞。**先看业务项目的 `package.json` 依赖 + `grep -rn "@earendil-works/pi" src`**，命中什么符号直接告诉你站在哪一层——**三层的工作量差一个数量级**。

| 层 | 包名 | 业务层典型 import | 接缝载体 | 内核位置 |
|---|---|---|---|---|
| ① 循环内核（低层） | `@earendil-works/pi-agent-core` | `runAgentLoop` / `Agent` | `AgentLoopConfig` 的 11 个回调 | `packages/agent/src/` |
| ② 会话内核（高层） | 同上，`harness/` 子目录 | `AgentHarness.create()` | `AgentHarnessOptions` + `HookMap` | `packages/agent/src/harness/` |
| ③ 产品层 | `@earendil-works/pi-coding-agent` | `createAgentSession` / `InlineExtension` | `ExtensionAPI` 事件族 | `packages/coding-agent/src/` |

> 另有两个相邻包会被业务层碰到：`@earendil-works/pi-ai`（模型适配，provider 差异关这里）、`@earendil-works/pi-protocol`（线协议）。

---

## 一、① 循环内核接缝（低层）

**装配入口（唯一的两个）**

| 入口 | 位置 | 说明 |
|---|---|---|
| `runAgentLoop(prompts, context, config, emit, signal, streamFn)` | `packages/agent/src/agent-loop.ts:101` | 起一次 run |
| `runAgentLoopContinue(context, config, emit, signal, streamFn)` | `agent-loop.ts:127` | 接着已有的 context 跑 |
| `agentLoop` / `agentLoopContinue`（流式版） | `agent-loop.ts:37` / `:70` | 返回事件流 |
| `new Agent(options)` | `packages/agent/src/agent.ts:188`（构造器 `:231`） | 有状态封装；公开字段 `agent.ts:194-229` 就是可替换的接缝 |

**注入点清单**（`AgentLoopConfig` 在 `packages/agent/src/types.ts:156`；`AgentOptions` 在 `agent.ts:113`，两者基本一一对应）

| 接缝 | 行 | 业务能改什么 | 业务项目里的搜索词 |
|---|---|---|---|
| `model` | `types.ts:157` | 本轮模型 | `model:` |
| `convertToLlm` | `types.ts:185` | 业务私有消息 → LLM 消息（**必填，契约：不许抛**） | `convertToLlm` |
| `transformContext` | `types.ts:207` | 请求前裁剪 / 注入（记忆、RAG、外部数据） | `transformContext` |
| `getApiKey` | `types.ts:217` | 每次调用动态取 key | `getApiKey` |
| `shouldStopAfterTurn` | `types.ts:230` | 业务停止条件 | `shouldStopAfterTurn` |
| `prepareNextTurn` | `types.ts:237` | 下一轮换 context / model / thinking | `prepareNextTurn` |
| `getSteeringMessages` | `types.ts:252` | 运行中介入 | `getSteeringMessages` |
| `getFollowUpMessages` | `types.ts:265` | 跑完接着干 | `getFollowUpMessages` |
| `toolExecution` | `types.ts:276` | `"sequential"` / `"parallel"` | `toolExecution` |
| **`beforeToolCall`** | `types.ts:285` | **审批 / 拦截**（返回 `{block:true}` 即挡住） | `beforeToolCall` |
| **`afterToolCall`** | `types.ts:300` | **改写工具结果**（逐字段覆盖，无深合并） | `afterToolCall` |

配套结果类型：`BeforeToolCallResult` `types.ts:66`、`AfterToolCallResult` `types.ts:89`、`AgentLoopTurnUpdate` `types.ts:143`。

**数据类型接缝（业务概念的法定入口）**

| 接缝 | 行 | 为什么关键 |
|---|---|---|
| **`CustomAgentMessages`** | `types.ts:324` | **声明合并**：业务自定义消息类型的唯一合法入口。业务项目里搜 `declare module` |
| `AgentMessage` | `types.ts:333` | = LLM 消息 ∪ 业务自定义消息 |
| `AgentTool` | `types.ts:406` | **业务工具本体**：`label` `:408` / `prepareArguments` `:413` / `execute` `:415` / `replay` `:422` / `executionMode` `:430` |
| `AgentToolResult` | `types.ts:383` | 工具返回：`content` / `details` / `usage` / `terminate` |
| `AgentState` | `types.ts:341` | 对外可见状态（`systemPrompt` 只读，改提示词要 append system message） |
| `AgentContext` | `types.ts:434` | 低层循环的输入快照 |
| `StreamFn` | `types.ts:33` | 换模型 / 网关 / 鉴权通道 |
| `ThinkingLevel` | `types.ts:308` | off…max |

---

## 二、② 会话内核接缝（高层 `harness/`）

**装配入口**：`AgentHarness.create(options, context)` — `packages/agent/src/harness/agent-harness.ts:622`（类型 `:615`）
**选项面**：`AgentHarnessOptions` — `agent-harness.ts:518`

| 字段 | 行 | 业务能改什么 |
|---|---|---|
| `session` | `:519` | 会话存储 |
| `models` / `model` | `:520` / `:521` | 模型注册表与当前模型 |
| `thinkingLevel` | `:522` | 思考级别 |
| `activeToolNames` / `tools` | `:523` / `:524` | 工具集（含可见性） |
| `toolContext` | `:525` | 工具的运行期上下文（业务依赖注入的口子） |
| **`systemPrompt`** | `:526` | 字符串 **或函数**（可按 toolContext 动态生成） |
| **`resources`** | `:527` | `AgentHarnessResources<Skill, PromptTemplate>`（`:426`）——技能与提示词模板 |
| `streamOptions` | `:528` | 透传给 provider |
| `retry` | `:529` | 重试策略 |
| `compaction` | `:530` | 压缩设置 |
| `steeringMode` / `followUpMode` | `:531` / `:532` | 队列消费方式 |
| `toolExecution` | `:533` | 串行 / 并行 |
| `toProviderMessages` | `:534` | 高层版的 `convertToLlm` |
| `entryProjectors` | `:535` | 会话条目投影（自定义 UI / 视图） |

**钩子清单**：`HookMap` — `agent-harness.ts:430`；注册入口 `Hooks.on()` — `:512`

| 钩子 | 行 | 时机 |
|---|---|---|
| `before_run` | `:431` | run 前，可换初始消息 |
| `before_drive` | `:435` | 每次驱动前（run / compaction / navigation） |
| `before_run_end` | `:439` | run 收尾，可给 follow-up |
| `transform_context` | `:443` | **可同时改 messages 和 systemPrompt** |
| `before_request` | `:447` | 请求前，改 streamOptions |
| `before_payload` | `:456` | 改原始 payload |
| `after_response` | `:460` | 拿 HTTP 状态/头/消息 |
| **`before_tool`** | `:464` | **可改参数、可 block** |
| **`after_tool`** | `:468` | **可改 content / details / isError / usage** |
| `before_compaction` | `:488` | 可拒绝或自定义压缩结果 |
| `before_navigation` | `:496` | 分支跳转/摘要 |

**资源与运行面**
- `Resources` `agent-harness.ts:426`；`Skill` / `loadSkills` — `harness/skills.ts:51`；`PromptTemplate` / `loadPromptTemplates` — `harness/prompt-templates.ts:31`；`formatSkillsForSystemPrompt` — `harness/system-prompt.ts:3`
- `AgentHarness` 接口 — `agent-harness.ts:586-612`：`lane()` `:587`、`getTools`/`setTools` `:594`/`:595`、`getResources`/`setResources` `:596`/`:597`、`setStreamOptions` `:599`、`setRetryPolicy` `:601`、`setCompactionSettings` `:603`、`watchSession` `:608`、`hooks` `:609`、`events` `:610`

---

## 三、③ 产品层接缝（`pi-coding-agent`）

**装配入口**：`createAgentSession(options)` — `packages/coding-agent/src/core/sdk.ts:175`
**选项面**：`CreateAgentSessionOptions` — `core/sdk.ts:41`

| 字段 | 行 | 说明 |
|---|---|---|
| `cwd` / `agentDir` | `:43` / `:45` | 工作目录与配置目录 |
| `modelRuntime` / `model` / `scopedModels` | `:48` / `:51` / `:55` | 模型与作用域 |
| `thinkingLevel` | `:53` | |
| `noTools` / `tools` / `excludeTools` | `:64` / `:74` / `:76` | 工具集三档控制 |
| **`customTools`** | `:78` | **业务自定义工具从这里进**（`ToolDefinition`） |
| `resourceLoader` | `:81` | 资源（技能/模板）加载器 |
| `sessionManager` / `settingsManager` | `:84` / `:87` | 会话与设置 |
| `sessionStartEvent` | `:89` | 启动事件 |

**扩展体系**：`packages/coding-agent/src/core/extensions/types.ts`（该文件有 158 处 `interface`/`type`/`const`/`function` 级 export，下面只列骨架；要全量就 grep `^export `）

| 接缝 | 行 | 说明 |
|---|---|---|
| **`defineTool`** / `ToolDefinition` | `:512` / `:452` | 带 UI 渲染的业务工具 |
| **`ExtensionFactory`** / **`InlineExtension`** | `:1623` / `:1625` | 业务扩展的**法定入口** |
| `ExtensionAPI` | `:1261` | 扩展能拿到的全部能力面 |
| `ExtensionContext` / `ExtensionCommandContext` | `:310` / `:356` | 运行时上下文 |
| `ExtensionMode` | `:308` | `"tui" \| "rpc" \| "json" \| "print"` |
| `ExtensionEvent` | `:1087` | 事件总类型 |
| `ToolCallEvent` / `ToolResultEvent` | `:946` / `:1013` | **工具级审批/改写**（按工具名细分到 `:895-1013`） |
| `ContextEvent` | `:689` | 上下文介入 |
| `BeforeProviderRequestEvent` / `AfterProviderResponseEvent` | `:695` / `:711` | provider 边界 |
| `InputEvent` | `:868` | 输入拦截 |
| `SessionEvent` / `SessionStartEvent` | `:672` / `:565` | 会话生命周期 |
| `AgentStartEvent`/`AgentEndEvent`/`TurnStartEvent`/`TurnEndEvent` | `:731`/`:736`/`:765`/`:772` | 循环生命周期 |
| `MessageStartEvent`/`MessageUpdateEvent`/`MessageEndEvent` | `:780`/`:786`/`:793` | 消息生命周期 |
| `ToolExecutionStartEvent`/`Update`/`End` | `:799`/`:807`/`:816` | 工具执行生命周期 |
| **改写结果族** | `:1121` / `:1129` / `:1153` / `:1160` / `:1165` | `ContextEventResult` / `ToolCallEventResult` / `ToolResultEventResult` / `MessageEndEventResult` / `BeforeAgentStartEventResult` —— **"能改什么"看这些** |
| `ProjectTrustHandler` / `ProjectTrustEvent` | `:541` / `:522` | 治理（项目信任） |
| `ResourcesDiscoverEvent` | `:547` | 资源发现 |
| `RegisteredCommand` / `ResolvedCommand` | `:1238` / `:1246` | 斜杠命令 |
| `ProviderConfig` / `ProviderModelConfig` | `:1538` / `:1591` | 自定义 provider |

---

## 四、主流程骨架（拿它当核对尺）

**低层事件序列**（`packages/agent/src/types.ts:448`）——循环的顺序内核已经写死，业务改不了顺序，只能往里挂东西：

```
agent_start :450
  └ turn_start :453
      ├ message_start :456 / message_update :458 / message_end :459
      ├ tool_execution_start :461 / tool_execution_update :462 / tool_execution_end :463
      └ turn_end :454
  └ ……重复 turn……
agent_end :451
```

**怎么用**：拿这个序列当骨架，在业务项目里给**每个环节**填"业务在这里加了什么"。**填不出的环节 = 业务没碰它，这本身也是结论**，别跳过。

---

## 五、对照作业单（带去业务项目填）

> 用法：在业务项目里 grep 左列的**搜索词**（符号名不会变），每个命中点就是一列"业务实现"。命中密集的那个文件 = 这个 agent 的**接线板**（通常叫 runtime / session / bootstrap / agent.ts），**那才是你该精读的第一个业务文件**。

| 接缝 | 搜索词 | 业务项目里的实现（文件:行） | 业务意图（一句话） |
|---|---|---|---|
| 装配入口 | `runAgentLoop` / `AgentHarness.create` / `createAgentSession` | | |
| 模型接入 | `streamFn` / `streamOptions` / `provider` | | |
| 消息翻译 | `convertToLlm` / `toProviderMessages` | | |
| 上下文注入 | `transformContext` / `transform_context` / `ContextEvent` | | |
| 工具集 | `AgentTool` / `defineTool` / `customTools` | | |
| 工具审批 | `beforeToolCall` / `before_tool` / `ToolCallEvent` | | |
| 结果改写 | `afterToolCall` / `after_tool` / `ToolResultEvent` | | |
| 停止条件 | `shouldStopAfterTurn` | | |
| 运行中介入 | `getSteeringMessages` / `getFollowUpMessages` | | |
| 提示词 | `systemPrompt` / `buildSystemPrompt` | | |
| 技能/模板 | `loadSkills` / `loadPromptTemplates` / `resources` | | |
| 会话存储 | `SessionManager` / `session-backends` | | |
| 压缩 | `compaction` / `before_compaction` | | |
| 业务私有消息 | `declare module` / `CustomAgentMessages` | | |
| 观测/审计 | `AgentEvent` / `ExtensionEvent` / `events` | | |

---

## 六、坑（踩过 / 会踩）

1. **`pi.md` 的旧目录结构已失效**（2026-09-21 核实，`pi.md` 已按 `890f920` 重写）。真实变化：`harness/reducer.ts` **不存在** → 移到 `harness/runtime/reducer.ts`；`harness/session/jsonl.ts` **不存在** → 长成目录 `harness/session/jsonl/`；`harness/session/state.ts` **不存在**。⚠️ 而 `harness/events.ts` **仍然存在**——我第一次订正时凭"目录印象"误报它消失，**下判断前先 `Test-Path`，别信记忆**。另新增 `harness/runtime/`、`harness/pico3/`、`harness/execution/`、`search/`。**拿旧走读笔记（01-05 那批）去对 `0.86.1` 会处处对不上。**
2. **三层可能混用**。业务项目完全可能低层 `Agent` 和高层 `AgentHarness` 一起用（前者拿精细控制，后者拿会话/压缩）。别假设它只站一层——**grep 结果说话**。
3. **版本漂移**。行号绑定 `890f920`。业务项目的 pi 版本不同时，**先 `grep` 符号名定位，再读**，不要照抄行号。
4. **`CustomAgentMessages` 用声明合并**，不是运行时注册——grep `declare module` 才找得到，grep 类型名可能找不到用法。
5. ⭐ **路径存在 ≠ 内容属实**（实测踩到）：`packages/agent/docs/pico-v3.md` **确实存在**，且从文件名到内容都"像" `harness/pico3/` 的设计文档——但它是**已过时的讨论稿**（自述 "not existing package exports"），它描述的 `TaskRole` / `drive()` / `Storage` 在 pico3 源码里 **0 命中**；真规格在 `packages/agent/docs/pico/v3/`。**核对"这个文件讲的是不是这个东西"，只能打开读，grep 文件名没用。**
6. ⭐ **按名字 grep 会踩的另一个坑**：`packages/agent/docs/mobile-handoff/02-plugins/02-sandbox/` 里的 "sandbox" 是**代码试验场**（membrane / facet 实验），**不是 OS 沙箱**；而 pi 真正的降权沙箱在 `packages/evals/src/harness.ts`（`enterToolSandbox`）——**按目录名归类会把它归到 E 层，实际它属 V 层**。

---

## 七、本文件未核实项（诚实的空白）

- 高层 `harness` 的 `Events` 接口（`agent-harness.ts:419`）只核到行号，未逐个读字段
- `Agent` 类的方法列表只读到 `agent.ts:242`，`subscribe()` 等方法名未逐条核实
- `packages/agent/src/harness/runtime/`、`pico3/`、`execution/` 三块**完全未读**。已由独立子代理抽查出两块的性质，**但都没有精读**：
  - `pico3/` = 与主 harness **并行的实验性独立内核**（`package.json` 导出 `./experimental/pico3`），约 24 个文件（`session.ts` 58KB / `harness.ts` 30KB / `scheduler.ts` / `kinds/`）；**真规格在 `docs/pico/v3/`**（`docs/pico-v3.md` 已过时）
  - `execution/effect-gate.ts`（64 行）= **每次 drive pass 的效果准入闸门**（`createGate()` / `Gate.admit()`，abort/close 后抛 `AbortRequested`），调用点覆盖工具、hook、provider 流、等待；**不做策略判定**
  - `runtime/` 仍是**完全的黑盒**（只知有 `drive/` 十个文件 + `restore` / `transcript` / `lane` / `progress`）
- `packages/ai/`、`packages/protocol/` 未读；`packages/session-backends/` 是 **workspace 分组目录**（本身无 `package.json`），组内 `sqlite-node/` = 已发布包 `@earendil-works/pi-session-backend-sqlite-node` v0.86.1
- `extensions/types.ts` 的 158 处 export 只挑了骨架，未全量核对语义
