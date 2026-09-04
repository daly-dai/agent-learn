# pi 与 codex 的上下文压缩机制：源码精读

> 调研课题：各家 agent 压缩方案对比的源码补全——**pi** 与 **codex** 两家（2026-09-04 精读本地源码）。
> 配套分册：`知识点-03-上下文压缩.md`（我们自己的完整故事）、`知识点-05-Claude-Code-上下文压缩机制.md`、`知识点-06-DSH-压缩机制.md`、`workspace/精读走读-04-pi-压缩对照.md`、`workspace/精读走读-24-DSH-压缩对照.md`。
> 本文回答：pi 和 codex 的压缩到底怎么实现——从触发到落盘的完整机制 + 源码证据，末尾附五家对照总表。

---

## 一、pi（append-only 存储 + 读时过滤）

> 源码：`E:\agents-read\pi\packages\agent\src\harness\compaction\compaction.ts`（848 行）+ `branch-summarization.ts`；`packages/agent/src/harness/session/`（types/context/memory）；`packages/coding-agent/src/core/agent-session.ts` + `session-manager.ts`。

### 1.1 触发：三 reason + 三处检查 + 防误触发

- 阈值：`tokens > contextWindow − reserveTokens`（默认 reserveTokens=16384，compaction.ts:247-250）。tokens 估算优先取**最后一条有效 assistant 的 provider usage** + 尾部启发式，无 usage 才纯估算（216-244）。
- reason 三枚举：`threshold / overflow / manual`（session/types.ts:127）。
- 调用点三处：agent_end 后 `_checkCompaction`（agent-session.ts:1142）、发新 prompt 前（1254）、agent 循环 prepareNextTurn 钩子（555）。
- **overflow 恢复**：上下文溢出错误或可恢复 length（2155-2156）→ 删失败的 assistant 消息 → 压缩 → **重试一次**（2188-2195）。
- **防误触发**：换过模型不算、时间戳早于最近压缩的旧 usage 不算（2139-2150）。
- 中断可恢复：step_attempt 记录持久化 compactionReason（types.ts:139-147）。

### 1.2 流程：prepare 纯计算 → compact 生成 → append 落盘

```
prepareCompaction（纯计算，616-687）
  → 扩展钩子 session_before_compact（可整体替换摘要）
  → compact() 生成（707-794，调模型）
  → appendCompaction 追加 compaction entry（session-manager.ts:1098）
  → buildSessionContext 重建上下文（context.ts:90-100）
```

### 1.3 切点：绝不切在 toolResult 上，必要时"切穿轮次"

- `findValidCutPoints` 只允许切在 message（user/assistant/bashExecution/custom/摘要类）与 branch_summary 上，**toolResult 一律禁止**（312-344）。
- `findCutPoint` 从尾部倒走累计 token 到 ≥keepRecentTokens（默认 20000）后取首个合法切点，再向前回退跳过纯状态 entry（374-422）。
- **turn 边界语义**（`findTurnStartIndex` 347-361）：回找最近 user/bashExecution 消息 = 轮次起点。切点若是 user 消息 → 整轮入保留尾；否则 **split-turn**：切点上移到轮起点，被弃的轮前缀 `[turnStart, cut)` 单独用 TURN_PREFIX 提示词摘要成 "Turn Context" 段拼进 summary，轮后缀原文保留（652-669、731-762、689-702）。
- **为什么**：不能让模型看到"只有工具结果没有用户请求"的轮次；但也不整轮切——只切穿"用户正在推进的任务"，省 token 又不撕裂上下文。

### 1.4 保留策略：两个 token 预算

- `reserveTokens=16384`：给摘要 prompt + 输出预留的余量，超窗即触发（148-162）。
- `keepRecentTokens=20000`：压缩后近端想保留的 token 预算，直接决定保留尾巴长度。

### 1.5 增量摘要：双通道（文本走提示词，文件清单走结构化种子）

