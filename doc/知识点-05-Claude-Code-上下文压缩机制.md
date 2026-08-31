# Claude Code 上下文压缩（auto-compact）机制：一手资料调研

> 调研课题：各家 agent 压缩方案对比 —— Claude Code（Anthropic CLI agent）分册。
> 目的：抓**机制与设计意图**，输出结构化学习笔记。所有结论注明来源 URL。
> 调研日期：基于当前官方文档（2026 版，含 v2.1.x 变更、Sonnet 5 时代）+ 源码分析（2026-01 前后）。
>
> 一手来源：
> - 官方文档《Explore the context window》 https://code.claude.com/docs/en/context-window
> - 官方文档《Model configuration》（auto-compact window / 阈值） https://code.claude.com/docs/en/model-config
> - 官方文档《Prompt caching》（压缩的缓存代价） https://code.claude.com/docs/en/prompt-caching
> - 官方博客《Using Claude Code: session management and 1M context》 https://claude.com/blog/using-claude-code-session-management-and-1m-context
> - 官方环境变量表 https://code.claude.com/docs/en/env-vars ；CLI 参考 https://code.claude.com/docs/en/cli-reference ；命令参考 https://code.claude.com/docs/en/commands
> - 源码分析（第三方）《第八章：Context 上下文管理机制》 https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md
> - 知乎《横向拆解 Claude Code、Codex 等六大 Agent 上下文压缩策略后，我们做了第 7 个》 https://zhuanlan.zhihu.com/p/2047337481255884504
>
> 注意：文档/源码处于快速演进期（v2.1.x、模型换代），数值以"设计机制"为主、具体数字会变。

---

## A. 触发机制：阈值多少、什么时候触发

**一句话**：Claude Code 不是"撞墙才压"，而是**预留预算 + 提前缓冲**的主动压缩；阈值可配置（默认随模型走）。

