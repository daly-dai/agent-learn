# pi vs 我们：会话机制与压缩机制对照

> 本文是 pi 源码精读后与本项目的逐项对照，回答"抄了什么、没抄什么、为什么"。
>
> 配套文档：
> - 源码精读：`doc/知识点-08-pi与codex-上下文压缩机制.md`
> - 分享材料：`doc/分享-压缩三家对照/01-会话机制.md` + `02-压缩机制-三家对照.md`
> - 施工记录：`doc/plan/b2-compaction.md`

---

## 一、会话机制：pi vs 我们

### 1.1 存储模型

| | 我们 | pi |
|---|---|---|
| **存储结构** | JSONL **树**（每行一个 `SessionEntry`，`id` + `parentId` 成树） | append-only **事件日志**（只有 append API，无删除） |
| **Entry 类型** | 4 种：`session` / `message` / `compaction` / `todo` | 7 种：`message` / `model_change` / `thinking_level_change` / `active_tools_change` / `compaction` / `branch_summary` / `custom` |
| **"当前在哪"怎么表示** | `leafId` 叶子指针（可移动到任意历史节点） | 最新 entry（线性末尾） |
| **多 Lane 支持** | 无（单分支） | 有（`session.view(lane)` 为非 main lane 返回独立视图） |

**核心区别一句话**：我们是树，pi 是纯日志。树能 `switchLeaf` 回退到任意历史分支；日志只能线性重放。

### 1.2 上下文重建

| | 我们 | pi |
|---|---|---|
| **方法** | `buildContext()` 从叶子沿 `parentId` 回溯到根 | `buildSessionContext()` 从最新 entry 回溯路径 |
| **遇到 compaction 怎么办** | 用 `compactionSummary` 消息替代旧消息，从 `firstKeptEntryId` 开始拼保留区 | 用 `defaultContextEntryTransform` 过滤——找到最新 `compaction` entry，只保留它和它之后的 entry |
| **逻辑本质** | 一样：都是"最新 compaction 摘要 + 其后保留条目" | 同左 |

两者在上下文重建的**效果**上几乎一致——都是"摘要替代旧消息 + 保留尾部消息"。差别在存储层：树 vs 日志。

---

## 二、压缩机制：pi vs 我们

### 2.1 触发条件

| | 我们 | pi |
|---|---|---|
| **触发阈值** | `tokens > contextWindow - reserveTokens`（约 984K） | 同公式，`reserveTokens = 16384` |
| **保留预算** | `keepRecentMessages = 8`（按**消息条数**） | `keepRecentTokens = 20000`（按 **token 数**） |
| **触发时机** | 1 处：pipeline 中 agent loop 结束后 `maybeCompact()` | 3 处：① agent 循环结束后 ② 发送新 prompt 前 ③ `prepareNextTurnWithContext` 钩子 |
| **触发类型** | 1 种：threshold | 3 种：`manual` / `threshold` / `overflow` |
| **overflow 恢复** | 无 | 有：检测到 context overflow 或 recoverable length 时，删失败消息 → 压缩 → 重试 |
| **防误触发** | 无（简单触发） | 有：换模型不算、旧 compaction 后的 usage 不算、aborted 消息跳过 |

**关键差距**：pi 有 `overflow` 触发和重试路径——模型返回"上下文超限"时自动压缩再重试；我们只有 threshold 一种。pi 的防误触发更完善。

### 2.2 切点规则

| | 我们 | pi |
|---|---|---|
| **约束** | 保留区第一条 **不能是 toolResult** | 切点回退到 **turn 起点**（user 消息） |
| **为什么** | 防孤儿 tool → DeepSeek 400 真实事故 | 保证 turn 语义完整，不腰斩对话 |
| **强度** | 单点防护 | 结构完整 |
| **效果** | 允许切在 turn 中间，只要不切出孤儿 tool | 永远不切穿 turn |

pi 还有 **split-turn** 机制：如果预算想切在 turn 中间，它会回退到 turn 起点保留，但把 turn 前缀单独生成一个 **turn prefix 摘要**，拼在历史摘要后面。我们没有这个设计。

**split-turn 的流程**（pi `compaction.ts` 第 731-762 行）：

```
1. findCutPoint 找到切点 → isSplitTurn = true（切点不在 user 消息上）
2. messagesToSummarize = 旧消息（turn 起点之前）
3. turnPrefixMessages = turn 起点到切点之间的消息
4. 两次调模型：
   a. generateSummaryWithUsage(messagesToSummarize) → 历史摘要
   b. generateTurnPrefixSummary(turnPrefixMessages) → turn 前缀摘要
5. 拼接：summary = historyText + "\n\n---\n\n**Turn Context (split turn):**\n\n" + turnPrefixText
```

### 2.3 摘要生成

| | 我们 | pi |
|---|---|---|
| **提示词** | 结构化 8 段（Goal / Constraints / Progress / Key Decisions / Files / Errors / Next Steps / Critical Context） | 结构化 6 段（类似但无我们的 Files/Errors 段） |
| **增量更新** | `previousSummary` 传入 `<previous-summary>` 标签 | 同——`previousSummary` + `UPDATE_SUMMARIZATION_PROMPT` |
| **文件追踪** | 无 | 有：`extractFileOpsFromMessage` 从 toolCall 提取 read/write/edit 的文件路径，存入 `CompactionDetails.readFiles` / `modifiedFiles` |
| **split-turn 摘要** | 无 | 有：`generateTurnPrefixSummary` 单独压缩 turn 前缀 |
| **扩展钩子** | 无 | 有：`session_before_compact` 扩展可以 cancel 压缩或提供自定义压缩结果 |