- **文本通道**：prepareCompaction 找到上一个 compaction entry，取其 summary 作 `previousSummary`，并把其 retainedTail **物化成虚拟 message entries** 参与新一轮切点（624-646）；有旧摘要时换 `UPDATE_SUMMARIZATION_PROMPT` 增量更新，旧文放 `<previous-summary>` 标签（545-554）。
- **文件通道**：`extractFileOperations` 先用上个 entry 的 `details` 播种（read/modified）再扫本轮消息（44-67），结果既以 `<read-files>` 文本附进摘要尾部、又整存 `entry.details = CompactionDetails{readFiles, modifiedFiles}`（784-792）——**跨压缩靠 details 结构化累加，不解析摘要文本**。
- **要点**：摘要文本不承担"可靠记忆"职责，机器可读状态单独存——这是"增量更新"和"文件追踪"两条腿。

### 1.6 摘要请求隔离：不进缓存

`completeSimpleWithRetries` 强制 `cacheRetention: "none"` + 每次新 uuidv7 sessionId（102-122），注释写明：摘要是一次性独立请求，隔离路由、避免写不可复用的缓存。

### 1.7 分支摘要（branch-summarization.ts）

会话树 fork/回溯离开旧分支时，把"旧叶子 → 与目标的公共祖先"之间条目压成 `branch_summary` entry（fromId 记来源），供日后返回续用；`prepareBranchEntries` 按 tokenBudget（contextWindow − reserveTokens）选材且丢弃 toolResult（82-171）。与 compaction 复用同一摘要系统提示与文件追踪。

### 1.8 存储模型：只追加，删除是"读时过滤"

- 存储 API 只有 append、无删除（types.ts:290-326；memory.ts 纯 mutation 追加）。
- "删历史"= 读时过滤：`defaultContextEntryTransform` 把路径折叠成 [最新 compaction, 其后条目]（context.ts:45-57）；旧版用 firstKeptEntryId 指针保留其后 entry（session-manager.ts:441-452）。
- `retainedTail` = 把近尾消息内联拷贝进 compaction entry；`firstKeptEntryId` = 指向首个保留 entry 的指针——**同思路两种表达，均不物理删**。

### 1.9 Entry 结构（types.ts:44-51）

`EntryBase(id/seq/parentId/timestamp) + type:"compaction" + summary、retainedTail、tokensBefore、details?(CompactionDetails)、usage?`；投影为 compactionSummary 角色消息（context.ts:75-80）。

### 1.10 pi 最值得讲的三个点

1. **split-turn**：切点可以切穿"进行中的轮"，被弃的轮前缀单独摘要、轮后缀原文保留——比只整轮切更省 token，又不撕裂任务。
2. **增量摘要双通道**：旧摘要走提示词增量更新、文件清单走 details 结构化种子累加——可靠记忆不压在摘要文本上。
3. **触发是事件驱动 + 溢出恢复**：三 reason、三处检查、防旧 usage/换模型误触发，溢出时"删失败消息 → 压缩 → 重试一次"。

> 与我们趋同处（设计选对的对照证据）：同样禁 toolResult 作切点、同样把摘要投影成专用 compactionSummary 消息类型。差异集中在 split-turn 前缀摘要、文件 details 结构化和"摘要不进缓存"。

---

## 二、codex（压缩是一等协议公民：可外包、可放弃）

> 源码：`E:\agents-read\codex\codex-rs\core\src\`：`compact.rs`、`tasks/compact.rs`、`state/auto_compact_window.rs`、`context/world_state/compact_permissions.rs`、`compact_token_budget.rs`、`compact_model_fallback.rs`、`compact_remote*.rs`、`context/compaction_summary.rs`；`app-server/tests/suite/v2/compaction.rs`。

### 2.1 三套方案并存，同一分发点

```
tasks/compact.rs:36-77 与 session/turn.rs:1209-1276
  ① TokenBudget feature 开          → compact_token_budget（跳过一切摘要）
  ② provider.remote_compaction 能力：
       V2+feature → compact_remote_v2（远程 /v1/responses/compact）
       仅 V2       → legacy remote
       Unsupported → 本地 memento 摘要（SUMMARIZATION_PROMPT 当 user 输入走普通流）
