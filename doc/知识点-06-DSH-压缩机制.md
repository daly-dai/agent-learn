# DSH 上下文压缩机制：源码精读（compaction 四包）

> 精读对象：DSH（DeepSeek Harness）`packages/compaction/` 四个包 + `packages/core/session/src/surface.ts`，2026-08-27。
> 配套：`workspace/精读走读-24-DSH-压缩对照.md`（我们 vs DSH 逐点对照 + 施工单）、`doc/知识点-03-上下文压缩.md`（我们自己的压缩实现）。
> 本文回答：**DSH 的压缩到底是怎么实现的**——从触发到替换的完整机制；含会话架构（session/surface/增量折叠/持久化/fork）与 KV cache 深水区（system+tools / 前缀命中 / sessionId / purpose）。

---


## 一、三种触发路径

| 触发 | 钩子 | 逻辑 |
|---|---|---|
| **自动·压力（pressure）** | `agent/pre-step` 钩子，每步开始前 | 取最近路由请求的 provider/model → 查模型 context window → `thresholdTokens = window × 0.8`（默认）→ 超了就压 |
| **自动·溢出（context-overflow）** | `agent/request-error` 钩子 | 模型报 `CONTEXT_WINDOW_EXCEEDED_CODE`（明确超窗）→ **绕过阈值强制压缩** → 返回 `{ kind: 'retry' }` 让这步重试 |
| **手动（`/compact`）** | 命令 → `compactNow` | `agent.runMaintenance(...)`（要求 agent idle）→ 选区 → 压缩事务 |

自动触发注册在 `compaction-basic/src/index.ts:137-224`（`_registerAutomaticCompaction`）。

---

## 二、核心算法：选哪段、怎么切

选区在 `region.ts` 的 `selectCompactableRange`（98-134 行）：

```
从尾部往前累计 token，直到 >= retainTokens（默认 contextWindow × 0.16）
        ↓
得到 keepFromIdx（要"原样保留"的最近尾部）
        ↓
往前找第一个 tool-pairing 平衡的切割点（不能拆散 tool-call/result 对）
        ↓
返回 [surface 第一个节点, 切割点] —— 即"压缩最老的头部，保留最近的 16%"
```

三个关键设计：

### 2.1 头压缩 + 尾保留

压缩永远发生在**最老的历史**上——总结成 checkpoint 后仍保持会话前缀的连续性，新消息永远追加在后面。

### 2.2 tool-pairing 平衡（不能拆散工具调用对）

对话里有"模型说我要调工具A → 工具返回结果"这种**一对一对**的结构。surface 上每个"切割线"都有一个 balance：

- `assistant/message` 里每个 tool-call 块 **+1**
- `tool/result` **-1**
- balance ≠ 0 的切割线 = 有"悬空调用" → **不能切**

如果切在"调用和结果"中间，结果丢了，模型恢复后不知道工具干了啥。实现见 `tool-pairing.ts`（131 行）：balance 数组按 surface generation 增量缓存，避免每次全量重算。

### 2.3 总结必须真的更小（保险丝）

总结帧（带 preamble 和标签）的估算 token **必须严格小于**被替换内容（`region.ts:374-378`），否则直接报错——防止压缩反而膨胀。

---

## 三、压缩事务：锁 + 日志 + 替换

`compactSurfaceRegion`（`region.ts:152-254`）是整个事务的骨架，**顺序极其讲究**：

```
校验范围（存在、顺序、两端 tool-pairing 平衡）
  → 检查锁（有未闭合的 compaction/start = busy）
  → append compaction/start          ← durable 锁，此时才允许 yield（异步）
  → prepareCompaction                ← 重新定价被替换区间 + 构建总结输入
  → summarizeCompaction              ← 调 LLM（此处异步，可能被中断/取消）
  → 稳定性检查（surface 变没变？）
  → append compaction/summary        ← log-only 事件，记录总结内容/影子价格
  → append user/message (replace)    ← 真正的 surface 替换！带 compactCheckpointSource
  → append compaction/end            ← 释放锁
  → flush()（手动路径）              ← 持久化 checkpoint
```

这里有个非常微妙的设计：**`compaction/start|summary|end` 三个事件都是 log-only（不进 surface）**，真正改写会话表面的是紧跟 `compaction/summary` 之后的那条 `user/message` 替换事件（`surfaceOp: { op: 'replace', start, end }`）。理由：