**文件追踪细节**（pi `utils.ts` 第 24-51 行）：

```typescript
// 从 assistant 的 toolCall 中提取文件操作
switch (block.name) {
  case "read":  fileOps.read.add(path);     break;
  case "write": fileOps.written.add(path);  break;
  case "edit":  fileOps.edited.add(path);   break;
}
```

压缩完成后，文件清单通过 `formatFileOperations()` 拼到摘要末尾，并存入 `CompactionDetails` 供后续查询。

### 2.4 压缩后模型看到的

| | 我们 | pi |
|---|---|---|
| **摘要身份** | 独立 `compactionSummary` 类型（不是 user） | 独立摘要类消息（`createCompactionSummaryMessage`） |
| **保留区** | 最近 N 条原文 | 最近 ~20k tokens 原文（`retainedTail` 内联拷贝） |
| **"摘要的摘要"** | 会（递归合并 previousSummary） | 会（递归） |
| **文件清单** | 无 | 有（`details.readFiles` / `modifiedFiles` 附在摘要末尾） |

### 2.5 压缩流程

两者的主流程完全一致（我们就是抄 pi 的）：

```
prepareCompaction() → 生成摘要 → appendCompaction() → buildContext()
```

差异在细节：

- pi 的 `prepareCompaction` 会找上一个 compaction entry 确定压缩边界，我们是直接从叶子回溯
- pi 的 `compact()` 有 split-turn 分支（两次调模型：一次历史摘要、一次 turn prefix 摘要）
- pi 有 `session_before_compact` 扩展点，允许 extension 接管压缩
- pi 的 `retainedTail` 是值拷贝（内联在 compaction entry 里），我们是指针引用（`firstKeptEntryId` 指向保留区起点）

---

## 三、总结：抄了什么、没抄什么、为什么

### 抄了

1. **存储只追加**：JSONL 只 append，删除靠读时过滤
2. **compaction entry 机制**：追加一个 entry 当新叶子，旧消息不删
3. **增量摘要**：`previousSummary` 递归更新
4. **结构化摘要 prompt**：Goal/Progress/Next Steps 的结构化模板
5. **切点 ≠ toolResult**：基本约束一致

### 没抄

| 项 | pi 有什么 | 我们为什么不做 |
|---|---|---|
| **split-turn** | 切穿 turn 后单独压缩前缀，拼在历史摘要后 | 我们的树结构天然不劈轮次，还支持 `switchLeaf` 回退分支，场景不需要 |
| **overflow 触发 + 重试** | 检测 API overflow → 自动压缩 → 重试 | DeepSeek 1M 窗口 + threshold 触发已经够用，overflow 恢复是成熟系统才需要的 |
| **文件追踪（details）** | 从 toolCall 提取文件操作清单 | 有价值但属于 A 类差距，已记在 `b2-compaction.md` 待办 |
| **扩展钩子（session_before_compact）** | 允许 extension 接管压缩 | 我们是单用户单会话，暂无 extension 体系 |
| **多 Lane** | main + 扩展 lane 独立视图 | 单分支够用，Phase 2 多会话走 `switchLeaf` 路线 |
| **按 token 保留** | 20k tokens 精确保留 | 8 条消息一眼看懂，先求可读 |
| **防误触发** | 换模型/aborted/旧 compaction 三重检查 | 单触发点 + 简单阈值，暂无复杂误触发场景 |

### 核心思路

**pi 是工程严谨打底，我们抄骨架（存储模型 + 压缩流程 + 增量摘要），细节（触发类型、切点规则、保留策略）按学习目标裁剪。**

---

## 四、源码位置速查

| 功能 | pi 路径 | 我们路径 |
|---|---|---|
| 会话类型 | `packages/agent/src/harness/session/types.ts` | `lib/types.ts` |
| 会话存储 | `packages/agent/src/harness/session/session.ts` | `lib/session/store.ts` |
| 上下文构建 | `packages/agent/src/harness/session/context.ts` | `lib/session/store.ts` (`buildContext`) |
| 压缩主逻辑 | `packages/agent/src/harness/compaction/compaction.ts` | `lib/session/store.ts` (`prepareCompaction` + `commitCompaction`) |
| 摘要 prompt | `packages/agent/src/harness/compaction/compaction.ts` (`SUMMARIZATION_PROMPT`) | `lib/summarize/index.ts` (`SUMMARIZATION_PROMPT`) |
| 文件追踪 | `packages/agent/src/harness/compaction/utils.ts` | 无 |
| 压缩触发 | `packages/coding-agent/src/core/agent-session.ts` (`_checkCompaction`) | `app/api/chat/_pipeline/compact.ts` (`maybeCompact`) |
| 手动压缩 | 同上（`reason: "manual"`） | `lib/commands/compact/index.ts` |
| 压缩配置 | `compaction.ts` (`DEFAULT_COMPACTION_SETTINGS`) | `lib/config/index.ts` |