```

**memento 只是 CompactionStrategy 三态之一**（responses_metadata.rs:130）——摘要不是压缩的本质，是可外包（远程）/可放弃（TokenBudget）的一态。

### 2.2 触发与判定：PreTurn + MidTurn

- **PreTurn**：每次 sampling 前 `run_pre_sampling_compact` 检查，`token_limit_reached` 则压缩（phase=PreTurn、reason=ContextLimit、不注入 initial context；turn.rs:1032-1061）；另有换模型（comp_hash 变化/窗口变小）触发（turn.rs:1100-1191）。
- **MidTurn**：采样后 `needs_follow_up && (新窗口请求 || token_limit_reached)` → roll over 压缩（phase=MidTurn、BeforeLastUserMessage 注入；turn.rs:460-499）。
- **判定**（context_window.rs:52-109）：scope 计数 = 总用量或 body_after_prefix（总量 − 窗口 prefill 基线）；`token_limit_reached = scope ≥ scope_limit + fallback_buffer` 或 `active ≥ 窗口 × percent/100`。fallback buffer 只在配了 fallback prompt 时预留（config/mod.rs:1190-1213）。

### 2.3 保留策略：只信"真实用户消息"尾部

- 本地压缩只收 UserMessage 且过滤掉旧摘要（`is_summary_message`，compact.rs:541-575），从最新往前累计到 `COMPACT_USER_MESSAGE_MAX_TOKENS=20_000`（approx 计数，跨界消息截断；compact.rs:61, 658-689）；**assistant/tool/developer 全丢**；新摘要以 user 身份垫底（compact.rs:729-731）。
- 远程路径由服务端返回新历史，客户端只做过滤：丢 developer、丢非用户内容 user、**保留 assistant**、其余工具消息全丢（compact_remote.rs:373-400）。
- **哲学**：与 pi"保尾巴原文"相反——codex 假设 LLM 回合 + world state 已承载关键状态，历史里只有"用户说的话"值得原样留。

### 2.4 摘要身份：交接笔记，不递归叠加

- `summary_text = SUMMARY_PREFIX + 压缩回合最后一条 assistant 消息`（compact.rs:352-359）；SUMMARY_PREFIX 文案 = "Another language model started to solve this problem…You also have access to the state of the tools…"（summary_prefix.md）——frame 成"**另一位 LLM 的交接笔记 + 工具状态可用**"。
- 存为 CompactionSummary 片段：role=user、content_kind=`compaction.summary`（compaction_summary.rs:17-36）。
- **不递归叠加**：替换历史时旧摘要被识别过滤，永远只垫最新一条（compact.rs:557-559）；MidTurn 时 canonical initial context 插到最后一个真实用户消息之前，保证摘要恒为历史末项（compact.rs:62-78, 587-643）。
- 与 pi 的 previousSummary 递归**正相反**——codex 认为摘要不是"摘要的摘要"，是"另一 LLM 的交接单"，叠了只会失真。

### 2.5 窗口 ≠ turn：AutoCompactWindowIds 链

- `AutoCompactWindowIds{first_window_id, previous_window_id, window_id}`（auto_compact_window.rs:4-20），每次压缩/重置 `advance()`：window_number+1、previous=旧 window_id、新 uuid v7（77-85）。
- 窗口是 **token 记账纪元**：BodyAfterPrefix 下增量 = active − 窗口起点 prefill（服务器观测优先于估算；108-130），只随装 checkpoint 推进（compact.rs:365 等三处），并持久化进 world state/resume checkpoint（world_state.rs:126-136）。
- "turn 切点"由 phase 标签（pre_turn/mid_turn）表达，是**相对采样回合的位置概念**，与窗口 id 链正交。

### 2.6 TokenBudget：压缩 = 无摘要重置 + world state 重建

- `start_new_context_window`（compact_token_budget.rs:66-92）：不调模型、不写摘要，丢弃整个 transcript，用当前 **WorldState 重建 canonical initial context**（session/mod.rs:4133-4179）。
- WorldState 是结构化 sections（ModelInstructions/Permissions/Tools/TokenBudgetContext 含 window ids…，world_state.rs:90-140），**不是对话文本**。
- 另配 developer 级注入：TokenBudgetReminder（剩余 token 提醒）与 fallback prompt（token_budget.rs:110-164）。

### 2.7 AutoCompactFallbackPrompt ≠ 摘要 prompt

- TokenBudget 模式下当 base 窗口余量=0 且本轮不会强制压缩时（allow=`!roll_over && !token_limit_reached`，turn.rs:462）注入**一次**（每窗口 claim 一次；token_budget.rs:146-164）的 **developer 角色**指示（content_kind `compaction.auto_fallback_prompt`；token_budget_context.rs:225-244），内容如 "Write notes immediately"——**逼模型在窗口耗尽前自己把状态写进 notes**，正是 fallback_buffer 预留余量的用途。
- 别与 compact_model_fallback.rs 混淆：后者是远程压缩遇模型相关错误（InvalidRequest/ContextWindowExceeded/ServerOverloaded…）时用**当前模型**重试的降级（compact_model_fallback.rs:9-20；compact_remote.rs:224-265）。

### 2.8 身份/缓存：压缩请求带全量元数据

- 每次压缩请求挂 `CompactionTurnMetadata{trigger, reason, implementation, phase, strategy: memento}`（responses_metadata.rs:109-132），经 request_kind="compaction" 走 `x-codex-turn-metadata` 与 `x-codex-window-id` header（client.rs:156-158）。
- 本地摘要流复用同一 client_session（重试保 sticky routing/ws 增量；compact.rs:265-268）。
- 压缩中 ContextWindowExceeded 时**从头删最旧消息以 preserve prefix cache**（compact.rs:314-322）——与 pi"摘要不进缓存"相反的另一条缓存路线：codex 优先保主对话前缀缓存。

### 2.9 协议层可见性（app-server/tests/suite/v2/compaction.rs）

断言：压缩表现为 `ContextCompaction` ThreadItem started/completed 同 id 一对（53-103）；远程恰好一次 `/v1/responses/compact`（184-186）；普通 turn：request_kind="turn"、turn_id 非空、window_id==header、无 compaction 字段（190-213）；compact 请求：`compaction{trigger:auto, reason:context_limit, implementation:responses_compact, phase:pre_turn, strategy:memento}`，且 pre_turn 压缩**携带当前 turn_id**（215-241）；压缩后 rawResponse/completed 透传、resume 还原 cwd（246-378）。

### 2.10 codex 最值得讲的三个点

1. **压缩是一等协议公民**：独立身份（compaction 元数据 + 窗口链）、生命周期 item 事件、pre/post hooks、analytics——"交接"被建模成**带状态的回合**，而非我们 previousSummary 式的纯 prompt 拼接。
2. **保留哲学与我们相反**：我们保尾巴（assistant/tool 不丢）；codex 只留"真实用户消息"尾部 20k + 单条交接总结，assistant/tool 全丢、旧摘要显式过滤、绝不递归叠。
3. **摘要是可外包、可放弃的一态**：能远端就让服务端压缩（可保留 assistant 消息）、失败换模型重试；TokenBudget 干脆"新窗口 + 结构化 world state + developer 提示写 notes"。

---

## 三、五家对照总表（分享用一页纸）

| 维度 | 我们（agent-learn） | pi | codex | DSH | Claude Code |
|---|---|---|---|---|---|
| 存储模型 | 消息树 + 叶子指针，JSONL 只追加 | append-only 日志 + 读时过滤 | 窗口 id 链 + world state checkpoint | 事件日志 + surface 折叠视图 | 会话文件（本地） |
| 触发 | run 结束阈值（窗口−预留 ≈984K） | threshold/overflow/manual 三 reason + 三处检查 | PreTurn + MidTurn + 换模型 | pressure(0.8) + context-overflow 双触发 | 预留 20k 输出 + 13k 缓冲 + 连续失败 3 次熔断 |
| 摘要生成 | LLM 结构化摘要，失败拼贴降级 | LLM 摘要（TURN_PREFIX/split-turn 特殊） | **三态**：本地 memento / 远程 compact / TokenBudget 无摘要 | toolResultPruner 零成本剪枝先行 → LLM | **五段成本递增流水线**（前四段本地零 API），LLM 兜底 |
| 保留策略 | 保留最近 N 条原文 | 原始 tail 20k tokens（retainedTail） | 只留真实用户消息 20k + 单条交接摘要，assistant/tool 全丢 | 比例制 retainRatio 0.16 | 脱水 + 九章节摘要 + **状态重注入**（文件/Plan/skill/工具声明重建） |
| 切点约束 | 第一条 ≠ toolResult（API 400 教训） | turn 边界 + split-turn，toolResult 禁止 | 窗口记账纪元（非 turn 切点概念） | tool-pairing balance（任意线不拆对） | — |
| 增量继承 | previousSummary 递归（提示词） | previousSummary + **details 文件清单结构化累加** | 摘要**不递归**（交接笔记身份） | 指令内合并 `<compacted-summary>` 单块 | 摘要不递归（同 codex） |
| 摘要请求缓存 | 独立请求（D1 决策，不划算） | **不进缓存**（cacheRetention:none + 新 sessionId） | 复用 client_session + **压缩中删最旧保前缀缓存** | **前缀复用**（不失效 KV cache） | fork agent + **共享 prompt cache 前缀** |
| 健壮性 | 失败降级拼贴 | overflow 恢复（删失败消息重试一次） | 远程失败换模型重试 + fallback prompt | durable 锁 + 稳定性检查 + 六类错误 | 熔断 + PTL 剥洋葱降级 |

**五句话总结**：
1. **人人都禁 toolResult 作切点**（我们/pi/DSH 三种实现强度，codex 用窗口纪元绕开）——API 契约是硬约束。
2. **保留什么 = 产品哲学**：pi 保原文尾（可靠）、codex 保用户消息尾（人话优先）、CC 保状态重建（工作台）、DSH 比例制、我们定长 N 条。
3. **增量摘要不递归是潮流**：pi 递归（摘要的摘要）、codex/CC 显式不递归（交接单不叠加）、DSH 指令内合并单块。
4. **缓存哲学两条路**：pi"摘要隔离不进缓存" vs codex/DSH/CC"压缩尽量不伤前缀缓存"——取决于主对话缓存值多少钱。
5. **零成本优先于摘要**：DSH 剪枝、CC 五段流水线、codex TokenBudget 全在往"不调模型就压缩"走，LLM 摘要是最后手段——这是我们的 B2.1 打磨方向。

---

## 四、对我们的启示（可迁移点，按性价比）

| # | 想法 | 来源 | 成本 | 收益 |
|---|---|---|---|---|
| 1 | compaction entry 补审计字段：被压消息 id 列表 + 摘要模型名（shadowedSeqs/CompactionDetails 思想） | pi details / DSH summary 事件 | 低 | 高：长期会话复盘"压掉了什么、谁写的摘要" |
| 2 | "摘要必须更小" fail-closed：估算摘要 token ≥ 被压区域 → 不落盘 | DSH region.ts:374-378 | 低 | 中：防模型抽风产出超长摘要 |
| 3 | tool-pairing balance 升级：把"第一条不是 toolResult"改成完整 balance 扫描 | DSH tool-pairing.ts | 中 | 高：多轮连续工具调用不再拆对 |
| 4 | 文件清单结构化累加：serializeConversation 顺手收集 read/modified，存 entry.details | pi CompactionDetails | 中 | 高：跨压缩文件图景不断（对齐远期 repo 地图） |
| 5 | 手动 /compact 传 focus 指令（摘要保留用户指定的重点） | Claude Code `/compact focus` | 中 | 中：对抗 bad autocompact |
| 6 | codex 的"旧摘要显式过滤、只垫最新一条"——我们 buildContext 是否也只取最新 compaction（已如此） | codex | 已满足 | 对照确认 |

**不抄的（记住为什么不抄）**：durable 锁/稳定性检查（无并发）、KV cache 前缀复用（D1 已决策）、错误六分类（降级策略更稳）、split-turn 前缀摘要（我们的会话树天然不劈轮次、可 switchLeaf 回退）、codex TokenBudget（无 world state 结构化存储）、五段成本流水线（我们的工具输出量级还没到）。

---

## 五、自检题（答得出才算读懂）

1. pi 的 split-turn 和"整轮切"差别在哪？为什么它能切穿轮次而不撕裂任务？
2. pi 的"增量摘要双通道"指什么？为什么文件清单要存结构化 details 而不是靠摘要文本？
3. codex 的 CompactionStrategy 三态是哪三态？memento 为什么只是其中一态？
4. codex 保留"真实用户消息 20k"和 pi 保留"原始 tail 20k"——本质区别是什么？（提示：assistant/tool 丢不丢、假设谁承载了状态）
5. 为什么 codex 说摘要"不递归叠加"、pi 却做 previousSummary 递归？两种哲学各自的前提是什么？
6. 我们现在的实现里，哪些点其实已经和某家"同源"了？（提示：toolResult 切点、compactionSummary 独立类型、只追加存储）