### A1. 默认阈值（官方《Default auto-compact thresholds》）
不设置任何 auto-compact 窗口时，默认在**对话到达模型上下文上限时**压缩，例外按模型分：
- **Sonnet 4.6 / Opus 4.6**（无扩展上下文）与以 200K 窗口运行的 Opus 4.8/Opus 5（如 Bedrock、Vertex、Foundry 上）：在 **200K 边界**压缩。
- **Sonnet 5**：原生 1M 窗口，默认在 **~967K tokens** 触发（changelog v2.1.246：从 ~934K 改为 ~967K）。
- **`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`**：把原生 1M 的模型（Sonnet 5 / Fable 5）按 200K 处理，压缩也发生在 200K 边界。
- **LLM gateway 别名等无法识别的模型 ID**：按 Claude Code 假定的窗口压缩（可用 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 修正；`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 则取消主动压缩，只在 API 真正拒绝超长后才恢复）。
- 来源：[model-config#default-auto-compact-thresholds](https://code.claude.com/docs/en/model-config)、[context-window](https://code.claude.com/docs/en/context-window)、llms-full.txt（changelog 2.1.246）

### A2. 触发时机与"有效窗口"（源码分析，Claude 3 系时代的设计骨架）
源码分析给出三个工程常量（数值来自 2026-01 前后快照，机制仍成立）：
- `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`（Claude 3 系默认窗口）；
- **预留 20k 给摘要输出**：`getEffectiveContextWindowSize = 窗口 - min(maxOutputTokens, 20_000)`。因为压缩时还要把"历史 + 摘要指令"塞进同一个请求，必须给 Summary 的输出留出空间，否则触发即失败；
- **13k 缓冲**（`AUTOCOMPACT_BUFFER_TOKENS`）：上下文快满时提前 13k 触发，而不是等到溢出；
- **熔断器**：连续压缩失败 >=3 次（`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES`）就停止该会话的自动压缩（防止"超限→压缩→再超限"死循环烧钱；官方称该判断每天省 ~25 万次死锁 API 调用）。
- 触发检查发生在**每轮 API 调用后**（`autoCompactIfNeeded` 在 step loop 里按真实 token 计数判断）。
- 来源：[04f-context-management.md](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md)

### A3. auto-compact 标志与可配置项（官方）
| 途径 | 说明 |
|---|---|
| `/autocompact [auto|<tokens>]` | 设置"上下文多满时自动压缩"；接受 100k–1M 的窗口（如 `500k`、`200000`、`200`=200k）；`auto` 回到模型默认窗口；写入用户设置 `autoCompactWindow`（v2.1.221+） |
| `--autocompact` CLI 标志 | 单次启动生效（`claude --autocompact 500k`） |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 环境变量 | 100000–1000000，优先级最高 |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 环境变量 | 按"窗口百分比"触发（1–100），只能提前不能延后（高于默认值被忽略）；Claude Code on the web 在云端会话里自己设置它 → 云端"接近上限时"提前压缩 |
| `DISABLE_COMPACT=1` | 完全关闭压缩（超长直接报错） |
- 来源：[model-config#set-the-auto-compact-window](https://code.claude.com/docs/en/model-config)、[env-vars](https://code.claude.com/docs/en/env-vars)、[commands](https://code.claude.com/docs/en/commands)

**设计意图**：把"压缩"做成可调的水位线而不是固定事件——默认值随模型能力走（1M 模型就 967k 才压），用户/管理员可整体平移，云端默认提前压（因为云端会话更长、更怕中途崩）。

---

## B. 压缩时保留什么：摘要 + 状态重建

**一句话**：压缩 = **先脱水清理旧内容 → LLM 把历史重写成一条结构化摘要 → 把"工作台状态"（文件/Plan/技能/工具声明）重新注入**。不是简单"保留最近 N 条 + 丢掉前面"。

### B1. 摘要怎么生成
- 官方：压缩时把**对话历史重写成结构化摘要**（"summarizes the conversation history to fit the context window"）；v2.1.198 起摘要请求**继承会话的扩展思考配置**（思考模式决定摘要质量，不改会话设置）。
- 摘要请求是**独立的一次 API 调用**：同样的 system prompt + 工具 + 历史 + 末尾追加一条"总结指令"；该请求复用主对话的 **prompt cache 前缀**（缓存热时成本极低；冷缓存、续开会话时最贵）。
- 源码分析：摘要在 **fork 出来的总结 agent** 里执行，且开启与主对话的 **prompt cache 共享**（`tengu_compact_cache_prefix`，默认开）——省掉每次压缩重建头部 token 的巨量开销。
- 来源：[prompt-caching](https://code.claude.com/docs/en/prompt-caching)、[context-window](https://code.claude.com/docs/en/context-window)、[04f](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md)

### B2. 压缩前先"脱水"（本地、零 LLM）
- 图片/文档负载（用户贴图、工具回传文件）替换为 `[image]` 等文本占位（`stripImagesFromMessages`）——防止摘要请求自己先 OOM；
- 剔除"压缩后会被重新注入的附件"（如 skill_discovery），避免二次总结产生幻觉（`stripReinjectedAttachments`）；
- 更广的视角（知乎源码拆解）：Claude Code 内部是**五段成本递增流水线**，前四步全是本地操作零 API 调用——**Budget Reduction**（调整工具输出截断预算）→ **Snip**（截短旧工具输出，留"做过什么"摘要行）→ **Microcompact**（工具输出局部内联压缩）→ **Context Collapse**（更久远历史细粒度折叠）→ **Auto-Compact**（兜底，才调 LLM 生成结构化摘要）。官方 glossary 亦证实："Older tool outputs are cleared first, then the conversation is summarized"。
- 来源：[04f](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md)、[知乎六大对比](https://zhuanlan.zhihu.com/p/2047337481255884504)、[glossary](https://code.claude.com/docs/en/glossary)

### B3. 摘要结构
- 源码拆解：结构化摘要**固定九个章节**：用户意图、主要请求、技术概念、文件与代码段、错误与修复、问题解决过程、用户消息、待办任务、下一步。
- 官方表述（交互式时间线）：摘要保留"你的请求与意图、关键技术概念、检查/修改过的文件及重要代码片段、错误与修复、待办任务、当前工作"；**逐字对话、完整工具输出、中间推理全部消失**。
- **用户消息怎么处理**：不是原样保留，而是**归纳进摘要**（九章节里有"用户消息"一章）；用户贴的图会被替换为占位。这与 Codex"近期 20k 用户消息原样保留"形成对比（见 E）。
- 来源：[知乎六大对比](https://zhuanlan.zhihu.com/p/2047337481255884504)、[context-window](https://code.claude.com/docs/en/context-window)

### B4. 压缩后：上下文反向重建（官方《What survives compaction》）
| 内容 | 压缩后 |
|---|---|
| System prompt / 输出风格 | **不变**（不在消息历史里） |
| 项目根 CLAUDE.md / 无路径规则 / auto memory / Plan | 从磁盘**重新注入** |
| 路径规则 / 嵌套 CLAUDE.md | 随匹配文件被重读时重新加载 |
| **读/改过的文件** | **重读最多 5 个**（最近修改优先）；>5000 token 的文件只给路径引用（显示为 `Referenced file` 而非 `Read`） |
| 调用过的 skill 体 | 重新注入，**每 skill ≤5000 token、总计 ≤25000**，最老的先丢（截断保开头——"重要指令放 SKILL.md 开头"） |
| hook 添加的上下文 | 随对话一起被摘要 |
| SessionStart hooks | 匹配的重新运行，输出并入压缩后上下文 |
- 源码补充：压缩记录里还带回**进行中的 Plan / Skill 附件、Deferred Delta 工具协议**、MCP Server 与工具完整声明。最终压缩后的上下文 = `[系统边界] + [精简摘要] + [最近文件内文截取] + [进行中的 Plan] + [激活的 MCP/工具声明]`——"站在工作台旁、手里还拿着刚用过的工具"，而不是裸摘要。
- PTL（Prompt Too Long）兜底：若连摘要请求本身都超限，**一次剥掉 20% 旧分组重试**（有损但能救活被锁死的会话）。
- 来源：[context-window](https://code.claude.com/docs/en/context-window)、[04f](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md)

---

## C. 表面层呈现：用户看到什么

- 压缩发生时终端显示 **"Conversation compacted"** 消息；**摘要本身不出现在终端**（"The summarization happens without appearing in your terminal"）。
- 压缩后紧接着显示重读文件的一行提示（`Read auth.ts`）和技能恢复提示（`Skills restored (commit-push)`）；路径规则以 "Loaded" 行出现在下一轮。
- 手动命令全家桶：
  - `/compact` —— 手动触发压缩，**可带 focus 指令**：`/compact focus on the auth bug fix`（"摘要保留你指定的内容，而不是自动压缩猜的重点"——官方明说这是对抗 bad autocompact 的手段）；
  - `/autocompact` —— 设置自动压缩窗口；
  - `/rewind`（双击 Esc）→ 选消息 → **Summarize from here / Summarize up to here**（只压缩部分对话）；
  - `/clear` —— 开新会话（不压缩，从零开始）；
  - `/context` —— 实时查看上下文占用分布与优化建议；`/recap` —— 只追加一份展示用摘要、不替换历史（不破坏缓存前缀）。
- 博客的决策表（官方推荐的日常姿势）：同任务继续 → Continue；走错路 → Rewind；中途臃肿 → /compact <hint>；全新任务 → /clear；下一步会吐大量中间输出 → Subagent。
- 来源：[context-window](https://code.claude.com/docs/en/context-window)、[prompt-caching](https://code.claude.com/docs/en/prompt-caching)、[官方博客](https://claude.com/blog/using-claude-code-session-management-and-1m-context)

---

## D. 1M context 时代的差异（官方博客 + 文档）

- **上下文腐烂（context rot）**是官方反复强调的核心概念：上下文越长、注意力越分散、模型越"笨"；1M 窗口让长任务更可靠，**但 rot 也会更严重**——窗口变大不解决"信息太多"的问题。
- **压缩机制本身不变**：官方明确 "Compaction works the same way at the larger limit"——1M 只是把水位线抬高。
- **Sonnet 5**：原生 1M（无 `[1m]` 变体可选），默认在 **~967K** 自动压缩；其他模型用 `[1m]` 后缀（`/model opus[1m]`）或别名（`sonnet[1m]`）选择扩展窗口。
- **200K 回退路径**：`CLAUDE_CODE_DISABLE_1M_CONTEXT=1` 或 LLM gateway 场景下，原生 1M 模型被按 200K 预算——"更大的窗口"不是无条件给的，是为了可控成本。
- **行为建议（博客）**：1M 时代更应**主动 /compact**（带说明），而不是等自动压缩——因为自动压缩发生在模型最笨的时刻（rot 最严重时）；"bad autocompact" 的根因是**模型猜不到你接下来的方向**（例：整个会话在 debug，你下一句想改 bar.ts 里的另一个 warning，它被摘要丢了）。官方把"被动等自动压缩"明确定位为次优路径。
- 来源：[官方博客](https://claude.com/blog/using-claude-code-session-management-and-1m-context)、[model-config#sonnet-5-context-window](https://code.claude.com/docs/en/model-config)、[context-window](https://code.claude.com/docs/en/context-window)

---

## E. 关键设计差异：Claude Code 独特在哪

与其他 agent（"LLM 摘要 + 保留尾部"的通用配方）相比，Claude Code 的独特点：

1. **五段成本递增流水线，LLM 是最后兜底**：Budget Reduction → Snip → Microcompact → Context Collapse 全是本地零 API 操作，只有最后 Auto-Compact 才调 LLM。多数会话根本走不到 LLM 摘要——"能用免费手段释放的空间，不花钱买"。（对比：很多 agent 只有"LLM 摘要"一层。）
2. **Prompt cache 前缀稳定性是一等公民**：
   - 压缩时**刻意保持消息序列前缀稳定**，让缓存命中率不掉（这不是"省钱小事"，是成本结构的核心——cache_write 是 cache_read 的 12.5 倍）；
   - 更激进的路线是**把压缩搬到服务端**：`cached_microcompact` 把"删旧工具结果"包装成 API 层 `cache_edits` 指令（客户端字节不变、缓存不失效）；`apiMicrocompact` 直接调 Anthropic `context_management` API（beta，Vertex/Bedrock 也支持），按 input_tokens 阈值让服务端自动裁旧工具调用——本地五段流水线退居"兜底"。
3. **摘要在 fork 的 agent 里做 + 共享 prompt cache**：总结与主路径隔离，但复用主对话缓存前缀。
4. **预算化设计**：给摘要输出预留 20k 窗口、13k 提前缓冲、连续失败 3 次熔断、PTL 剥洋葱降级——压缩本身被当作"可能失败的子系统"来工程化。
5. **状态重注入 > 裸摘要**：压缩后不是"摘要 + 保留尾部"，而是把工作台状态（最近 5 个文件、Plan、skill、MCP/工具声明、deferred tools）物理重建——"摘要 + 正在用的工具都在手边"。
6. **六家对比速览（知乎）**：
   - **Codex**：≈95% 容量触发 handoff 摘要；assistant 回复/工具结果**物理删除**；**近期 ~20k 用户消息原样保留**、更早的蒸馏进摘要（"工作交接"哲学）；
   - **OpenCode**：可逆隐藏（旧工具输出→时间戳占位，数据还在库）+ 摘要后**回放最后一条用户消息**；
   - **Cline**：/smol（=/compact）手动 + Auto-Compact，Focus Chain 待办穿越压缩存活；
   - **Cursor**：超窗自动压旧消息 + 提示开新对话；Dynamic Context Discovery 把历史变可搜索文件；
   - **Amp**：拒绝递归摘要（引 OpenAI 内部研究称性能衰减），用 /handoff 换线程；
   - **MemGPT/Letta**：上下文=RAM、历史=磁盘，Agent 自己决定换入换出（函数调用），不做被动截断。
   - 六家共识：分层渐进、成本递增、增量摘要优于全量、用真实 token、用户消息有特权、保护近端、stub 决策单调（不滑窗以免缓存每步失效）——Claude Code 是其中"最重缓存工程、最服务端化"的一家。
- 来源：[知乎六大对比](https://zhuanlan.zhihu.com/p/2047337481255884504)、[04f](https://github.com/liuup/claude-code-analysis/blob/main/analysis/04f-context-management.md)、[prompt-caching](https://code.claude.com/docs/en/prompt-caching)

---

## 附：对学习课题的启示（设计意图总结）

1. 压缩的本质是**把"删历史"变成"写交接单 + 重建工作台"**；Claude Code 把它拆成了"本地阶梯减压 + 一次 LLM 兜底"，而不是单一摘要动作。
2. **缓存经济性决定压缩设计**：谁缓存便宜，谁就敢频繁压缩/本地 stub；Claude Code 用"前缀稳定 + 服务端裁剪"把压缩的缓存代价压到最低——这是它和 pi/Reasonix 等"客户端重写"方案最根本的分野。
3. **压缩是可能失败的子系统**：预留预算、缓冲、熔断、降级、部分重试——成熟方案把"压缩失败"当成正常要处理的路径。
4. 1M 时代官方反而强调**主动 /compact 和 /clear**（"新任务开新会话"是官方规则），说明窗口再大也治不了信息熵——rot 是上下文长度的函数，不是容量的函数。