1. **锁是 durable 的**：`compaction/start` 落进会话日志，进程崩溃后重放日志还能认出"有未完成的压缩"，不会并发跑两个。
2. **可审计可重建**：总结的输入（shadowedRange/shadowedSeqs）、用的 provider/model、token 用量全记在 `compaction/summary` 里——"哪个模型写了这个总结"有持久答案。
3. **shadow-price 协议**：替换事件本身不标价，价格由紧贴它前面的 `compaction/summary`（或 `compaction/prune`）事件声明——纯消费者（记账/计费）不用保留每个节点的单价就能扣账。

替换消息的来源标记是 `compactCheckpointSource(compactionId, sourceCommandId)`（`checkpoint.ts`），带 `kind: 'plugin', plugin: 'compact'` 标记，持久化后靠 `isCompactCheckpointSource` 识别——"这是压缩产生的检查点"与具体后端实现解耦。

**稳定性检查有两档**（`region.ts:387-424`）：
- 自动路径：要求**整个 surface** 不变（`assertWholeSurfaceUnchanged`）
- 手动路径：只要求**选中区间**不变（`assertSelectedSpanStable`）——因为手动压缩期间用户可能还在别处产生新消息

---

## 四、总结怎么生成：KV cache 复用

`summarizer.ts` 是最有技巧的部分。它**不**用单独的"总结系统提示词"，而是：

```
把会话自己的 system prompt + tools + 被压缩区间的消息原样回放
  + 追加一条 user message：压缩指令（COMPACTION_INSTRUCTION）
```

这样这次辅助 LLM 调用就是"最后一次路由请求的**真前缀**"——**提供商的 KV cache 不会失效**（只有最后那条指令是新的，省一次完整重算）。

指令要求输出固定结构的 Markdown（Primary Request / Key Technical Concepts / Files and Code / Errors and Fixes / Pending Jobs / Next Step…），且明确要求"如果已有 `<compacted-summary>` 块就**合并而非照抄**"——多次压缩后总结还是单块，不叠床架屋。总结外面再包：

- `CHECKPOINT_PREAMBLE`："这是自动生成的检查点，当作既定背景直接继续干活，不用复述"——让模型不把检查点当普通对话
- `<compacted-summary>` 标签

输出还有 fail-closed 校验：摘要含图片 → 拒绝（`UNSUPPORTED_CONTENT`）；无文本 → 报错。

---

## 五、免模型剪枝（可选阶段，零成本）

`compactIfNeeded` 在走 LLM 总结前，先看有没有 `ctx.toolResultPruner`（`compaction-tool-result-pruner`）。如果有，先做**零成本的 tool-result 剪枝**：

- 超过阈值（默认字符数）的 tool/result 文本：保留 head/tail、截掉中间、插入剪枝标记
- 每个替换前发一条 `compaction/prune` 影子价格事件
- 剪完重新计量，**低于阈值就直接收工，不调模型**；否则再进 LLM 总结
- 溢出恢复路径（context-overflow）则**强制**先剪枝

实现见 `compaction-tool-result-pruner/src/index.ts:136-184`（`pruneSession`）。

---

## 六、手动路径的错误分类

`compactNow` 把失败分成 6 类（`ManualCompactionErrorCode`，`compaction/src/index.ts:28-34`），`command-compact` 逐条翻译成用户能看懂的话（`command-compact/src/index.ts:23-55`）：

| code | 含义 | 用户看到的文本 |
|---|---|---|
| `busy` | agent 不空闲 / 锁被占 | 压缩不可用：进程正有活动压缩，或 agent 不空闲 |
| `cancelled` | 用户取消 | 压缩已取消 |
| `changed` | 总结期间 surface 变了 | 对话在压缩期间变了，未改动，尝试已记录 |
| `summary` | 总结失败或没变小 | 无法生成有用摘要，对话未改动 |
| `commit` | 提交阶段失败 | 压缩未干净结束，检查当前状态再重试 |
| `persistence` | flush 失败 | 压缩完成但会话未能保存 |

---

## 七、一句话总结

> **用一次 KV-cache 友好的 LLM 调用，把最老的、配平了工具调用的那段历史总结成一个带标记的 checkpoint 消息，通过 `compaction/start→summary→end` 三个日志事件做 durable 锁和审计，用 shadow-price 事件做记账，全程保证总结必须更小、切割绝不拆散工具调用对。**

