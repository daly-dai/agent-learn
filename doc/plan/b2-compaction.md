# doc/plan/b2-compaction —— B2 真摘要压缩（施工补记）

> 来源：PLAN.md 第六章 Phase 1 后续优化 + 第十三节 B2 行 + "B2 真摘要压缩·实现前补记"段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交（2026-08-26，三步压缩定稿）**。
> 四家对照方案全文见 `doc/02-B2-LLM结构化摘要-改造方案.md`。

## 原 B2（最早规划）

compactIfNeeded 从拼贴升级为调模型生成结构化摘要（`## Goal / ## Progress / ## Key Decisions / ## Next Steps / ## Critical Context`）——抄 pi `compaction/compaction.ts`，复用 TeachingModel.complete。长在哪：`lib/session/store.ts` + `lib/summarize.ts`。

## 升级补记（2026-08-25，触发：多轮对话后页面渲染异常 + 孤儿 tool 400）

> 原 B2 只写了"拼贴 → 调模型摘要"。本次升级补三点：**摘要消息类型（修渲染）**、**切点不落在 toolResult（修 400，已实现于 `sessionStore.ts`）**、**LLM 结构化摘要 + retainedTail（对齐 pi）**。三家对照精读完毕。

### 症状与根因（本次触发）

1. **页面渲染奇怪**：`buildContext` 把 compaction 摘要合成一条 `role:"user"` 消息（`sessionStore.ts:231-241`），文本是 `"以下是旧上下文摘要...\n\nuser: ...\nassistant: ...\ntoolResult: ..."`（`summarizeEntries` 拼了 role 前缀）。前端 `message-row` 把它当**用户气泡**渲染 → 几轮后出现一大坨带 `user:/assistant:/toolResult:` 前缀的混乱文本。
2. **孤儿 tool 400**（已修）：切点落在 toolResult 上，它配对的 assistant toolCall 被压进摘要 → DeepSeek 400。已用 `while` 循环前移切点修复 + 单测（`lib/session/store.test.ts`）。

### 三家对照（精读结论）

| | pi | DSH | codex |
|---|---|---|---|
| 摘要消息类型 | **独立 role**：`compactionSummary`（`messages.ts createCompactionSummaryMessage`），有 `summary`/`tokensBefore` 字段 | 不截断上下文（持久化层不管窗口），靠前端折叠 | 独立 summary 记录，不冒充 user |
| 切点规则 | **`findValidCutPoints`（compaction.ts:312-344）：toolResult 不是合法切点**，user/assistant/bashExecution/custom 才是；按 token 预算反向累计选点 | —（无窗口压缩） | — |
| 摘要生成 | **LLM 生成**：`SUMMARIZATION_PROMPT`（Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context，compaction.ts:424-459），`generateSummary` 调模型；前次摘要传 `<previous-summary>` 增量更新 | — | 调模型生成摘要 |
| 保留策略 | **`retainedTail` 存进 compaction entry**（不是重建时临时算），cut 时 split turn 单独摘要前缀 | — | 保留最近 N 条 |

### 改造方案（三步，对应三个症状）

- **① 摘要消息类型（修渲染）**：`lib/types.ts` 新增 `role: "compactionSummary"` 消息类型（`{ summary, tokensBefore, timestamp }`）；`buildContext` 产出它而非 `role:"user"`；`deepseekModel.ts` `toOpenAiMessages` 把 compactionSummary 转成 user 消息（对模型仍是指令）；`message-row` 新增渲染分支（折叠卡片"旧上下文已压缩"，点开展示摘要）——**模型看到的是 user 指令，前端看到的是压缩卡片，互不干扰**。
- **② 切点不落 toolResult（已做）**：`compactIfNeeded` 切点前移 while 循环 + `lib/session/store.test.ts` 3 用例。
- **③ LLM 结构化摘要（对齐 pi）**：`compactIfNeeded` 从 `summarizeEntries`（拼贴）升级为调 `TeachingModel.complete` 生成 pi 同款结构化摘要；`retainedTail` 存进 compaction entry（可选，二期）。
- **④ 压缩阈值配置化（2026-08-25 增补）**：原 `compactIfNeeded(4000, 8)` 是教学随手值（4~5 轮就压，浪费 DeepSeek 1M 窗口）。已建 `lib/config.ts`（全项目配置唯一入口）：provider 结构可扩展（每厂商自带 contextWindow/reserveTokens/keepRecent），触发对齐 pi `shouldCompact`（`contextTokens > 窗口 - 预留`）。DeepSeek V4 默认 1M 窗口，几十上百轮才触发；换厂商 = `AI_PROVIDER` 换 key + config 加一项。**注意：阈值随 provider 走，不同家窗口不一样（如 Anthropic 200K / OpenAI 128K）**。

**涉及文件**：`lib/types.ts`（新消息类型）、`lib/session/store.ts`（buildContext 产出 compactionSummary + compactIfNeeded 摘要生成）、`lib/deepseekModel.ts`（转换）、`lib/message.ts`（构造函数）、`app/components/message-row/`（渲染分支）、`lib/session/store.test.ts`（补用例）。

**验收**：多轮对话（>8 条 + 超 4000 token）后触发压缩，页面不出现"user: 摘要"大块文本而是折叠卡片；`tsc --noEmit` 通过；`pnpm test` 全绿；MOCK_MODE 下 `TeachingModel.complete` 降级为拼贴（无 key 不崩）。

