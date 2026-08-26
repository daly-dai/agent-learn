# B2 ③ LLM 结构化摘要 —— 四家方案对照与取舍（2026-08-25）

> 状态：**方案待确认**（用户拍板后开工）
> 性质：核心功能改造（上下文压缩是 harness 的"心脏"）——按用户规矩，先精读多家 → 对比 → 出方案 → 讲明白 → 确认后才动手。
> 精读范围（全部本地源码，非二手资料）：
> - **pi**：`packages/agent/src/harness/compaction/{compaction.ts, utils.ts}`
> - **codex**：`codex-rs/core/src/compact.rs`、`core/src/tasks/compact.rs`、`prompts/templates/compact/*.md`
> - **Reasonix**：`internal/agent/{compact.go, compact_fold_input.go}`（另见 compact_projection.go / compact_commit.go）
> - **DSH**：`packages/compaction/compaction-basic/src/summarizer.ts`、`packages/compaction/compaction/src/{index.ts, checkpoint.ts}`

---

## 一、背景：现在的问题

当前 `compactIfNeeded`（`lib/session/store.ts`）的摘要 = `summarizeEntries` 拼贴（`user: 原文` 连起来）：
1. **不省 token**：摘要≈原文，压缩形同虚设。
2. **不结构化**：模型看到流水账，没有 Goal / 进度 / 决策 / 下一步。
3. **多次压缩丢信息**：第二次压缩时旧摘要的"内容"会丢（需要增量更新机制）。

---

## 二、四家怎么做（精读结论）

### 2.1 pi —— 结构化摘要 + 增量更新（最"教科书"）

- **触发**：`contextTokens > contextWindow - reserveTokens`（阈值 = 窗口 - 预留，我们已对齐）。
- **摘要调用**：独立请求——`SUMMARIZATION_SYSTEM_PROMPT`（system）+ 一条 user（`<conversation>序列化文本</conversation>`）。
- **摘要格式**：**固定 EXACT 结构**（`## Goal / ## Constraints & Preferences / ## Progress / ## Key Decisions / ## Next Steps / ## Critical Context`）。
- **增量**：有 previousSummary 时用 `UPDATE_SUMMARIZATION_PROMPT`（"PRESERVE all existing information + ADD new"）——**四家里唯一的显式增量机制**。
- **保留**：`retainedTail` 存进 compaction entry（因为 pi **物理删除**被压消息，保留区必须存 entry 才能恢复）。
- **切点**：`findValidCutPoints` 排除 toolResult（孤儿 tool 防护）+ 按 keepRecentTokens 预算反向累计。
- **消息类型**：独立 `compactionSummary` role（前端能认出、渲染折叠卡片）。
- **附加**：文件操作列表（readFiles/modifiedFiles）附在摘要末尾。

### 2.2 codex —— 服务端压缩优先 + 本地 fallback（最"工程"）

- **触发**：`model_auto_compact_token_limit`（可配 token 阈值）+ 手动 `/compact`。
- **实现三分支**（`tasks/compact.rs`）：
  1. `RemoteCompactionV2`：**OpenAI 服务端 `/responses/compact`**——把会话交给服务端压缩，本地只拿回替换历史（仅 OpenAI 系 provider 支持）。
  2. `Remote`：旧版服务端压缩。
  3. `Local`：**本地压缩 = 把压缩 prompt 当一次普通 turn 跑流式**。
- **本地摘要格式**：`SUMMARIZATION_PROMPT` **很短、自由格式**（"Create a handoff summary... Be concise, structured"），不锁死 EXACT 结构。
- **压缩后历史**：`SUMMARY_PREFIX`（固定引导语："Another language model started to solve this problem..."）+ 模型最后一条输出 + **保留最近 user 消息原文**（`build_compacted_history_with_limit`，20K token 上限，从后往前选、超出截断）。
- **摘要识别**：伪装成 role:user，用 `SUMMARY_PREFIX` 前缀识别。
- **健壮性**：ContextWindowExceeded 时 `remove_first_item`（从开头删历史再试）；重试 + backoff；pre/post compact hooks；完整遥测。
- **要点**：压缩的**目的不是省 token 而是"换一个更小的上下文继续干活"**——所以它保留最近 user 消息原文（对话意图），而不是全压成摘要。

### 2.3 Reasonix —— 缓存对齐 + 经济性检查（最"省钱"）