拆开看就是：

1. **触发**：自动（压力 / 溢出）+ 手动（`/compact`，要求 idle）
2. **选区**：压最老的、保留最近的 16%、切割线 tool-pairing 平衡
3. **总结**：回放前缀蹭 KV cache + 固定格式检查点 + 必须更小
4. **事务**：`compaction/start` 落锁 → 调模型 → 稳定性检查 → `summary` + `user/message replace` 落地 → `end` 解锁
5. **记账与审计**：log-only 事件 + shadow-price，全程可回放可查账

---

## 八、会话架构基础：session 与 surface（压缩操作的对象）

### 8.1 关系：surface 是 session 的一个属性

`packages/core/session/src/index.ts:425-433`：

```ts
export class Session {
  private log: SessionEvent[] = []                       // 事件日志（真相）
  private readonly surfaceManager = new SurfaceManager(this.log)  // 视图管理器，构造时拿到 log
  get surface(): SessionSurface { return this.surfaceManager }    // session.surface 就是它
}
```

- **session = 容器**：持有 append-only 事件日志（log）+ 各种状态
- **surface = session 的一个只读属性**：从日志实时折叠出来的"模型可见节点视图"
- **日志是真相，surface 只是投影**：被 replace 遮蔽的旧节点从视图消失，日志原封不动

读写两条路径：

```
写：session.append(事件) ──► ① 进 log（真相，永不删）
                        └─► ② surfaceManager.validateNext（校验 + 计划更新）
读：deriveMessages() ──► surface.nodes（可见 seq 列表）──► log[seq] 投影成消息
```

### 8.2 增量折叠 + 惰性更新（surface 什么时候变）

SurfaceManager **维护状态**（nodes 数组 + replaceGeneration + `_lastProcessedSeq`），不是每次全量重放：

- **增量**：只折叠"上次处理位置之后新增"的事件（`_processDelta`，surface.ts:444-459）——O(新增)，不是 O(全部)
- **写时只校验**：append 内部调用 `validateNext`（index.ts:634）——验证事件合法（surfaceOp 形状、sourceEventSeqs 覆盖、替换范围有效），**坏事件在 append 处就抛错**（fail-fast），但**不动视图**
- **读时惰性应用**：访问 `surface.nodes` / `replaceGeneration` / `deriveMessages()` 时，发现 log 比上次处理位置多事件，才 `_processDelta()` 折叠应用

```
append(user/message, {...}, { surfaceOp: replace })
  ├─ validateNext(event)   ← 只校验（此时视图不变！）
  ├─ log.push(event)       ← 进内存日志
  └─ 发 session/event      ← 持久化插件写文件
  ...
  deriveMessages() / surface.nodes
  └─ _processDelta()       ← 惰性应用：视图这才变
```

所以压缩事务里那串 `append(start)→append(summary)→append(replace)→append(end)` 全都只做校验，真正让视图变化的是事务之后第一次有人读 surface。

### 8.3 内存 vs 持久化（重启从哪拿数据）

- **运行中**：append → 内存 log → 发 `session/event` 事件 → **持久化插件**（session-persistence-jsonl / sqlite）订阅事件，把事件**追加写进磁盘文件**（JSONL 每会话一个文件，支持 zstd 压缩）
- **重启后**：从磁盘文件读回全部事件 → 作为 `seed` 构造新的 Session（`create(id, { seed })`，"Seeding with an existing event log **replays**/forks a session"）→ SurfaceManager **首次访问时全量折叠一次**，之后恢复增量
- **"全在内存"说的是运行期读写路径不走文件**；文件是事件日志的落盘拷贝。电脑重启也不怕，文件在磁盘上

对照我们：你们 `store.ts` 的 `appendEntry` 同步写文件——同一思想，只是 DSH 把"内存工作态（Session）"和"落盘（persistence 插件）"拆成两层、异步批量写；你们合在一个类里同步写。

### 8.4 分支：fork（线性日志怎么表达分叉）

DSH 的日志是线性 append-only，一个会话里装不下"两条未来线"，所以分支被建模成"新建会话"：

```ts
fork(source, boundary?, childSessionId?)   // index.ts:1081
```