> 注：①②是必做（修当前 bug），③是 B2 正题（对齐 pi）。①完成即解"渲染奇怪"；③单独一批 commit。

## B2 ③ 实现定稿（2026-08-25，四家精读后拍板）

> 用户要求：核心功能改造必须多方案对照（pi/codex/Reasonix/DSH 四家源码精读）→ 讲透取舍 → 确认后才动手。已确认开工。

**四家结论（一句话）**：pi 独立请求+显式增量（最教科书）；codex 服务端压缩+保留 user 原文（最工程）；Reasonix 缓存对齐+经济性检查（最省钱）；DSH 缓存对齐+8 段检查点格式（最产品化）。共识：压缩=调模型重写交接单；摘要伪装 user 回上下文；toolResult 不能当切点。

**决策（用户已确认）**：
- D1 摘要调用**独立请求**（不学缓存对齐：复杂度换钱不划算，DeepSeek cache 不透明）
- D2 格式 = **pi EXACT 结构 + DSH 的 Files and Code / Errors and Fixes 两段**（coding agent 刚需）
- D3 增量更新**显式机制**（pi UPDATE prompt + previousSummary，四家最可靠）
- D4 **不引入 retainedTail**（我们 JSONL 只追加不删，firstKeptEntryId 定位即可）
- D6 经济性检查（Reasonix：待压 region < 400 token 不压）
- D7 工具参数防泄漏（Reasonix：arguments 摘要成 `{key} (N keys)`）
- D9 截断检测（DSH：摘要非空检查，fail-closed）
- 不做：codex 服务端压缩（DeepSeek 无端点）/ tokPerChar 校准（二期）/ source 标记（独立 role 更简单）/ hooks 遥测（B5/C5）

**改动**：新建 `lib/summarize.ts`（提示词×3 + serializeConversation + generateSummary 降级 null）；`sessionStore.ts` compactIfNeeded → `prepareCompaction`（含经济性检查）+ `commitCompaction`；`types.ts` 加 `CompactionPreparation`；`route.ts` 三步组合（MOCK 降级拼贴）；新增 summarize.test.ts + 适配 sessionStore.test.ts。

**验收**：tsc + pnpm test 全绿；压缩后摘要为结构化 Markdown（含 Files/Errors 段）；第二次压缩 previousSummary 携带（信息链不断）；MOCK 降级拼贴不崩；切点/孤儿 tool 防护不回归。

## 2026-08-26 实测修复（收尾）

- 压缩前推 `{type:"compacting"}` SSE 帧（调模型生成摘要耗时几秒~几十秒，期间 SSE 无帧，前端会以为卡死）→ 前端提示条「上下文超出上限 正在压缩上下文，请稍候…」。
- 压缩卡片展开 `<pre>` → `<Markdown>`（摘要的 `## Goal` 等 Markdown 结构正确渲染）。
- 路线 A 定案：压缩后前端**不展示被压原文**（与 pi/DSH 一致；数据都在 JSONL，以后随时可改）。
- env 测试口子：`CONTEXT_WINDOW`（默认 1_000_000）/ `MIN_COMPACT_TOKENS`（默认 400）/ `KEEP_RECENT_MESSAGES`（默认 8）。

## 升级补记（2026-08-27，触发：DSH 压缩系统走读——精读走读 24）

> 原 B2 三步定稿 ✅ 已实现（2026-08-26）。本次精读 DSH `packages/compaction/*` 四包（`command-compact` 命令 / `compaction` 接口层 / `compaction-basic` 实现层 / `tool-result-pruner` 剪枝）后定位：**我们 = MVP 可用版，DSH = 工业成熟版；核心决策逐条同源（压老留新 / 切割不拆工具对 / LLM 结构化摘要 / 旧数据保留），差距分两类——A 类真差距（通用质量，值得打磨）×3，B 类场景差异（单会话单用户用不上，不抄）**。

### A 类：打磨清单（条件触发，不做不崩）

| # | 打磨项 | 现状 | 参考（DSH） | 触发时机 | 成本 |
|---|---|---|---|---|---|
| ① | compaction entry 补审计字段：被压消息 id 列表（shadowedSeqs 思想）+ 生成摘要的模型名 | 只有 summary / firstKeptEntryId / tokensBefore | `region.ts:447-461`（compaction/summary 事件） | 开始做长期会话复盘时 | 低 |
| ② | "摘要必须更小" fail-closed：framed summary 估算 token ≥ 被压区域 → 不落盘 | 只有"待压区域太小不压"（经济性检查） | `region.ts:374-378` | 下次动 compact.ts 时顺带 | 低 |
| ③ | tool-pairing 平衡升级：切割线 balance 扫描（assistant toolCall +1 / tool/result -1，balance==0 才可切）替代"保留区第一条不能是 toolResult"单点修正 | 单点修正（store.ts:212-225） | `tool-pairing.ts`（131 行，可整抄思路） | 亲眼看到孤儿工具坑 / 写复现测试时 | 中 |

### B 类：不抄（记住为什么）

durable 锁 + 稳定性检查（无并发，前端阻塞提示兜底）、KV cache 前缀复用（D1 已决策"复杂度换钱不划算"）、影子价格/影子价格事件（无计费消费方）、错误六分类 ManualCompactionError（我们降级策略更稳）、CompactionEngine 接口抽象（单一实现）。**打磨只打 A 类；B 类等场景变了（多会话并发 / 计费）再拿出来。**

> 完整对比见 `workspace/精读走读-24-DSH-压缩对照.md`（八节 + 自检题 + 施工单）。