- **触发**：`compactRatio = 0.80`（**窗口的 80%**，单一自动触发点；输出预算不参与触发）。
- **保留**：`recentTailBudgetRatio = 0.16`（**窗口的 16% 原样保留**，最近消息一字不改）。
- **经济性检查**（`foldEconomics`）：待压 region < 400 token 就不压——**省下的 token 不够抵消调摘要 API 的成本/延迟**。
- **摘要调用（缓存对齐）**：复用对话自己的 system/tools/消息前缀 + **追加压缩指令作为最后一条 user 消息**——让 provider 的 KV cache 命中（前缀缓存复用），而不是独立请求（cache miss）。
- **摘要格式**：`<compaction-summary>` 标签包裹 + 固定 headings（Standing facts & constraints / Goal / Decisions & rationale / Files & code / Commands & outcomes / Errors & fixes / Pending & next step）。
- **增量**：提示词里要求"Merge valid facts from any existing <compaction-summary>"（滚动合并旧摘要）。
- **token 校准**（`tokPerChar`）：从上一轮真实 usage 推导 token/字符比，不用本地 tokenizer。
- **防泄漏**（`summarizeToolArgs`）：工具参数只摘要成 `{key1, key2} (N keys)`，防止长参数（子代理 prompt）泄漏进摘要。
- **失败策略**：摘要失败**不编造**（"does not fabricate digest"）——宁可失败返回，不硬凑。

### 2.4 DSH —— 检查点格式 + 缓存对齐（最"产品化"，我们正在用它的格式）

- **抽象**：`CompactionEngine` 抽象服务，三接口——`compactIfNeeded`（自动）/ `compactNow`（手动）/ `compactRegion`（指定范围）；trigger = `'pressure' | 'context-overflow'`。
- **摘要调用（缓存对齐，与 Reasonix 同思路）**：复用对话的 system/tools/消息前缀 + `COMPACTION_INSTRUCTION` 作为最后一条 user 消息——注释明说"makes the auxiliary call a genuine prefix of the last routed request, so the provider's KV cache is reused"。
- **摘要格式（8 段检查点）**：`<compacted-summary>` 标签包裹：Primary Request and Intent / Key Technical Concepts / **Files and Code** / **Errors and Fixes** / Pending Jobs / Current Work / Next Step / Critical Context。
- **CHECKPOINT_PREAMBLE**："This is an automatically generated checkpoint condensing an earlier span..."——**这个对话的会话检查点格式就是 DSH 的**。
- **识别机制**：替换消息用 `compactCheckpointSource`（source: `{kind:'plugin', plugin:'compact'}` + compactionId）标记，比前缀匹配更可靠。
- **配对防护**：`toolPairingBalancedBefore/After` 显式检查工具调用配对平衡。
- **maxTokens 截断检测**：摘要被 token 上限截断 → 抛 `MAX_TOKENS` 错误（fail-closed，不落半截摘要）。

---

## 三、四家横向对比

| 维度 | pi | codex | Reasonix | DSH |
|---|---|---|---|---|
| 触发 | 窗口-预留（token） | 可配 token 阈值 | **窗口×0.80** | pressure / context-overflow |
| 摘要调用 | 独立请求 | 本地当 turn 跑 / 服务端压缩 | **缓存对齐**（复用前缀+追加指令） | **缓存对齐**（同左） |
| 摘要格式 | EXACT 结构（Goal/Progress/…） | 自由 handoff（很短） | 固定 headings + 标签包裹 | 8 段检查点 + 标签 + preamble |
| 增量更新 | **UPDATE prompt + previousSummary** | 无 | 提示词要求合并旧摘要 | 提示词要求合并旧摘要 |
| 保留策略 | retainedTail 存 entry（物理删） | 最近 user 消息原文（20K） | 窗口 16% 原样尾部 | 平衡配对范围替换 |
| 摘要消息类型 | 独立 compactionSummary role | 伪装 user + 前缀识别 | 伪装 user + 标签识别 | 伪装 user + source 标记识别 |
| 孤儿 tool 防护 | findValidCutPoints 排除 toolResult | — | tailStart 对齐回退 | toolPairingBalanced 显式检查 |
| 独有特性 | prepare/compact 分离、文件列表 | 服务端压缩、hooks、遥测 | **经济性检查**、tokPerChar 校准、参数防泄漏 | 检查点格式、preamble、截断检测 |

**共识（四家都做）**：压缩 = 调模型把旧对话重写成"交接单"；摘要伪装成 user 消息回上下文；toolResult 不能成为切点。