- `boundary` = 源会话的一个事件 seq（不传 = 最后一条）
- 校验：boundary 必须存在且连续、**不能切在 open turn 中间**（`OPEN_TURN`，和 tool-pairing 同一思想家族：边界完整性）
- 把 `events.slice(0, boundary + 1)` 复制为种子 → 创建**全新独立子会话**，header 记 `parentSession` + `seedLength`（谱系）

| | 我们（switchLeaf） | DSH（fork） |
|---|---|---|
| 分支形态 | 树 + 指针：一个存储，指回历史节点原地继续 | 线性日志 + 复制：克隆出新会话独立演化 |
| 谱系 | parentId 链 | header 的 parentSession + seedLength |
| 为什么 | 存储是树（JSONL + parentId） | 日志是线性 append-only |

**关键推论（回答"压缩会不会造成分支问题"）**：日志保留一切 + fork 复制前缀 → **fork 到压缩前的 seq，就能克隆出一个"压缩前状态"的新会话**——被压的历史从日志里原样复活。同一会话实例里 surface 单向不可逆；但在会话创建层面，历史完全可重建。

---

## 九、KV cache 原理（深水区：压缩为什么能省钱）

### 9.1 一次请求的三部分：system + tools + messages

发给模型（DeepSeek/OpenAI/Claude）的每次请求：

```
system:  "你是一个编程助手，遵循以下规则…"     ← ① 人设 + 规则（固定头部）
tools:   [read 定义, write 定义, bash 定义]    ← ② 工具清单 JSON Schema（固定头部）
messages: user/assistant/tool 对话流水账        ← ③ 对话记录
```

- **system**：给模型的"人设 + 规则"，不属于任何一条消息
- **tools**：告诉模型"你可以调用这些函数"（名称 + 参数结构 + 用途）
- **模型没有记忆**：每次请求都从零看一遍完整输入——这就是为什么对话越长越慢越贵，也是压缩存在的理由

### 9.2 Transformer 为什么需要缓存：注意力与 K/V

LLM 是 decoder-only Transformer，核心是**因果注意力**：处理每个新 token 时，要让它与**前面所有 token** 建立关联。每个 token 算出三个向量 **Q（查询）、K（键）、V（值）**——注意力 = "用我的 Q，去前面所有 token 的 K 里找谁跟我相关，加权取 V"。

**关键**：输入 token 的 K、V 一旦算出就是固定的（它们是"被看"的一方，不因后面来了新 token 而变）。所以：

> **KV cache = 把输入前缀里每个 token 的 K、V 缓存下来。** 下次请求前缀相同，直接复用，不用重算。

类比"笔记"：同一本书的同一段，第二次看不用重记笔记。

### 9.3 为什么必须按前缀：两个原因

1. **顺序累积**：K/V 按 token 顺序排成一串，新 token 追加在末尾——只能从开头**连续**复用
2. **中间改动 = 后面全部失效**：token 的表示依赖前面所有 token（通过注意力）。前缀中间某个 token 变了 → 它后面每个 token 都"看过"它 → 表示全变 → **从改动点往后缓存全部作废**

```
前缀命中：system+tools+被压消息 ✅ + 新指令 ← 只算这一小截
           └── 复用缓存，零重算 ──┘

前缀破坏：system+【改了一个字】+被压消息 ❌ + 新指令
                   └── 从改字处起，后面全部重算 ──┘
```

**"必须原模原样"不是洁癖，是缓存按字节匹配、一改全断。**

### 9.4 为什么"只取前 100 条"能命中"200 条的缓存"：因果注意力

缓存里存着 200 条（完整请求）的 K/V，总结请求只发前 100 条 + 指令——怎么对得上？答案在因果注意力的性质：**token i 的表示只依赖它前面的 token（1..i），不依赖后面的。**

- 完整请求（200 条）缓存里，"前 100 条部分的 K/V" = 只依赖 system+tools+前 100 条
- 总结请求（前 100 条 + 指令）里，前 100 条的 K/V = 也依赖 system+tools+前 100 条
- **两边前缀逐字节相同 → 前 100 条的 K/V 一模一样 → 直接复用**

所以"截取开头一段 + 追加新指令"天然支持前缀命中——**分叉点越靠后，缓存复用越多**。这也是为什么 DSH 把总结指令放在最后一条消息而不是中间：指令插中间 = 分叉点提前，后面的消息全部不算前缀。