**分歧（我们的取舍点）**：
1. 摘要调用：独立请求（pi/codex 本地） vs 缓存对齐（Reasonix/DSH）——**成本与复杂度**的权衡。
2. 摘要格式：通用结构（pi） vs 工程检查点（DSH 的 Files/Errors 段）——**给 coding agent 用哪个更有用**。
3. 增量：显式机制（pi） vs 提示词软约束（Reasonix/DSH）——**可靠性 vs 简单**。
4. 保留：物理删+retainedTail（pi） vs 只追加不删（我们现状）——**存储模型决定答案**。

---

## 四、我们的取舍（每个决策讲为什么）

| # | 决策 | 选谁 | 为什么（教学点） |
|---|---|---|---|
| **D1** | **摘要调用：独立请求** | pi（不学缓存对齐） | 缓存对齐省的是 provider 的 KV cache 成本——DeepSeek 对教学项目不透明，且实现要"原样重放消息前缀"，复杂度高。**先跑通、格式对，二期再学省钱**。pi 的独立请求（system + 序列化文本）简单清晰、可单测。 |
| **D2** | **摘要格式：pi 结构为主 + DSH 两段** | pi + DSH 混合 | pi 的 Goal/Progress/Key Decisions/Next Steps 是通用交接结构；**加 DSH 的 Files and Code / Errors and Fixes 两段**——对 coding agent 特别有用（文件脉络 + 踩过的坑），我们项目天天用文件工具。 |
| **D3** | **增量更新：显式机制** | pi | 四家里只有 pi 是显式（UPDATE prompt + previousSummary 参数）。提示词软约束（Reasonix/DSH）模型可能不听话。**"长期记忆的维护模式"值得做对**。 |
| **D4** | **保留策略：不引入 retainedTail** | 我们现状（对齐 pi 思想） | pi 物理删消息所以要 retainedTail；**我们 JSONL 只追加不删**，保留区天然在文件里，`firstKeptEntryId` 定位即可。**设计跟着存储模型走，不抄表面**。 |
| **D5** | **切点：按条数 + toolResult 前移（已有）** | 我们现状 | 教学版简单规则先跑通；token 预算切点 = 二期（config 已留 keepRecentTokens 字段）。 |
| **D6** | **经济性检查：加** | Reasonix | 一行判断（待压 region token < 400 不压）——防止"为省 200 token 花一次 API 调用"。演示时调低阈值会频繁触发，这个检查保证压缩"值得"。 |
| **D7** | **工具参数防泄漏：加** | Reasonix | 序列化 toolCall 时把 arguments 摘要成 `{key1, key2} (N keys)`——防止长 JSON 参数（比如 bash 命令、长路径）泄漏进摘要。 |
| **D8** | **摘要失败：降级拼贴** | 我们现状（pi 返回错误） | pi 失败返回错误让上层处理；我们是教学项目，**压缩失败不能拖垮对话**——降级拼贴保信息。MOCK 模式同样走拼贴。 |
| **D9** | **maxTokens 截断检测：加** | DSH | 摘要被 token 上限截断 = 半截摘要（信息不全），DSH 会 fail-closed。我们检查返回文本非空即可（教学版简化）。 |
| **D10** | **文件列表附摘要** | pi details | 扫被压消息的 toolCall path 参数，附 `<read-files>/<modified-files>`——模型继续工作时知道碰过哪些文件（~30 行）。 |

**不做的**：codex 服务端压缩（DeepSeek 无此端点）、Reasonix tokPerChar 校准（二期，用 assistant usage 校准）、DSH 的 source 标记识别（我们用独立 role，更简单）、codex hooks/遥测（B5/C5 再做）。

---

## 五、改造方案（对齐 pi 的 prepare → generate → commit）

```
┌─ 准备（纯计算，store 内）─────────────────────────────┐
│ store.prepareCompaction(maxTokens, keepRecent)         │
│   → 找上一个 compaction entry                          │
│   → 选切点（toolResult 前移，已有逻辑保留）            │
│   → messagesToSummarize = 上一个压缩点之后 → 新切点     │
│   → previousSummary = 上一个 compaction.summary        │
│   → tokensBefore / firstKeptEntryId                    │
│   → 经济性检查：region < 400 token → 返回 undefined     │
│   → 返回 CompactionPreparation | undefined（不超限）    │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 生成（调模型，route.ts 内）───────────────────────────┐
│ generateSummary(model, prep, signal)                   │
│   → serializeConversation(messagesToSummarize)         │
│     · [User]/[Assistant]/[Assistant tool calls]/[Tool result]
│     · toolResult 截断 2000 字符（pi）                   │
│     · toolCall 参数摘要成 {key} (N keys)（Reasonix）    │
│   → 带 previousSummary 时用 UPDATE prompt（pi 增量）    │
│   → 模型失败 / MOCK 模式 → 返回 null（降级信号）        │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ 落盘（store 内）─────────────────────────────────────┐
│ store.commitCompaction(prep, summary)                  │
│   → 追加 compaction entry（成为新叶子）                 │
└───────────────────────────────────────────────────────┘
```

route.ts 组合：

```ts
const prep = store.prepareCompaction(threshold, keepRecent);
if (prep) {
  // 摘要失败/离线 → 降级拼贴（信息还在，只是不省 token）
  const summary = (await generateSummary(model, prep, signal))
    ?? summarizeEntries(prep.messagesToSummarize);
  await store.commitCompaction(prep, summary);
}
```

---

## 六、逐文件改动清单

| 文件 | 改动 |
|---|---|
| **`lib/summarize.ts`**（新建） | 提示词 ×3（SUMMARIZATION / UPDATE / SYSTEM）+ `serializeConversation`（含 toolResult 截断 + toolCall 参数摘要）+ `generateSummary`（降级返回 null） |
| **`lib/session/store.ts`** | `compactIfNeeded` → `prepareCompaction`（含经济性检查）+ `commitCompaction`；`summarizeEntries` 保留作降级 |
| **`lib/types.ts`** | 加 `CompactionPreparation` 类型（或放 sessionStore.ts 就近） |
| **`app/api/chat/route.ts`** | 2c 处改为三步：prepare → generateSummary（MOCK 降级）→ commit；传 abortController.signal |
| **`lib/summarize.test.ts`**（新建） | serializeConversation 各角色用例（截断/参数摘要）；generateSummary 用假模型验证 prompt 结构与增量分支 |
| **`lib/session/store.test.ts`** | 适配新 API：原 4 用例改为 prepare+commit；补"第二次压缩 previousSummary 携带""经济性检查不压"用例 |
| **`lib/mockModel.ts`** | 不改（generateSummary 在 MOCK 下根本不调它） |

---

## 七、验收标准

1. `tsc --noEmit` 通过；`pnpm test` 全绿（新增 summarize 用例 + 适配 sessionStore 用例）。
2. 长对话（调低阈值触发）压缩后：摘要文本是结构化 Markdown（## Goal / ## Progress / ## Files and Code / ## Errors and Fixes / …），不是 `user:/assistant:` 拼贴。
3. **信息链不断**：第二次压缩后，第一次摘要的 Goal / 关键决策仍在新摘要里（previousSummary 增量生效）。
4. 第一次压过的原文**不再出现在第二次摘要请求的输入里**（输入只含压缩点之后的消息）。
5. 摘要请求里：toolResult 超长被截断、toolCall 参数不泄漏完整 JSON。
6. MOCK_MODE 下长对话压缩：不崩、正常降级拼贴、页面仍显示压缩卡片。
7. 行为不回归：压缩触发时机/切点/孤儿 tool 防护与现在一致。

---

## 八、这个改造教会我们什么（教学点）

1. **多方案对照是选择的前提**：同一问题四家四种做法——独立请求 vs 缓存对齐、自由格式 vs EXACT 结构、显式增量 vs 提示词软约束。**没有唯一正确答案，只有取舍**。
2. **设计跟着存储模型走**：pi 物理删消息 → retainedTail；我们只追加 → firstKeptEntryId。抄思想不抄表面。
3. **压缩的目的不是省 token，是"换一个更小的上下文继续干活"**（codex 保留 user 消息原文的启发）。
4. **成本意识**：Reasonix 的经济性检查（不值得就不压）、缓存对齐（复用 KV cache）——harness 工程处处是成本权衡。
5. **纯计算与副作用分离**：prepare（切点/序列化/经济性）不碰模型就能单测；模型调用放产品层。
6. **降级是工程的一部分**：压缩失败不能拖垮对话，拼贴兜底保信息。

---

## 九、开工前待确认

- [ ] 方案本身（尤其 D1 独立请求 vs 缓存对齐、D2 格式混合、D3 显式增量、D4 不引入 retainedTail、D6 经济性检查、D7 参数防泄漏）
- [ ] 文档目录：本方案放 `doc/02-`（沿用现有 `doc/01-`），若你想要 `docs/` 目录我改名
- [ ] 确认后按 AGENTS.md：先 PLAN.md 补记 → 实现 → 展示 → 分批 commit