### 9.5 数字感受

假设对话 500k token、被压区域 400k：

| | 无缓存命中 | 缓存命中 |
|---|---|---|
| 总结请求要算的 | ≈400k token 全量重算 | 只算最后几十 token 的指令 |
| 时间量级 | 秒级~十几秒 | 毫秒级 |

### 9.6 sessionId 与 purpose（"身份" vs "用途"）

**sessionId**（`llm/src/types.ts`）：
> *"Session identity stamped by the loop for request routing. Replay uses it to separate cursors; adapters may map it to model-hidden transport metadata."*

DeepSeek 适配器把它映射成自定义请求头（`llm-deepseek/src/adapter.ts:526-527`）：

```ts
{ 'x-deepseek-harness-session-id': String(options.sessionId) }
```

**分工**：前缀一致 = 匹配"缓存内容"（这段我算过）；sessionId = 标识"会话身份"（去哪个缓存区找）。类比：前缀 = 书的内容一样；sessionId = 借书卡号，管理员知道去哪个柜子取笔记。**书不对，卡号再准也没用。**

**和无状态 API 不矛盾**：无状态 = 对话内容（messages）必须每次全量重发（正确性）；sessionId = 客户端**自愿**提供的缓存优化提示（只为提速，服务端可无视）。另外 `x-deepseek-harness-session-id` 是 DSH **自己定义**的头，服务端认才有用——这也是 D1 决策里"DeepSeek cache 不透明"的机制根源。

**purpose**：标注"这次调用的用途"（`'compaction' | 'session-title'`），适配器据此调策略（如 `serialize.ts:82`：起标题关 thinking）。**sessionId 说"我是谁"，purpose 说"我来干嘛"。**

### 9.7 对照我们项目：D1 决策的机制层面

我们的总结请求（`lib/summarize.ts`）三处让缓存必然不命中：
1. 用了**自己写的** `SUMMARIZATION_SYSTEM_PROMPT`（"You are a context summarization assistant..."），不是原对话的 system
2. 消息序列化成 `[User]: ...` 纯文本，和原请求的消息格式不同
3. `TeachingModel.complete` 没有 sessionId/purpose 字段，请求无缓存关联提示

所以 D1 决策（"不学缓存对齐"）的完整含义：**为了蹭缓存，总结请求必须完全复刻原请求的组装方式（system 来源、消息格式、sessionId），这套对齐逻辑在 DeepSeek 上收益不透明，不如独立请求简单直接**——不是不会，是算过账后不划算。

---

## 十、自检题（答得出才算读懂）

1. `command-compact` 在四包里扮演什么角色？真正的实现在哪？（提示：接单员 vs 工人）
2. 为什么压缩永远发生在"最老的历史"而不是中间？（提示：前缀连续性）
3. tool-pairing 平衡检查防的是什么事故？（提示：悬空工具调用）
4. `compaction/start/summary/end` 为什么是 log-only？真正替换 surface 的是哪个事件？（提示：锁的持久性 / replace 事件）
5. "总结必须更小"检查解决什么问题？（提示：压缩反而膨胀）
6. KV cache 复用是怎么做到的？（提示：真前缀 + 最后加指令）
7. 六类错误码里，`changed` 和 `summary` 的区别？（提示：surface 变了 vs 摘要不行）
8. surface 和 session 是什么关系？为什么 replace 是"遮蔽"不是"删除"？（提示：视图 vs 真相）
9. "增量折叠 + 惰性更新"分别指什么？append 时视图变吗？（提示：写时校验 / 读时应用）
10. 会话重启后 surface 怎么恢复？有没有持久化的"索引文件"？（提示：seed 全量折叠一次）
11. DSH 的 fork 和我们的 switchLeaf 本质区别？压缩过的会话还能 fork 回压缩前吗？（提示：复制新会话 vs 指针切换 / 日志保留一切）
12. 一次 LLM 请求的 system/tools/messages 各是什么？为什么说模型"没有记忆"？（提示：每次全量重发）
13. KV cache 为什么必须按前缀匹配？中间改一个字会怎样？（提示：因果注意力 / 一改全断）
14. sessionId 和前缀各负责什么？"无状态 API"和 sessionId 矛盾吗？（提示：内容匹配 vs 缓存区定位 / 正确性 vs 优化提示）
