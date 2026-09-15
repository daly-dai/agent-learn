# 怎么评价一个 AI agent harness 好不好 —— 现成标准 / 规范 / 方法论 / 工具调研

> 调研范围：本地参考语料（`E:\agents-read`）+ 一手外部规范与论文 + 评估框架/工具。
> 纪律：一手来源优先；「读到的」写出处，「推断的」显式标注；找不到就写找不到。
> 调研日期：2026-09（本地语料为 2026 年 survey 中文交互版）。

---

## 0. 先纠正一个前提：我们要的尺子叫什么

在开始之前必须先分清两个不同的东西——整份调研里最容易混的就是这个：

| 概念 | 英文 | 定义（一手） | 出处 |
|---|---|---|---|
| **评测夹具** | evaluation harness | 「端到端跑 eval 的基础设施：提供指令和工具、并发跑任务、记录所有步骤、给输出打分、汇总结果」 | Anthropic《Demystifying evals for AI agents》 |
| **Agent 执行外壳** | agent harness / scaffold | 「让模型能作为 agent 行动的系统：处理输入、编排工具调用、返回结果」；「评估"一个 agent"时，评的是 harness **和**模型一起工作的结果」 | 同上 |

**这条区分对我们至关重要**：我们自研的是一个 **agent harness**（执行外壳），不是 evaluation harness。
但本任务问的「怎么评价一个 harness 好不好」——Anthropic 明确说了 **评 "agent" = 评 harness + 模型**，两者不可分离。
所以下面第 5 节把这个区分单独立出来讲透。

---

## 1. 结论先行

**有没有现成标准？—— 有，但没有一条是"给你这个 harness 打分"的通用量表。** 现成物分成六类，一句话各是什么：

| 类 | 一句话 | 代表性现成物 | 评的是 |
|---|---|---|---|
| **A. 概念/架构充要条件** | 用一套**判定条件**回答"这是不是一个 harness、它的机制成熟到什么程度" | arXiv 2606.10106 的 T1–T4 充要条件 + anatomy qualifiers | harness **是否成立 + 机制成熟度** |
| **B. 可观测性规范（可机检）** | 用**字段级 schema**规定 harness 该产出什么遥测 | OpenTelemetry GenAI semconv（agent spans / execute_tool span / `gen_ai.*` 属性注册表） | harness **可观测性接口的合规性** |
| **C. 评估方法论（可操作流程）** | 告诉你**怎么设计一套 eval 来测 agent**，以及怎么把追踪变成诊断 | Anthropic《Demystifying evals for AI agents》；Survey §8 五阶段；Survey §2.6–2.9 编码协议 | **评估体系本身的质量** |
| **D. 能力基准** | 用固定任务集+打分器测 **agent 会不会干活** | SWE-bench / Terminal-Bench / τ-bench / GAIA / AgentBench / WebArena / OSWorld | 模型+harness 的**联合能力**（≠ harness 工程质量） |
| **E. 元评估 / 专项评估** | 评**你那个 eval 可不可信**；或评 **skill 有没有被用上** | `aehf`（Cohen's kappa 校准 + McNemar）；`skillgrade`（skill 有效性） | eval 的**统计可信度** / **skill 有效性** |
| **F. ⭐ 安全治理规范（风险清单）** | 用**官方风险条目 + 缓解建议**列出 harness 会在哪里失败 | **OWASP GenAI LLM Top 10 2026**（`LLM03 Excessive Agency` 9 条 + `LLM01 Prompt Injection` 11 条）；**OWASP Agentic Top 10 2026**（`ASI01`–`ASI10`）；MCP spec；CISA《Careful Adoption of Agentic AI Services》；NIST AI 600-1 | harness 的**失败模式与设计约束**（G/T/C/L 四层） |

> **⭐ E 类和 F 类是本次调研的两个意外收获**：原本以为只有"能力"和"工程质量"两类，实际上还有**元评估**（评评估本身）、**skill 有效性**两个独立类别（各有专门工具），以及 **F 类的官方安全治理规范**——**这是 ETCLOVG 的 G 层第一次拿到外部规范条目**，也是"知道它什么时候会失败"这个判据最直接的外部依据。

**关键判断（读到的 + 推断的）**：
- **读到的**：Survey §8 明确「执行环境感知的评估应将报告分数视为**模型-执行环境对的属性**，而非模型单独的属性」，且「追踪不是辅助调试工件，而是**主要评估数据**」。
- **读到的**：arXiv 2606.10106 明确区分「**membership**（是不是 harness，二元）vs **quality**（有多 robust，渐进）」——「The test decides whether a system is a harness. The anatomy qualifiers measure how robust it is.」
- **读到的（工具侧交叉验证）**：本轮核实的 8 个评估框架/工具里，**没有任何一个是专门评 "harness / 代码工程质量" 的**——Inspect AI / promptfoo / DeepEval 评模型+应用能力，Langfuse 是可观测性平台（带 eval），`aehf` 评 eval 可信度，`skillgrade` 评 skill 有效性。
- **⭐ 读到的（最强的一条交叉印证）**：**两个完全独立的一手来源说同一件核心事**：
  > arXiv 2606.10106 的 T4 判据：「a mechanism satisfies T4 if its **effectiveness does not depend on the model choosing to cooperate**」
  > OWASP `LLM01:2026 Prompt Injection`：「**Defense is therefore architectural rather than interceptive.**」
  → **"控制必须独立于模型" 有两份独立一手来源背书。这是我们唯一一条被双重印证的架构原则。**
- **推断的**：因此对「评价一个自研 harness 的工程质量」**最适用的不是能力基准（D），而是 A + B + C + F 的组合**（若要更严谨再加 E 校准自己的 eval）：A 判架构完备性，B 判可观测性接口合规性，C 判你自己那套 eval 站不站得住，**F 判"我们知道它会怎么失败吗"**。D 只能回答"换个 harness 分数会不会变"，回答不了"我这个 harness 造得好不好"。

---

## 2. 逐个展开

### 2.1 ⭐ 最高优先级：本地参考语料《Agent Harness Engineering: A Survey》

**它是什么**：2026 年发表的学术综述（CMU / Yale / JHU / NEU / Tulane / UAB / OSU / Virginia Tech / Amazon 联合），71 页，170+ 开源项目语料库。中文精译交互版落在 `E:\agents-read\Agent-Harness-Survey-ZH-main`（61 个 md + 11 个 HTML）。原始论文项目页：<https://github.com/1998x-stack/Awesome-Agent-Harness>。

**核心论点（`abstract.txt` 原文）**：「task execution reliability depends less on the underlying model than on the infrastructure layer that wraps it, the agent execution harness.」

**⚠️ 我们的 ETCLOVG 只抄了它的 §2.3（七层分类法本身）**。剩下可操作的部分全在别处。逐条汇报：

#### （a）§8 验证与评估（V）——五阶段「任务到反馈」生命周期

`08_验证与评估.md` 给的总表（**这是全篇最可直接抄成检查清单的东西**）：

```
阶段一：任务与基准接地        → 定义评估什么
阶段二：执行前就绪验证        → 确保评估可以公平运行
阶段三：受控执行与追踪捕获    → 将运行转化为可诊断证据
阶段四：多层次判断与故障归因  → 诊断故障来源
阶段五：持续回归与部署反馈    → 驱动下一次执行环境修订
```

它还给了「传统 LLM 评估 vs 执行环境评估」的对照表，**这一栏直接就是"我们哪里会自欺"的清单**：

| 传统 LLM 评估 | 执行环境评估 |
|---|---|
| 在固定输入上评分输出 | 衡量执行片段——任务嵌入环境，智能体随时间与工具和状态交互 |
| 关注最终输出 | 同时关注**最终结果**和**达到结果的路径** |
| 基础设施噪声被忽略 | 基础设施噪声可能伪装为模型失败——损坏的工具、过期的上下文、未重置的沙箱、不稳定的测试、模糊的基准或不稳定的评判器 |

> 「评估应将智能体行为转化为**结构化判断、故障归因和回归反馈**，而非仅仅报告最终分数。」

**逐阶段的可操作检查项（我从 5 个分章 md 提炼）**：

**阶段一 · 任务与基准接地**（`08_01_阶段一：任务与基准接地.md`）
- 任务不是自然语言提示，而是**嵌入性问题**：由「环境状态 + 可用工具 + 允许动作 + 约束条件 + 终止条件 + 成功标准」共同定义
- 没有良好指定的环境和成功条件，后续分数**无法被可靠解读**
- 三大基准类别：软件工程/终端（SWE-bench、Terminal-Bench）、Web/浏览器/计算机使用（WebArena、VisualWebArena、BrowserGym、WorkArena、OSWorld）、跨领域企业工作流（AgentBench、GAIA、TheAgentCompany）
- **核心洞察**：「强大的结果验证器需要强大的任务接地」——测试只有在仓库状态、依赖关系、预期成功标准被精确定义时才是可靠评估器

**阶段二 · 执行前就绪验证**（`08_02_...md`）——**这一阶段"在基准排行榜上通常不可见"，但对我们这种自研 harness 最实用**。三层：
1. **环境与沙箱就绪**：沙箱/仓库/浏览器/终端/VM 是否从**已知基线**启动
   > 「环境重置和依赖验证是**测量仪器的一部分**，而非可选项。」
2. **工具、上下文和权限就绪**（跨层）：
   | 维度 | 检查内容 | 风险 |
   |---|---|---|
   | 工具就绪 | API/MCP 服务器/browser 控制/shell/文件操作是否可用且**描述一致** | 工具描述变化 → 不同运行测量不同的动作空间 |
   | 上下文就绪 | 历史/记忆/草稿本/检索文档是否重置或**有意图地初始化** | 未重置 → agent 可能从泄漏状态中获益 |
   | 权限就绪 | 文件/凭证/网络/审批门是否匹配规范 | 过严 → 能力强的 agent 因治理原因失败；过松 → 不安全行为未被检测 |
3. **评估器与评分器就绪**：确定性评分器查不稳定性/缺失依赖；LLM-as-Judge 的提示、评分标准、评判模型**应版本化**；人工审计协议预先定义
   > 「评估器就绪是**有意义的故障归因的前提条件**。」

**阶段三 · 受控执行与追踪捕获**（`08_03_...md`）
- **Rollout** 是评估的基本单元：任务 + 模型配置 + 执行环境配置 + 动作序列 + 中间观察 + 最终状态 + 评分结果
- **受控 rollout 固定 6 个变异源**：环境状态、工具可用性、超时、预算、权限策略、评估器版本
- 非确定性仍在时，**重复 rollout 暴露方差**，而非隐藏在单一分数背后
- **追踪原生执行环境应记录**（这直接就是 harness 的遥测字段清单）：模型输出、工具调用、工具结果、环境状态变化、上下文快照、错误/重试/恢复动作、Token 使用、延迟、成本
- 「追踪可以区分**表面上相似的失败**」；还能揭示**不良成功**：基准利用、过多工具调用、权限违例
- 「评估应报告**不仅是质量，还有实现质量的成本**」——暴露**成功-成本-延迟前沿（frontier）**，而非仅按成功率排名
- > 「可复现性需要重放完整的**模型-工具-环境**交互，而非仅重运行一次模型调用。」

**阶段四 · 多层次判断与故障归因**（`08_04_...md`）——**用户提到的 "8.5" 就是这一章（toc 里是 §8.5，文件是 `08_04`）**
- **三层判断**：
  1. **结果级**：最终任务目标是否实现（单测/回归/SWE-bench 验证；最终文件、命令输出；最终环境状态；答案字符串）
     - 优势：可扩展、可解释、支持排行榜比较；**局限：压缩**——完整执行片段被缩减为一个值，隐藏了 agent 是否鲁棒、安全或高效地成功
     - > 「**必要但不充分。**它回答任务是否完成，但不回答执行环境是否产生了可信的执行。」
  2. **轨迹级**：路径质量——选对工具了吗？动作顺序合理吗？避免冗余调用了吗？**遵守权限边界了吗**？从错误中恢复了吗？随时间保持了上下文一致性吗？
     - **⭐ 这是对我们最有用的一张表：失败原因 → 应改进的层**
       | 失败原因 | 应改进的层 |
       |---|---|
       | 选错工具 | 工具接口（T） |
       | 忘记先前约束 | 上下文层（C） |
       | 无恢复地循环 | 编排层（L） |
  3. **评估器级**：评估器本身能否被信任？
     | 类型 | 优势 | 局限 |
     |---|---|---|
     | 确定性验证器（单测、状态检查器） | 可复现、廉价、跨系统可比 | 窄，对开放任务难以设计 |
     | LLM-as-Judge | 对自然语言输出和轨迹评估灵活 | 偏差、非确定性、额外成本 |
     - **已知偏差**（引 Zheng et al., 2023）：位置偏差、冗长偏差、自我增强偏差、有限的推理能力
     - > 「鲁棒的评估器偏好**分层评分者**：确定性检查用于客观状态变化，LLM 评判用于语义或轨迹级评估，人工审计用于模糊或高风险案例。」
- **跨层故障归因**：失败 rollout 可能源于「模型推理 → 工具接口设计 → 过期或压缩的上下文 → 沙箱不稳定 → 编排循环 → 基准模糊 → 评估器不可靠」
  > 「**实践中，归因很少是单标签分类问题。**」
  > 「阶段四的输出不仅是判断，更是**结构化诊断**——阶段五可将其反馈到回归测试和执行环境改进中。」

**阶段五 · 持续回归与部署反馈**（`08_05_...md`）
- 回归评估应由**执行环境变更和模型变更**共同触发（工具描述、上下文压缩策略、沙箱镜像、权限规则、评判提示的变更都可能改变行为或分数）
- **分层评估套件**（这一张表可以直接抄成我们的测试金字塔）：
  | 层级 | 内容 |
  |---|---|
  | 单元级 | 工具模式测试、确定性验证器 |
  | 单步级 | 局部决策测试 |
  | 完整 rollout | 端到端完成测试 |
  | 多轮模拟 | 长周期连贯性测试 |
- 评估框架对照：Promptfoo（提示和 LLM 应用回归测试）、DeepEval（单元测试式抽象）、RAGAS（RAG 评估）、lm-evaluation-harness（标准化语言模型评估）
- **评估与可观测性应连接**：「生产追踪可以成为回归测试，评估失败可以成为可观测性信号。」
- 较新方向：**Meta-Harness**（Lee et al., 2026）把**执行环境设计本身**作为自动化搜索的对象

#### （b）§2.6 / 2.7 / 2.9 —— 它的「打分分类」方法

**§2.6 纳入与排除标准**（`02_06_纳入与排除标准.md`）——纳入当且仅当**三项同时满足**：
1. 公开可查（有可公开访问的文档）
2. **实现或规范了具体的执行环境级机制**（而非仅是概念讨论或 API 调用封装）
3. 证据充分（足以分配至少一个 ETCLOVG 层级）

排除：简单聊天机器人演示、提示模板集合、薄模型客户端包装器、不携带 agent 运行时的静态数据集或排行榜、非 agent 面对的通用基础设施组件、无法从公开文档审查技术行为的产品页面。

> **边界案例处理原则：「按机制判定，而非按标签判定。」**
> 仓库被命名为"智能体"不足以构成纳入理由；反之，提供可复用执行环境机制的项目即使标签不含 "agent" 也应纳入。

**§2.7 编码协议**（`02_07_编码协议.md`）：
- 证据来源：README、文档页面、学术论文、示例代码、发布说明、仓库结构
- **多标签编码**：**主层（primary layer）** = 该工件最核心的机制所在层；**次层（secondary layers）** = **仅当文档暴露了独立的（而非附带的）能力时才分配**
- **编码质量控制：单一主编码员 + 作者审计**，**不报告 Cohen's kappa** 或可比统计量
- 模糊案例全量编码后回顾性复审，采用**保守规则**：公开证据未能清晰显示 agent 面对的机制 → **暂缓该层级分配**

> ⚠️ 对我们的启示（**推断的**）：这套方法**我们自己就能照抄来给 agent-learn 做自评**——它的优点恰恰是承认了主观性（单一编码员、不做 kappa），并用"保守规则 + 暂缓"来兜底。但它**不是一把外部尺子**，它是"如何建立一把尺子"的说明书。

**§2.9 聚合分析**（`02_09_聚合分析.md`）——170+ 项目的覆盖密度：
| 密度 | 层级 | 原因 |
|---|---|---|
| 高 | E、T、L、V | 都需要可运行环境、工具契约、控制循环和可复现评估才能产生价值 |
| 中 | C | 常嵌入大型框架内部，而非作为独立组件发布 |
| 低 | **O、治理 G** | 开源覆盖较薄，更多以商业平台、SDK 功能或工程撰写的形式出现 |

> 关键洞察：「**可观测性和治理的开源覆盖薄弱**提示一个重要趋势：运营控制能力的成熟晚于运行时和基准基础设施。」——成熟路径是 先 E/T/L → 再 V → 再 O/G。

#### （c）§7.5 走向统一可观测性 —— 可操作要素表

`07_05_讨论：走向统一可观测性.md`：
- **可观测性-评估鸿沟（引 LangChain 2025a 调研）**：「**89% 的团队使用追踪工具，但仅 52% 使用评估框架**」
- 弥合方式：从生产故障追踪中**自动生成回归测试用例**；将**在线评估分数作为告警信号**
- **统一可观测性的四个关键要素**（可直接当 checklist）：
  | 要素 | 含义 |
  |---|---|
  | 追踪与评估的统一 | 同一条追踪数据既支撑调试也支撑评估，**避免重复插桩** |
  | 跨层可见性 | 从 API 级 token 追踪到基础设施级 GPU 利用率，从模型推理到环境状态 |
  | 因果归因 | 不仅知道"发生了什么"，还能追溯到"为什么发生" |
  | 自动化闭环 | 检测 → 根因分析 → 推荐修复 → （可选）自动化修复 |
- 现状判断：「各组件功能强大但**彼此隔离**」

#### （d）§11 跨层综合 —— §11.2 能力-控制权衡

`11_跨层综合.md`。本章把跨领域关切整合为**五个系统级效应**。

**§11.1 成本-质量-速度三元悖论**：
| 增强方向 | 收益 | 代价 |
|---|---|---|
| 更强的沙箱、更忠实的环境 | 安全性和可复现性提升 | 启动延迟增加、基础设施成本上升 |
| 更丰富的上下文和记忆策略 | 任务连续性改善 | Token 消耗增加、检索开销 |
| 更深的评估和可观测性 | 诊断能力提升 | 迭代速度降低、存储和追踪处理成本 |

> 「生产系统因此**不能将质量视为标量目标**。」

**§11.2 能力-控制权衡**（用户点名要看）：
| 能力增强 | 控制代价 |
|---|---|
| 更大的工具菜单 | 选择错误增加、提示注入面扩大 |
| 持久化记忆 | 来源、过期和隐私风险 |
| 宽松的沙箱 | 错位或受损动作的爆炸半径扩大 |

> 「能力-控制权衡**不是安全附加组件**——它是连接工具模式、上下文策略、运行时权限、身份、可审计性和人类批准的设计轴。」

**§11.3 执行环境耦合问题**（**这一节是"为什么不能逐层打勾"的论证**）：
- 执行环境通过影响包可用性、重置语义、延迟和故障模式来**改变评估结果**
- 工具描述**消耗上下文预算**并**塑造模型行为**
- 可观测性追踪**仅在身份和权限状态以相同粒度捕获时才成为治理证据**
- 评估设计通过奖励某些恢复循环并惩罚其他循环来**反馈到编排中**
> 「执行环境变更应被测试为**系统变更**。单独看有益的提示、工具、记忆、沙箱、验证器或监控器，在与控制循环其余部分组合时可能**降低整个 rollout 的表现**。」
> 耦合问题也解释了为何「agent 分数不能干净地归因于模型而不指定周围控制器」

**§11.4 从 agent 框架到 agent 平台**：核心设计问题从「**如何构建一个智能体？**」变为「**如何运营一个智能体集群，使其行为随时间保持可检查和可逆？**」

#### （e）§9.5 审计基础设施 —— 可重放审计记录的最低要求

`09_05_审计基础设施.md`。**这是全篇最像"字段级标准"的一段**：

> **可重放审计记录的最低要求**：追踪标识符、责任者身份、工具调用、**策略决策及版本**、执行结果、资源成本、**相关输入输出的完整性哈希**。

现状批评：「大多数当前系统只记录其中一部分字段，且很少签名或哈希记录——**审计轨迹易受受损智能体进程的日志篡改**。」

- **结构化审计轨迹对照**：
  | 系统 | 审计记录内容 |
  |---|---|
  | AutoHarness（AIMing Lab, 2026） | 每次工具调用的 **JSONL** 记录——工具名、参数、**风险分类**、**权限决策**、执行结果、token 成本、延迟 |
  | SAGA（Syros et al., 2025） | 多智能体交互——**密码学 token 交换记录**，支持跨信任边界来源追踪 |
- **异常检测：逐动作 vs 轨迹级**
  | 粒度 | 方式 | 优势 | 局限 |
  |---|---|---|---|
  | 逐动作 | 每个工具调用按风险分类 | 廉价、易审计 | 无法识别跨多次良性动作分布的**慢速攻击** |
  | 轨迹级 | 联合评估动作序列 | 捕获多步攻击 | 更高延迟、告警定位不精确 |
  - 实践中：**逐动作检查在线部署，轨迹级分析异步运行于审计日志**
- **成本与资源审计**：引 **2025 OWASP LLM Top 10** 将**资源耗尽（resource exhaustion）**列为独立风险类别
- **分层治理管线**（AutoHarness 三层范例）：
  | 层级 | 深度 |
  |---|---|
  | 核心 | 解析→风险→权限→执行→审计 |
  | 标准 | + 上下文丰富化 + 输出验证 |
  | 增强 | + 异常评分 + 人工升级 + 形式约束验证 |
  - 层级通过 YAML 宪法声明式选择 →「**治理开销随部署风险扩展**」
- **开放挑战**：审计日志在长周期 agent 中快速积累（存储/隐私/信噪比）；日志含敏感数据（审计完整性 vs 数据保护张力）；**缺乏标准化审计 schema**，跨系统分析和监管报告困难

#### （f）§12.3 从 agent 追踪中诊断故障

`12_开放问题与未来方向.md`：
- 问题定位：「智能体评估仍过于以**最终分数为中心**。对执行环境工程而言，这不够——失败的 rollout 可能源自模型推理、误导的工具模式、沙箱错误配置、过期上下文、不稳定测试、基准模糊、评判器不稳定或编排循环。」
- **关键数据**：
  - Anthropic 的基础设施噪声分析：基础设施设置可**显著偏移基准分数**（Anthropic, 2026a）
  - LangChain 调研：**89% 团队使用可观测性，仅 52.4% 运行离线评估**——「能看见行为但不能判断正确性」
- **开放方向：追踪原生评估**——追踪应成为「计算结果分数、轨迹质量、故障归因和回归测试的主要对象」；把异常生产追踪转化为回归案例，**直接在 span 上计算轨迹指标**

**另外两节也值得记（同章）**：
- §12.4 缺失的交接契约：现有局部标准 MCP（工具访问）、A2A（agent 间通信）、OpenTelemetry（追踪基板）；**缺失的部分是「跨层交接契约」**——交接应传递「意图、约束、权限、工件、来源、预算状态、风险级别、追踪历史和未解决决策」
- §12.5 随模型改进保持执行环境有用：「执行环境设计**不应被假设为单调地走向更多脚手架**」；Anthropic 证据：上下文重置对某一模型有用，对更强模型变得可弃

#### （g）§10 跨领域关切 —— 五个持续性生态系统缺口

`10_跨领域关切.md` 列出的五个缺口（层边界反复出现）：

| 缺口 | 表现 |
|---|---|
| 跨工具互操作 | 不同工具系统间缺乏统一的调用和响应语义 |
| 成本归因 | 无法将成本精确归属到特定层或组件 |
| 故障恢复 | 跨层故障的级联效应缺乏系统化的恢复策略 |
| 多仓库编排 | 跨代码库的 agent 工作流缺乏标准化的协调机制 |
| 人机交接 | 从 agent 到人类的控制转移缺乏结构化的状态传递 |

> 「执行环境设计应被解读为**依赖结构**，而非可分离组件的检查清单。」

**⚠️ 需要声明的限制**：本调研实际读取的是该中文交互版的 61 个 md 文件本身。**这些 md 是"分章精译"而非论文全文**——例如 §8.7 Summary、§11.5 开放研究议程、§9.6/9.7、§3–§6 各节的分节内容未在此语料中逐字给出。因此上面凡标注"引"的引文，**出处是这份中文语料而非 arXiv 原文**；如需引用到正式文档，应回溯英文原文核对。（英文原文未在本地，arXiv 编号未知——`README.md` 只给了 <https://github.com/1998x-stack/Awesome-Agent-Harness>，**我没有找到该 survey 的 arXiv 编号，不臆测**。）

---

### 2.2 ⭐ arXiv 2606.10106《What makes a harness a harness》—— 充要条件

**它是什么**：单作者论文（Sanderson Oliveira de Macedo，Federal Institute of Goiás），arXiv:2606.10106v1 [cs.SE]，2026-06-08 提交，CC BY 4.0。
一手来源：<https://arxiv.org/abs/2606.10106> · 全文：<https://arxiv.org/html/2606.10106v1>

**定位（摘要原文）**：「This article is deliberately definitional. It does not propose a new agent, **does not measure benchmark performance**... Its product is conceptual: a shared vocabulary and a reproducible test of membership in the concept.」
→ **它不是一把质量尺子，是一把"身份尺子"**。但对"我们这个东西算不算 harness、缺哪块"极其有用。

#### （i）充要条件全文（原文引用）

> **An agent harness is the runtime engineering layer that wraps one or more language models and turns them into an agent able to accomplish tasks over an external environment, by coupling to the model:**
> **(i) an agent loop that interleaves reasoning, action, and observation;**
> **(ii) a tool interface that lets the model perceive and alter the environment;**
> **(iii) context management that decides what enters and leaves the model's window;**
> **and (iv) control mechanisms, that is, limits, verification, and deterministic actions, that make the execution more trustworthy, auditable, and contained.**

> 「A system is an agent harness **if and only if** it instantiates the four elements above **at runtime**.」
> 「The **temporal clause** carries a lot of weight: the harness acts **during** the task, and that is what separates it from the evaluation harness, which acts **afterward**.」

#### （ii）T1–T4 判定测试（可直接当自检表）

| Test | 问题 | 答"否"则 |
|---|---|---|
| **T1** | 运行时是否存在**推理-行动-观察**的循环？ | 单次生成器或固定流水线；不是 agent |
| **T2** | 是否有让模型**感知并改变**外部环境的工具接口？ | 孤立的模型或尚未构建循环的 SDK |
| **T3** | 是否**主动管理**什么进入/离开模型上下文？ | 朴素包装器（堆历史）；长任务上脆弱 |
| **T4** | 是否**至少有一个不依赖模型服从而生效**的控制机制（限制/验证/确定性动作）？ | 没有保证的 demo；只能相信模型的话 |

#### （iii）三个「可验证的判据」——**这是全文最有操作价值的部分**

论文自己承认 T1–T4 会被"naively"读，于是给每条补了**阈值判据**：

- **T3 判据**：「T3 is satisfied if the decision about what enters and leaves the context **depends on the content of the task or of the current observation**, and not merely on the size of the buffer.」
  → **按大小机械截断 = 不通过；按内容做任务感知的主动选择 = 通过。**
- **T2 判据**：「T2 is satisfied if the interface lets the model **alter** an external environment (edit files, run commands), not merely read it or suggest text.」
  → 只读不写 = 不通过。
- **T4 判据**：「a mechanism satisfies T4 if its **effectiveness does not depend on the model choosing to cooperate**.」
  → **单条 log print = 不通过（不改变执行走向）；工具调用上限或确定性检查 = 通过。**

#### （iv）membership 是二元的，quality 是渐进的

> 「membership is **binary in its existence** but **gradual in its quality**. ... The test decides **whether** a system is a harness. The anatomy qualifiers measure **how robust** it is. Treating those two questions as one is the source of much of the terminological mess this article combats.」

**Anatomy（Figure 3）——四要素之外的可选组件，也就是"成熟度"的观察维度**：
tool registry、context manager、memory、agent loop、**verifier**、retry logic with eventual model switching、observability、guardrails、deterministic handlers。
> 「Not every harness ships all of those optional components. The four elements of the definition, though, are the core. Without them there is no harness.」
> 「Memory, verification, observability, and the like are **not new elements**; they are **specializations of T1 through T4**.」

**明确**不**必要的东西**（避免把定义收窄）：不需要 multi-agent、不需要 learning/fine-tuning、不需要特定模型（模型切换是控制机制而非依赖）、**不需要 UI（harness 可以是一个无面库）**。

#### （v）边界划定：harness vs 五个邻居

| 概念 | T1 | T2 | T3 | T4 | 区别 |
|---|---|---|---|---|---|
| **Agent harness** | yes | yes | yes | yes | 参照概念 |
| Agent framework | no | no\* | no | no | 组合 agent；循环/工具/上下文/控制属于它协调的 harness，不属于 framework 本身 |
| Agent SDK | no | yes | no | no | 提供积木；运行时装配不出循环 |
| IDE plugin | no | no | no | no | 从光标处补全，不改动仓库、不闭环 |
| **Eval harness** | no | yes | no | no | 能跑命令打补丁，但**在执行之后从外部测量**：T1 失败 |
| Orchestrator | no | yes | no | no | 链式固定步骤；选择不由观察驱动（T1、T3 失败） |

\* framework 可以在它协调的每个 agent 下嵌一个 harness。

**harness vs guardrail**（作者称为"本主题最常见的混淆"）：
> 「Guardrails **limit**... The harness, as a whole, **enables**... The test question is single: **is this limiting the agent, or helping it execute?** If it limits, it is a guardrail. If it helps, it is a harness. **Guardrails are inside the harness; the harness is not inside the guardrails.**」
→ guardrail 属于 T4 的一种控制机制，是**部分-整体**关系，不是相邻的两个范畴。

#### （vi）对「自研 harness 工程质量」适不适用？

**部分适用，而且是不可替代的那一部分。** 理由：
- **适用**：T1–T4 + 三条可验证判据 = **一份能直接对我们的 `lib/agent/index.ts`、`lib/tools/`、压缩逻辑、权限审批逐条打勾的自检表**；它回答的是"我们的架构完备性"。
- **不适用**：它**明确不做质量排名**——「It does not... measure benchmark performance」；它自己说 membership 二元、quality 渐进，但**没有给出 quality 的量化刻度**。所以它不能告诉你"我们的 harness 是 7 分还是 8 分"，只能告诉你"这四个机制你都有/缺哪个、以及你那个 T3/T4 是不是形式上满足而实质不满足"。
- **⭐ 最大价值恰恰是那三条判据**：它们把"有压缩"和"有真正的上下文管理"、"有权限审批"和"有真正独立于模型的控制"区分开——这正是自研项目最容易自欺的地方。

**⚠️ 未读到**：§7「Design Axes and Research Agenda (RQ5)」的具体 10 条 tension axes。arXiv HTML 在 §6 末尾被截断，PDF 无法解析（`unsupported content type "application/pdf"`），镜像站点亦未取到全文。**因此关于它的"设计轴"我没有任何一手信息，不臆测。** 若需要，应下载 PDF 人工阅读。

---

### 2.3 OpenTelemetry GenAI semantic conventions

**它是什么**：OpenTelemetry 的 GenAI 语义约定——规定 LLM/agent 系统该产出哪些 span、哪些 attribute。**2026 年起已从 `open-telemetry/semantic-conventions` 迁移到独立仓库 `open-telemetry/semantic-conventions-genai`**（一手证据：`semantic-conventions/main/docs/gen-ai/gen-ai-spans.md` 现在只有一条 "Moved" 说明）。

一手来源：
- 官方站点入口：<https://opentelemetry.io/docs/specs/semconv/gen-ai/>
- 迁移后仓库：<https://github.com/open-telemetry/semantic-conventions-genai>
- GenAI 总览：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/README.md>
- **Agent spans**：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-agent-spans.md>
- **Model/client spans（含 execute_tool）**：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-spans.md>
- **属性注册表（全部 `gen_ai.*`）**：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/registry/attributes/gen-ai.md>

#### ⚠️ 稳定性：**全部是 Development，不是 Stable**

这是最关键的一条。逐项核对原文中的 Stability 徽章：

| 信号 | 声明的 Status | 备注 |
|---|---|---|
| 整个 GenAI 语义约定 | **Development** | `README.md`: "**Status**: [Development]" |
| `gen_ai.create_agent.client` span | **Development** | Span kind SHOULD be `CLIENT` |
| `gen_ai.invoke_agent.client` span | **Development** | Span kind SHOULD be `CLIENT` |
| `gen_ai.invoke_agent.internal` span | **Development** | |
| `gen_ai.invoke_workflow.internal` span | **Development** | Span kind SHOULD be `INTERNAL` |
| `gen_ai.plan.internal` span | **Development** | Span kind SHOULD be `INTERNAL` |
| `gen_ai.inference.client` span | **Development** | |
| `gen_ai.memory.client` span | **Development** | |
| `execute_tool` span | **Development** | 见下 |
| 所有 `gen_ai.*` attribute | **Development** | 注册表里 `gen_ai.*` 全部是 Development 徽章 |
| `error.type` | **Stable** | 唯一 stable 的，但它不属于 GenAI 命名空间 |
| `server.address` / `server.port` | **Stable** | 同上 |

**结论（读到的）**：**OpenTelemetry GenAI semconv 目前整体处于 Development 状态**——它可以作为**设计参考和字段命名约定**（"我们应该记录什么"），但**不能作为"合规性认证标准"**（因为规范自己声明还会变）。这点必须在任何引用它的文档里写明，否则会把它当成已定标准。

#### （a）Span 清单（agent / framework 相关）

**⚠️ 首先分清两层命名（最容易搞错的地方）**：
- **span 的 registry id**：`gen_ai.inference.client`、`gen_ai.execute_tool.internal` —— **这不是 trace 里看到的 span 名**
- **span 名**（trace 里实际的字符串）：`chat gpt-4`、`execute_tool {gen_ai.tool.name}`、`invoke_agent {gen_ai.agent.name}`
- **⚠️ 更正**：常被引用的 `genai.client.*` 在**现行规范中不存在**；现行模型 span id 是 `gen_ai.inference.client`。

**完整 span 清单**（来自 `spans.yaml`，**全部 Development**）：

| span registry id | **kind** | **span 名模板** |
|---|---|---|
| `gen_ai.inference.client` | `client` | `{gen_ai.operation.name} {gen_ai.request.model}` |
| `gen_ai.embeddings.client` | `client` | 同上 |
| `gen_ai.retrieval.client` | `client` | `{gen_ai.operation.name} {gen_ai.data_source.id}` |
| `gen_ai.fetch_response.client` | `client` | `{gen_ai.operation.name}` |
| `gen_ai.memory.client` | `client` | `{gen_ai.operation.name}` |
| `gen_ai.create_agent.client` | `client` | `create_agent {gen_ai.agent.name}` |
| **`gen_ai.invoke_agent.client`** | `client` | `invoke_agent {gen_ai.agent.name}`（无 name 时 `invoke_agent`） |
| **`gen_ai.invoke_agent.internal`** | `internal` | 同上 |
| **`gen_ai.execute_tool.internal`** | **`internal`** | `execute_tool {gen_ai.tool.name}` |
| **`gen_ai.invoke_workflow.internal`** | `internal` | `invoke_workflow {gen_ai.workflow.name}` |
| **`gen_ai.plan.internal`** | `internal` | `plan {gen_ai.agent.name}`（无 name 时 `plan`） |

**kind 的原文规则**：inference 的「**Span kind** SHOULD be `CLIENT` and MAY be set to `INTERNAL` on spans representing call to models running in the same process.」（memory 同句式）。
→ **对我们（模型调用在同一进程内）的含义：模型 span 可以是 `INTERNAL`，但工具 span 固定是 `INTERNAL`，agent span 有 client / internal 两个变体。**
→ **没有** `create_agent.internal` / `execute_tool.client` 这类变体。

**每个 span 都要在创建时提供的采样相关属性**（原文「SHOULD be provided **at span creation time**」）：如 inference 的 `gen_ai.operation.name` / `gen_ai.provider.name` / `server.address` / `server.port`。

**`gen_ai.operation.name` 的完整 well-known 值（18 个）**：
`chat`、`generate_content`、`text_completion`、`embeddings`、`retrieval`、`fetch_response`、`create_agent`、`invoke_agent`、`execute_tool`、`invoke_workflow`、`plan`、`search_memory`、`create_memory`、`update_memory`、`upsert_memory`、`delete_memory`、`create_memory_store`、`delete_memory_store`

**⭐ `invoke_agent` 的语义（client vs internal 的分界，原文）**：
- `gen_ai.invoke_agent.internal`（kind `internal`）= 「Describes GenAI agent invocation **within the same process**. Examples: **LangChain agents, CrewAI agents**.」
- `gen_ai.invoke_agent.client`（kind `client`）= 「…**over a remote service**. Examples: **OpenAI Assistants API, AWS Bedrock Agents**.」
→ **我们自研的本地 harness 属于 `invoke_agent.internal`。**

**⭐ `gen_ai.request.model` 在 agent span 上的限制（原文，很容易忽略）**：
> 「SHOULD be populated **if and only if** the instrumented library allows to set only a **single model per agent**. It SHOULD **NOT** be populated for agents that support **multiple models or dynamic selection**.」
→ **我们支持模型切换，所以按规范我们不该在 agent span 上报 `gen_ai.request.model`。**

**`plan` span 的层级规则**：「The LLM call that generates the plan SHOULD be a **child** of the plan span, and the tool or task spans produced from the plan are typically **sibling** operations under the same `invoke_agent` span.」；**不能区分 planning 与普通推理时 SHOULD NOT 报**。

**`invoke_workflow` 何时该报**：「SHOULD be reported for operations that trigger the execution of composable processes (e.g., graphs, orchestrators) coordinating multiple agents or GenAI calls. It SHOULD **NOT** be reported for standalone agent invocations.」
「SHOULD **NOT** be reported when the workflow invocation is an internal implementation detail of another operation (e.g., an agent or tool that spins up a runner/workflow under the hood to delegate to a sub-agent) rather than a user-facing entry point.」
点名框架：ADK `Runner.run`、CrewAI `Crew.kickoff()`、LangGraph `*Graph*.invoke`、MS Agent Framework、OpenAI Agents `Runner.run(starting_agent=...)`。

**⭐ agent 指标（`metrics.yaml`，全部 Development）**：
`gen_ai.invoke_agent.duration` / `gen_ai.invoke_agent.inference_calls` / `gen_ai.invoke_agent.tool_calls`
原文约束：后两者**只算本 agent 自己发起的**（sub-agent 的算在 sub-agent 上）；`tool_calls` **只算客户端侧工具**。

**⚠️ 规范基本不管 span 树形状（如实记录）**：全文检索 `child|parent|nested|hierarch|sub-agent|sibling` **只有上述两处命中**（plan 的父子 + invoke_workflow 的例外）；**没有**"LLM span 必须是 agent span 子节点"的规定，**没有** span 树示例，**没有**独立的 multi-agent / handoff 建模章节。
→ **这意味着"我们该不该给编排层开 span、开几个、怎么嵌套"规范里基本没答案** —— 这正对应第 3 节的空白。

#### （b）Agent 相关的关键 attribute

`goals.agent.*` 一族（全部 Development）：

| 属性 | 类型 | Requirement Level | 语义 | 示例 |
|---|---|---|---|---|
| `gen_ai.agent.id` | string | Conditionally Required（If applicable） | **稳定**的 agent 资源标识符 | `asst_5j66UpCpwteGg4YSxUnt7lPY`、`arn:aws:bedrock:...` |
| `gen_ai.agent.name` | string | Conditionally Required | 人类可读的 agent 名 | `Math Tutor` |
| `gen_ai.agent.description` | string | Conditionally Required | 自由文本描述 | `Helps with math problems` |
| `gen_ai.agent.version` | string | Conditionally Required | agent 版本 | `1.0.0`；`2025-05-01` |
| `gen_ai.operation.name` | string | **Required** | 操作名 | `invoke_agent` |
| `gen_ai.provider.name` | string | **Required** | provider 判别器 | `openai`；`anthropic`；`**deepseek**` |
| `gen_ai.conversation.id` | string | Conditionally Required | 会话/线程 ID，用于关联同一会话内消息 | `conv_5j66UpCpwteGg4YSxUnt7lPY` |
| `gen_ai.workflow.name` | string | Conditionally Required | workflow 名（**MUST 低基数**） | `multi_agent_rag` |
| `gen_ai.request.model` | string | Recommended | 请求的模型名 | `gpt-4` |
| `error.type` | string | Conditionally Required | 错误类别（**Stable**） | `timeout`；`500` |

**⭐ 对我们直接有用的两条**：
- `gen_ai.agent.id` 的原文注释：「It's NOT RECOMMENDED to record **in-memory agent instance ids** on this attribute due to their transient nature.」——别把内存里的实例 id 当稳定标识。
- `gen_ai.conversation.id` 的原文注释（**这条是一条明确的"不要伪造"规则**）：「When no identifier for the conversation is available, instrumentations SHOULD **NOT** populate conversation id. For example, a **new UUID, a trace identifier, or a hash of request content SHOULD NOT be used as a fallback value.**」

#### （c）工具调用相关的 attribute（这是我们能直接对照 `lib/tools/` 的）

| 属性 | 类型 | Requirement Level | 语义 |
|---|---|---|---|
| `gen_ai.tool.name` | string | — | agent 使用的工具名 |
| `gen_ai.tool.description` | string | — | 工具描述（⚠️ 可能含敏感信息） |
| `gen_ai.tool.type` | string | — | `function` / `extension` / `datastore` |
| `gen_ai.tool.call.id` | string | — | 工具调用标识符 |
| `gen_ai.tool.call.arguments` | any | — | 传给工具调用的参数（⚠️ 敏感；应为对象，字符串需尽力反序列化） |
| `gen_ai.tool.call.result` | any | — | 工具调用返回的结果（⚠️ 敏感） |
| `gen_ai.tool.definitions` | any | **Opt-In** | 可用的工具定义列表（⚠️ 可能很大，**NOT RECOMMENDED** 默认填充非必需属性） |

`gen_ai.tool.type` 的原文三种取值语义：
- **`extension`**：agent 端执行，直接调用外部 API，桥接 agent 与真实世界系统
- **`function`**：客户端执行——agent 生成参数，客户端执行逻辑
- **`datastore`**：agent 用来访问/查询结构化或非结构化外部数据，用于 RAG 或知识更新

#### （d）内容捕获：opt-in 与**官方三档建议**

**硬结论**：内容类属性（`gen_ai.input.messages`、`gen_ai.output.messages`、`gen_ai.system_instructions`、`gen_ai.tool.call.arguments`、`gen_ai.tool.call.result`、`gen_ai.tool.definitions`、`gen_ai.prompt.variable`、`gen_ai.memory.query.text`、`gen_ai.memory.records`、`gen_ai.retrieval.query.text`、`gen_ai.retrieval.documents`）**一律 `opt_in`**，默认不采，全部带原文警告「likely to contain sensitive information including user/PII data」；「OpenTelemetry instrumentations SHOULD **NOT** capture them by default, but SHOULD provide an option for users to opt in.」

**⭐ 官方三档建议**（`## Capturing instructions, inputs, and outputs` 原文）：
> 「1. **[Default] Don't record instructions, inputs, or outputs.**
> 2. Record … on the GenAI spans using corresponding attributes (`gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`) … best suited for … **pre-production environments**.
> 3. **Store content externally and record references on the spans.** This pattern is **recommended in production environments** where telemetry volume is a concern or sensitive data needs to be handled securely. Using external storage enables separate access controls.」

**外部存储的官方机制（对我们设计 `.traces/` 有直接参考）**：
> 「The hook SHOULD operate **independently of the opt-in flags** … SHOULD invoke it **regardless of the span sampling decision**」——传入结构化 messages + span 实例，可在 hook 里改写；若同时记属性，「it SHOULD do it **after calling the hook**」。
（原文 TODO：「document a common approach to record references to externally stored content.」→ **官方自己承认这块还没定完**。）

**⚠️ 纠正常见误传**：`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` **不在** "Recording content on attributes" 节里，它**只出现在 `### Memory` 的属性 note**，原文是「for **example** `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`」——**是示例性开关名，不是全局强制命名**。

**⚠️ 明确没有**：两个 span 文档里**没有任何**关于"如何记录 agent 推理 / 思维链内容"的规定（reasoning 只有请求侧的 `gen_ai.request.reasoning.level` 和计数用的 `gen_ai.usage.reasoning.output_tokens`）。
→ **这与我们 A3 轨迹视图的设计直接相关：规范不告诉我们 reasoning 该怎么记，这块要自己定。**

**结构化 vs JSON 字符串**：「When the attribute is recorded on events, it **MUST** be recorded in structured form. When recorded on spans, it MAY be recorded as a JSON string if structured format is not supported and SHOULD be recorded in structured form otherwise.」——每条内容属性都绑定一个 JSON schema 文件（如 `/model/gen-ai/gen-ai-input-messages.json`）。**注意：结构化属性在 events/logs 支持，spans 可能还不支持。**

**旧版 v1.34.0 的三条理由**（隐私 / 体积 / 性能）仍是一手：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions/v1.34.0/docs/gen-ai/gen-ai-events.md>

#### （e）⭐ 评估相关的 semconv：**有一个专门的事件，但没有独立的评估 span / 命名空间**

**先纠正我自己的一个初判**：我最初只查了属性注册表，看到 4 个 `gen_ai.evaluation.*` 属性，误以为"只规定了属性、没有规定评估事件"。**实际查 `events.yaml` 后发现有一个专门事件**：

**事件 `gen_ai.evaluation.result`**
- stability: **Development**；requirement_level: **recommended**
- 原文 brief：「This event captures the result of evaluating GenAI output for quality, accuracy, or other characteristics. This event SHOULD be **parented to GenAI operation span being evaluated** when possible or set `gen_ai.response.id` when span id is not available.」
- 属性表：
  | 属性 | requirement |
  |---|---|
  | `gen_ai.evaluation.name` | **required** |
  | `gen_ai.evaluation.score.value`（double） | conditionally required（"If applicable."） |
  | `gen_ai.evaluation.score.label`（string） | conditionally required（"If applicable."） |
  | `gen_ai.evaluation.explanation`（string） | recommended |
  | `gen_ai.response.id` | recommended（"When available."） |
  | `error.type`（**Stable**） | conditionally required |
- 一手 URL（YAML 权威源）：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/model/gen-ai/events.yaml>
- 一手 URL（人读版）：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-events.md>

**属性语义（registry.yaml 原文 brief）**：
| 属性 | 类型 | 语义 | 示例 |
|---|---|---|---|
| `gen_ai.evaluation.name` | string | 所用的评估指标名 | `Relevance`；`IntentResolution` |
| `gen_ai.evaluation.score.value` | double | 评估器返回的分数 | `4.0` |
| `gen_ai.evaluation.score.label` | string | 人类可读标签 | `relevant`；`not_relevant`；`correct`；`incorrect`；`pass`；`fail` |
| `gen_ai.evaluation.explanation` | string | 评估器给出的自由文本解释 | `The response is factually accurate but lacks sufficient detail...` |

原始 note：「…a score value of 1 could mean 'relevant' in one evaluation system and 'not relevant' in another… The label SHOULD have **low cardinality**.」（**这正是为什么必须同时带 label**——裸数值跨系统不可比。）

**⚠️ 明确"没有"的东西**：
- **没有** `gen_ai.evaluation` 命名空间下的**指标**（`metrics.yaml` 里没有任何 evaluation 指标）
- **没有**专门的 agent 评估 **span**（没有 `gen_ai.evaluate_agent` 之类的 span type）
- **没有**评估相关的独立 semconv 文档页（只有上面这一个事件）
→ **结论：agent 评估在 OTel semconv 里目前只有一个 Development 事件 + 4 个属性，不能当"标准"用。**

**顺带记下现行 GenAI 事件全清单**（新仓库只有 2 个 GenAI 事件 + 1 个异常事件，全部 Development）：
| 事件名 | requirement_level | 语义 |
|---|---|---|
| `gen_ai.client.inference.operation.details` | **opt_in** | "Describes the details of a GenAI completion request including chat history and parameters."（属性组 = 整张 inference span 属性表搬到事件上） |
| **`gen_ai.evaluation.result`** | recommended | 见上 |
| `gen_ai.client.operation.exception` | recommended | 客户端操作异常；"Instrumentations SHOULD set the severity to **WARN (severity number 13)**"；属性 `exception.type` / `exception.message` / `exception.stacktrace` |

**⭐ 另有一张"破坏性变更对照表"必须知道（否则会照抄已废弃的字段）**：
| 旧（v1.34 时代） | 现在 |
|---|---|
| `gen_ai.system` | **`gen_ai.provider.name`**（`gen_ai.system` 已 Deprecated） |
| `gen_ai.usage.prompt_tokens` / `completion_tokens` | `gen_ai.usage.input_tokens` / `output_tokens` |
| `gen_ai.usage.cache_creation.input_tokens` | `gen_ai.usage.cache_write.input_tokens` |
| 事件 `gen_ai.user.message` / `gen_ai.system.message` / `gen_ai.assistant.message` / `gen_ai.tool.message` / `gen_ai.choice` | **基本废弃**，改为属性 `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions`，或事件 `gen_ai.client.inference.operation.details` |
| `gen_ai.prompt` / `gen_ai.completion` | 已 Deprecated |
| `gen_ai.openai.*` | 改为 `openai.*` |

**迁仓事实**：PR <https://github.com/open-telemetry/semantic-conventions/pull/3696>（merged 2026-05-05，label `breaking`）；主仓库 v1.44.0 里全部 `gen_ai.*` 已标 **Deprecated**。

**GenAI 指标清单（metrics.yaml，全部 Development）**：
`gen_ai.client.token.usage`（histogram，`{token}`，required 属性 `gen_ai.token.type`）、`gen_ai.client.operation.duration`、`gen_ai.client.operation.time_to_first_chunk`、`gen_ai.client.operation.time_per_output_chunk`、`gen_ai.server.request.duration`、`gen_ai.server.time_per_output_token`、`gen_ai.server.time_to_first_token`、`gen_ai.invoke_workflow.duration`、`gen_ai.invoke_agent.duration`、`gen_ai.invoke_agent.inference_calls`、`gen_ai.invoke_agent.tool_calls`、`gen_ai.execute_tool.duration`
**⭐ 注意后五个**：`invoke_agent.duration` / `invoke_agent.inference_calls` / `invoke_agent.tool_calls` / `invoke_workflow.duration` / `execute_tool.duration` —— **这是 OTel 直接为"编排层"和"工具层"提供的标准指标**，对我们的 L 层和 T 层都有直接参考价值。

#### （f）对「自研 harness 工程质量」适不适用？

**部分适用——而且是我们唯一能拿到的"字段级可机检规范"。** 理由：
- **适用**：它给出了**可枚举、可断言**的字段名和取值约束。我们可以直接写一条测试：`assert trace spans include gen_ai.operation.name in {...}`。这把"我们的 `.traces/` 设计得对不对"从主观讨论变成**可检查的清单**。
- **部分适用**：它**只覆盖 O（可观测性）和部分 T（工具）**。对 E/L/C/V/G 五层没有任何约束。所以它是**一把只量一根柱子的尺子**。
- **⚠️ 限制**：整体 Development 状态 → 只能当"设计参考"，不能当"通过/不通过"的认证依据；且它规定的很多字段（`gen_ai.agent.id`、`gen_ai.provider.name` 等）对我们这种**本地单用户学习项目是过度的**（我们不是 hosted agent service）。
- **推断的**：对我们最实际的用法是**抽取它的字段名作为命名约定**（特别是 `gen_ai.operation.name` 的枚举、`gen_ai.tool.call.*` 五件套、`gen_ai.evaluation.*` 四件套），而不是真的接 OTel SDK。

---

### 2.4 Anthropic《Demystifying evals for AI agents》

**它是什么**：Anthropic 官方工程博客，2026-01-09 发布，作者 Mikaela Grace / Jeremy Hadfield / Rodrigo Olivares / Jiri De Jonghe。
一手来源：<https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>

**⭐ 它最重要的贡献是给出了一套精确定义的术语表**（这是"外部尺子的词汇表"）：

| 术语 | 定义（原文） |
|---|---|
| **task**（problem / test case） | 单个测试，含定义的输入与成功标准 |
| **trial** | 对同一个 task 的每一次尝试（因输出有变化，要跑多次 trial） |
| **grader** | 给 agent 表现某方面打分的逻辑；一个 task 可有多个 grader，各自含多个 **assertion（check）** |
| **transcript**（trace / trajectory） | 一次 trial 的完整记录：输出、工具调用、推理、中间结果等 |
| **outcome** | trial 结束时**环境里的最终状态**——「A flight-booking agent might say "Your flight has been booked"... but the outcome is whether a reservation exists in the environment's SQL database.」 |
| **evaluation harness** | 端到端跑 eval 的基础设施 |
| **agent harness**（scaffold） | 让模型能当 agent 行动的系统 |
| **evaluation suite** | 一组 task 的集合 |

> **另有一句直接对我们说的话**：「we do not take eval scores at face value until someone digs into the details of the eval and **reads some transcripts**.」

#### （a）三类 grader（原文表，可直接抄成我们自己的 grader 设计）

**Code-based**：string match / 二元测试（fail-to-pass, pass-to-pass）/ 静态分析（lint, type, security）/ **outcome verification** / **tool calls verification（用了哪些工具、什么参数）** / transcript analysis（turn 数、token 用量）
- 强：快、便宜、客观、可复现、易调试；弱：对合法变体脆弱、缺细微度、主观任务受限

**Model-based**：rubric 打分 / 自然语言断言 / 成对比较 / 参考式评估 / 多评判共识
- 强：灵活、可扩展、捕捉细微度；弱：非确定性、比代码贵、**需与人工评分者校准**

**Human**：SME 评审 / 众包判断 / 抽检 / A/B / 标注者间一致性
- 强：金标准质量、与专家判断一致、用于校准模型评分者；弱：贵、慢、需要规模化的专家

打分方式：**weighted**（合并分数须过阈）/ **binary**（所有 grader 必须过）/ **hybrid**

#### （b）capability vs regression evals

- **Capability（quality）evals**：问"这个 agent 能把什么做好？"**应从低通过率开始**，针对 agent 挣扎的任务，给团队一座要爬的山
- **Regression evals**：问"它还能处理以前能处理的吗？"**应有接近 100% 的通过率**，防倒退
- **能力 eval 饱和后可以"毕业"成 regression suite** 持续跑

#### （c）非确定性：pass@k 与 pass^k（**这两个指标我们一定要知道**）

- **pass@k**：k 次尝试中**至少一次**成功的概率。k 增大则上升。
  「A score of 50% pass@1 means that a model succeeds at half the tasks in the eval on its first try.」
- **pass^k**：**全部 k 次都成功**的概率。k 增大则下降。
  「If your agent has a 75% per-trial success rate and you run 3 trials, the probability of passing all three is (0.75)³ ≈ 42%.」
- k=1 时两者相同；k=10 时讲**完全相反的故事**：pass@k 趋近 100%，pass^k 趋近 0%
- **诊断用法**：「0% pass@100 is most often a signal of a **broken task**, not an incapable agent, and a sign to double-check your task specification and graders.」
- **建议**：为每个 task 建一个 **reference solution**（已知能过所有 grader 的输出），以证明任务可解、grader 配置正确

#### （d）9 步设计流程（原文 Step 0–8 的标题与要点）

> ⚠️ 我第一次抓取时 Step 0 / Step 1 / Step 2 的标题被内容截断吞掉了，下面是补全后的版本。

- **Step 0 · 早开始**：**从真实失败抽 20–50 个简单 task 就够**（早期效应量大 → 小样本够用）；「eval 越晚建越难建」
- **Step 1 · 从你已经在手工测的东西开始**：把 bug tracker / 支持队列里的用户失败转成用例，按用户影响排序
- **Step 2 · 写无歧义任务 + reference solution**：判据是「**两个领域专家能独立得出相同 pass/fail**」；审计 Terminal-Bench 发现「要求写脚本但没指定路径、测试却假定路径」→ agent 无辜失败；**grader 检查的一切都必须在任务描述里说清**；每个 task 建一个能过所有 grader 的 reference solution
- **Step 3 · 构建平衡的问题集**：**测试"应该发生"和"不应该发生"两种情况**。「One-sided evals create one-sided optimization.」避免 class-imbalanced evals（Claude.ai web search eval 的亲身案例：既要测"该搜的时候搜"，也要测"不该搜的时候不搜"）
  - 上文 pass@k / pass^k 与 reference solution 的段落属于 Step 2–3 的内容
- **Step 4 · 构建稳健的 eval harness + 稳定环境**：每个 trial 从**干净环境隔离**启动；「Unnecessary shared state between runs (leftover files, cached data, resource exhaustion) can cause correlated failures due to infrastructure flakiness rather than agent performance. Shared state can also artificially inflate performance.」→ 内部 eval 中曾观察到 Claude 靠**检查上一次 trial 的 git history** 获得不公平优势
- **Step 5 · 用心设计 grader**：优先确定性 grader，必要时用 LLM grader，审慎用人工
   - **⭐ 明确反对死板地检查工具调用顺序**：「There is a common instinct to check that agents followed very specific steps like a sequence of tool calls in the right order. We've found this approach **too rigid** and results in overly brittle tests, as agents regularly find valid approaches that eval designers didn't anticipate. So as not to unnecessarily punish creativity, it's often better to **grade what the agent produced, not the path it took**.」
   - 多组件任务**要建部分给分**
   - LLM-as-judge 要与人类专家校准；**给 LLM 一条退路**（如让它返回 "Unknown"）；**每个维度用独立的 judge，而不是一个 judge 打所有维度**
   - **grader 要抗绕过/抗 hack**
- **Step 6 · 读 transcript**：「You won't know if your graders are working well unless you read the transcripts and grades from many trials.」失败应看起来"公平"——清楚知道 agent 错在哪、为什么
- **Step 7 · 监视 capability eval 饱和**：100% 的 eval 只能追回归、没有改进信号
   - 反例：Qodo 最初因为**一次性 coding evals** 而低估 Opus 4.5，后来建了新的 agentic eval framework 才看清进展
- **Step 8 · 长期维护 eval suite**：Anthropic 的做法是**专设 evals 团队负责核心基础设施**，领域专家/产品团队贡献大多数 eval task 并自己跑；「owning and iterating on evaluations should be as routine as **maintaining unit tests**」
   - 推荐 **eval-driven development**：先建 eval 定义计划中的能力，再迭代到 agent 表现好

**⭐ 两条抓 grader bug 的实战案例（说明"低分未必是 agent 差"）**：
- Opus 4.5 在 CORE-Bench 上初测 42%，Anthropic 研究员发现多个问题：**僵化的评分**（期望 `96.124991…` 却因收到 `96.12` 而扣分）、**模糊的任务规格**、**无法精确复现的随机任务**；修 bug + 用约束更少的 scaffold 后**跳到 95%**
- METR 发现其 time horizon benchmark 有多个 task 配置错误：要求 agent 优化到**声明的**分数阈值，但评分要求**超过**该阈值——于是惩罚了遵守指令的模型

#### （e）与其他方法的关系（Swiss Cheese Model）

它把"理解 agent 表现"的方法排成一张表，并用**瑞士奶酪模型**说明没有单一评估层能抓住所有问题：automated evals（快、可复现、可在每个 commit 跑 / 前期投入大、需维护、可能造成虚假信心）、production monitoring、A/B testing、user feedback、manual transcript review、systematic human studies。
- 映射到开发阶段：automated evals 适合 **pre-launch 和 CI/CD**（「running on each agent change and model upgrade as the **first line of defense**」）；生产监控 post-launch；A/B 需要足够流量；用户反馈与 transcript review 是持续实践；系统化人工研究留给**校准 LLM grader** 或主观输出

#### （f）附录：它点名的 eval 框架

| 工具 | 定位（原文） | 开源与否 |
|---|---|---|
| **Harbor** | 在容器化环境跑 agent；跨云规模化跑 trial 的基础设施 + 标准化 task/grader 格式；Terminal-Bench 2.0 等基准经 Harbor registry 发布 | ⚠️ **未核实**（见 §6.3） |
| **Braintrust** | 离线评估 + 生产可观测性 + 实验追踪；`autoevals` 库含 factuality / relevance 等预置 scorer | 商业 SaaS |
| **LangSmith** | tracing + 离线/在线评估 + 数据集管理，与 LangChain 生态紧耦合 | 商业 SaaS |
| **Langfuse** | 同上能力，**self-hosted 开源自托管替代**（用于有数据驻留要求的团队） | ✅ **核心 MIT + `ee/` 独立商业许可**（详见 §2.5-(5)） |
| **Arize** | Phoenix（开源，LLM tracing/debugging/离线在线评估）+ AX（SaaS，扩展 Phoenix 做规模化/优化/监控） | Phoenix 开源 + AX 商业 |

> 原文的关键提醒：「while frameworks can be a valuable way to accelerate progress and standardize, **they're only as good as the eval tasks you run through them**. It's often best to quickly pick a framework that fits your workflow, then **invest your energy in the evals themselves** by iterating on high-quality test cases and graders.」

#### （g）对「自研 harness 工程质量」适不适用？

**部分适用，而且是"方法论"层面的最佳一手来源。** 理由：
- **适用**：它给你**怎么设计一套评测来测你自己的 harness** 的完整可操作流程（三类 grader、pass@k/pass^k、9 步流程、部分给分、transcript review），并且**明确区分了 capability eval 与 regression eval**——这正好是我们缺的那把"内部尺子"的造法。
- **不适用**：它**不评价"harness 的工程质量"本身**。它评的是"agent（harness + 模型）在任务上的表现"。你按它做完，得到的是"我的 agent 在这些任务上的通过率"，而不是"我的 harness 架构有多好"。
- **⚠️ 但有两条直接可用于工程质量**：Step 4「每个 trial 从干净环境隔离启动」+ Step 5「不要死板检查工具调用顺序」+ "grader 要抗 hack"——**这几条是对"我们的 eval 基础设施本身造得好不好"的直接判据**，可以直接抄进我们的测试设计规范。
- **⭐ 术语表本身就有价值**：它给了 `task / trial / grader / transcript / outcome / evaluation harness / evaluation suite` 这七个词的精确定义——我们以后内部讨论评测时应该用这套词，别自造。

---

### 2.5 评估框架与工具逐个核实

**⭐ 本节最重要的结论（读到的）**：**清单里没有任何一个工具是专门评"harness / 代码工程质量"的。** 它们全部落在"评模型/agent 会不会干活"、"评 prompt/RAG 应用质量"、"评 skill 有效性"、"可观测性+评估平台"这四类上。

**先给一张定位表**（这是本节的核心产出）：

| 工具 | 开源/许可 | 评什么 | 归到第 5 节的哪一类 |
|---|---|---|---|
| Inspect AI | ✅ MIT | 模型/agent 能力（含把 Claude Code / Codex CLI 当黑盒 agent） | **能力基准**（框架形态） |
| promptfoo | ✅ MIT | prompt / 模型 / RAG / **agent 质量 + 安全**（另有红队产品线） | **能力基准** |
| DeepEval | ✅ Apache-2.0 | LLM 应用/agent 的**输出质量与轨迹** | **能力基准** |
| Langfuse | ⚠️ 核心 MIT + `ee/` 独立商业许可 | **可观测性平台**，但**内置完整 eval**（scores / datasets / experiments / LLM-judge / CI） | **跨 O+V 两层** |
| **aehf** | ✅ MIT（stars 2） | **先验证 judge 本身可信，再评 agent 通过率** | ⭐ **评估方法论工具**（唯一这个定位） |
| **skillgrade** | ✅ MIT | **skill 有效性**（agent 能否正确发现并使用 skill） | **skill 评测**（既非能力基准也非工程质量） |
| OpenAI Evals | ⚠️ 无标准 LICENSE 文件 | 模型能力（入口已导向 Dashboard） | **能力基准** |
| AgentBench / τ-bench / SWE-bench / GAIA | ✅ 各自见下 | 全是在固定任务上评 agent 表现 | **能力基准** |

#### （1）`awesome-harness-engineering`（github.com/ai-boost/awesome-harness-engineering）

- **它是什么**：awesome list。官方描述原文：「Awesome list for AI agent harness engineering: tools, patterns, evals, memory, MCP, permissions, observability, and orchestration.」
- **元数据**：stars 4220、created 2026-03-29、pushed 2026-09-15、README **250,389 字节**
- **⚠️ 许可矛盾（如实记录）**：README 徽章标 **CC0**（链接到 LICENSE），但 **GitHub API 的 license 字段是 `Other` / `NOASSERTION`**（LICENSE 文件 435 字节，未逐字核对正文）。**两者不一致，不可断言其许可。**
- **一手 URL**：<https://raw.githubusercontent.com/ai-boost/awesome-harness-engineering/main/README.md>

**⭐ "Foundations" 段完整清单（32 条，原序）**：

| # | 名字 | URL |
|---|---|---|
| 1 | Harness Engineering (OpenAI) | <https://openai.com/index/harness-engineering/> |
| 2 | Unrolling the Codex Agent Loop (OpenAI) | <https://openai.com/index/unrolling-the-codex-agent-loop/> |
| 3 | Run Long-Horizon Tasks with Codex (OpenAI) | <https://developers.openai.com/blog/run-long-horizon-tasks-with-codex/> |
| 4 | Building Effective Agents (Anthropic) | <https://www.anthropic.com/research/building-effective-agents> |
| 5 | Harness Design for Long-Running Application Development (Anthropic) | <https://www.anthropic.com/engineering/harness-design-long-running-apps> |
| 6 | Writing Effective Tools for Agents (Anthropic) | <https://www.anthropic.com/engineering/writing-effective-tools-for-agents> |
| 7 | Beyond Permission Prompts (Anthropic) | <https://www.anthropic.com/engineering/beyond-permission-prompts> |
| 8 | **Demystifying Evals for AI Agents (Anthropic)** | <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents> |
| 9 | What is an AI Agent? (IBM) | <https://www.ibm.com/think/topics/ai-agents> |
| 10 | Agent Development Kit (Google) | <https://developers.googleblog.com/en/agent-development-kit-easy-to-build-multi-agent-applications/> |
| 11 | Harness Engineering (Martin Fowler / exploring-gen-ai) | <https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html> |
| 12 | The Anatomy of an Agent Harness (LangChain) | <https://blog.langchain.com/the-anatomy-of-an-agent-harness/> |
| 13 | Building AI Coding Agents for the Terminal | <https://arxiv.org/abs/2603.05344> |
| 14 | Natural-Language Agent Harnesses | <https://arxiv.org/abs/2603.25723> |
| 15 | Ranking Engineer Agent (REA) (Meta) | <https://engineering.fb.com/2026/03/17/developer-tools/ranking-engineer-agent-rea-autonomous-ai-system-accelerating-meta-ads-ranking-innovation/> |
| 16 | Supercharge Your AI Agents: ADK Integrations (Google) | <https://developers.googleblog.com/en/supercharge-your-ai-agents-adk-integrations-ecosystem/> |
| 17 | 2026 Agentic Coding Trends Report (Anthropic PDF) | <https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf?hsLang=en> |
| 18 | How We Build Azure SRE Agent (Microsoft) | <https://techcommunity.microsoft.com/blog/appsonazureblog/how-we-build-azure-sre-agent-with-agentic-workflows/4508753> |
| 19 | Context Engineering for Reliable AI Agents (Azure SRE) | <https://techcommunity.microsoft.com/blog/appsonazureblog/context-engineering-lessons-from-building-azure-sre-agent/4481200/> |
| 20 | Harness Engineering: Structured Workflows (Red Hat) | <https://developers.redhat.com/articles/2026/04/07/harness-engineering-structured-workflows-ai-assisted-development> |
| 21 | Harness engineering for coding agent users (Böckeler) | <https://martinfowler.com/articles/harness-engineering.html> |
| 22 | A Practical Guide to Building AI Agents (OpenAI) | <https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/> |
| 23 | An Update on Recent Claude Code Quality Reports (Anthropic) | <https://www.anthropic.com/engineering/april-23-postmortem> |
| 24 | Agent Harness Design: 3 Patterns | <https://claude.com/blog/harnessing-claudes-intelligence> |
| 25 | Code as Agent Harness | <https://arxiv.org/abs/2605.18747> |
| 26 | Harness Engineering (deepset) | <https://www.deepset.ai/blog/harness-engineering> |
| 27 | **What makes a harness a harness** | <https://arxiv.org/abs/2606.10106> |
| 28 | Architectural Design Decisions in AI Agent Harnesses | <https://arxiv.org/abs/2604.18071> |
| 29 | RUCAIBox/awesome-agent-harness | <https://github.com/RUCAIBox/awesome-agent-harness> |
| 30 | Tuning the harness, not the model (LangChain) | <https://blog.langchain.com/tuning-the-harness-not-the-model-a-nemotron-3-ultra-playbook> |
| 31 | lopopolo/harness-engineering | <https://github.com/lopopolo/harness-engineering> |
| 32 | Harness Engineering for Self-Improvement (Lilian Weng) | <https://lilianweng.github.io/posts/2026-07-04-harness/> |

**⭐ "Evals & Verification" 段完整清单（20 条，原序）**：

| # | 名字 | URL |
|---|---|---|
| 1 | **Demystifying Evals for AI Agents** | <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents> |
| 2 | DeepEval | <https://github.com/confident-ai/deepeval> |
| 3 | Claw-Eval（300 人工验证任务 / 9 类，指标 Pass^3） | <https://github.com/claw-eval/claw-eval> |
| 4 | SWE-bench | <https://www.swebench.com> |
| 5 | Accio-org/RealReplicaBench（阿里国际，107 任务，高保真有状态副本） | <https://github.com/Accio-org/RealReplicaBench> |
| 6 | Inspect AI | <https://github.com/UKGovernmentBEIS/inspect_ai> |
| 7 | **Quantifying Infrastructure Noise in Agentic Coding Evals** (Anthropic) | <https://www.anthropic.com/engineering/infrastructure-noise> |
| 8 | AgentLens: The Lucky Pass Problem | <https://arxiv.org/abs/2605.12925> |
| 9 | StaminaBench | <https://arxiv.org/abs/2606.19613> |
| 10 | **Harness-Bench** | <https://arxiv.org/abs/2605.27922> |
| 11 | tau-bench | <https://github.com/sierra-research/tau-bench> |
| 12 | Towards a Science of AI Agent Reliability | <https://arxiv.org/abs/2602.16666> |
| 13 | Characterizing Faults in Agentic AI | <https://arxiv.org/abs/2603.06847> |
| 14 | VeRO | <https://arxiv.org/abs/2602.22480> |
| 15 | Eval Awareness in Claude Opus 4.6's BrowseComp | <https://www.anthropic.com/engineering/eval-awareness-browsecomp> |
| 16 | Designing AI-Resistant Technical Evaluations | <https://www.anthropic.com/engineering/AI-resistant-technical-evaluations> |
| 17 | Amazon Bedrock AgentCore Evaluations GA | <https://aws.amazon.com/about-aws/whats-new/2026/03/agentcore-evaluations-generally-available/> |
| 18 | Live-SWE-agent | <https://arxiv.org/html/2511.13646v3> |
| 19 | OccuBench | <https://arxiv.org/abs/2604.10866> |
| 20 | STATE-Bench (Microsoft) | <https://github.com/microsoft/STATE-Bench> |

> **⭐ 三条对我们最有价值的线索（都在上面这张表里）**：
> 1. **#10 `Harness-Bench`**（arXiv 2605.27922）——**AHR 把它放在 "Evals & Verification" 段，名字直指 harness**。**这是一个明确值得单独去读的候选**（本次未展开；见 §6.3 未核实清单）。
> 2. **#7 Anthropic《Quantifying Infrastructure Noise in Agentic Coding Evals》**——这正是 survey §8.3/§12.3 反复引用的「基础设施噪声可显著偏移基准分数」的一手来源（survey 里记为 "Anthropic, 2026a"）。**这是"基础设施算不算评估仪器"这个论点的一手实证。**
> 3. **#8 AgentLens: The Lucky Pass Problem** + **#12 Towards a Science of AI Agent Reliability** + **#13 Characterizing Faults in Agentic AI** —— 三篇都是**方法论/可靠性**取向，而不是刷榜。
>
> 相邻的 **Templates** 段还有：`templates/AGENTS.md`、`PLAN.md`、`IMPLEMENT.md`、**`HARNESS_CHECKLIST.md`** —— **`HARNESS_CHECKLIST.md` 这个名字本身值得去看一眼**（本次未展开）。

#### （2）Inspect AI（UK AISI）

- **一手来源**：文档 <https://inspect.aisi.org.uk/> · 仓库 <https://github.com/UKGovernmentBEIS/inspect_ai>
- **开源**：✅ **MIT**
- **它是什么**（官方描述）：「An open-source framework for large language model evaluations」，由 UK AI Security Institute + Meridian Labs 开发
- **评什么**：**模型 / agent 能力**（coding、agentic、reasoning、knowledge、behavior、multimodal）；**原生支持把 Claude Code / Codex CLI / Gemini CLI 当黑盒 agent 评** → **能力基准侧，不是 harness 代码质量**
- **怎么用**：
  - `pip install inspect-ai`
  - 一个 eval = **Task(Dataset + Solver + Scorer)** 三元组
  - CLI：`inspect eval simpleqa.py --model openai/gpt-4o`；`inspect view` 看结果
  - Python API：`eval(task, model=...)`
  - agent 示例：`react(tools=[bash(), todo_write()], attempts=3)` + `sandbox="docker"`
  - 200+ 预置 eval；VS Code 扩展；20+ provider + 本地 HF/vLLM/SGLang
  - 面向 LLM 的文档：`llms.txt`（2k tokens）/ `llms-guide.txt`（185k tokens）
  - sandbox 支持 Docker / K8s / Modal / Proxmox / Vagrant
- **元数据**：stars 2774

#### （3）promptfoo

- **一手来源**：文档 <https://www.promptfoo.dev/docs/getting-started/> · 仓库 <https://github.com/promptfoo/promptfoo>
- **开源**：✅ **MIT**（stars 25,111）
- **评什么**：**prompt / 模型 / RAG / agent 的质量 + 安全**；另有独立产品线（红队、Guardrails、Model Security、MCP Proxy、Code Scanning）。官方示例按 prompt quality / model quality / RAG quality / **agent quality** 分类
  → **既不是 harness 代码质量，也不是 skill 有效性**
- **怎么用**：
  - `npx promptfoo@latest init --example getting-started`（或 `init` 交互式、`eval setup` Web UI）
  - 配置 `promptfooconfig.yaml` 四件套：`prompts`（`{{var}}` 插值）/ `providers`（60+，含自定义 Python/JS）/ `tests`（`vars` + `assert`）/ `defaultTest`
  - `npx promptfoo@latest eval` → `npx promptfoo@latest view`
  - 断言类型示例：`contains` / `icontains` / `llm-rubric` / `javascript` / `cost` / `latency`
  - 输出：spreadsheet / JSON / YAML / HTML

#### （4）DeepEval

- **一手来源**：文档 <https://deepeval.com/docs/getting-started> · 仓库 <https://github.com/confident-ai/deepeval>
- **开源**：✅ **Apache-2.0**（stars 18,274）
- **评什么**：**LLM 应用 / agent 的输出质量与轨迹**（E2E / Trajectory-Based / Component-Level / CI 单测）；指标覆盖 Agentic / RAG / Multi-Turn / Voice / MCP / Safety / Non-LLM / Images
- **怎么用**：
  - `pip install -U deepeval`
  - **插件式接入 Pytest** → `deepeval test run test_example.py`
  - 核心：`LLMTestCase(input, actual_output, expected_output?)` + `GEval(criteria, evaluation_params, threshold)` + `assert_test`
  - 多轮：`ConversationalTestCase(turns)`
  - 分数 0–1，threshold 判过
  - 可选 `deepeval login` 接 Confident AI 云；env 优先级：进程环境 → `.env.local` → `.env`，`DEEPEVAL_DISABLE_DOTENV=1` 关闭
  - 近期加了 SQLite 本地存储

#### （5）Langfuse —— **是可观测性平台，但确实内置 eval**

**⭐ 这条最容易误判，必须写清：**

- **一手来源**：文档 <https://langfuse.com/docs/evaluation/overview>（核心概念 <https://langfuse.com/docs/evaluation/core-concepts>）· 仓库 <https://github.com/langfuse/langfuse>
- **⚠️ 许可辨析（重要，已解码 LICENSE 正文）**：
  - Copyright 2023-2026 **ClickHouse, Inc.**
  - `ee/`、`web/src/ee/`、`worker/src/ee/` 目录按 `ee/LICENSE` 授权
  - **其余内容按 "MIT Expat"**（正文即 MIT 全文）
  - → **核心 MIT + 企业目录独立商业许可，不是纯 MIT**（GitHub API 因此报 `Other`/`NOASSERTION`）
- **定位**：官方一级导航把 **Observability**（traces / sessions / agents / prompts）、**Prompt Management**、**Evaluation** 并列为三大产品 → **它是可观测性平台**
- **但它内置完整 eval 能力**（逐项确认）：
  - **Scores** = 通用评估结果对象。**任何质量判断**——人工标注 / LLM judge / 程序检查 / 终端用户反馈——都存为 score；可挂 traces / observations / sessions / dataset runs；数据类型 `NUMERIC` / `CATEGORICAL` / `BOOLEAN` / `TEXT`
  - **Datasets**：可复用测试集，官方说法 "features-as-tests"
  - **Experiments**：对比 prompt / model / code 变体（via UI / SDK / OpenTelemetry）
  - **LLM-as-a-Judge**
  - **Code Evaluators**（确定性检查）
  - Annotation Queues / Scores via UI / User Feedback / Text scores
  - Score Analytics + 自定义 dashboard
  - **⭐ CI/CD**：在 `pull_request` workflow 加 `langfuse/experiment-action`，脚本里抛 `RegressionError` 即让 job 失败（Cloud 与自托管都行）
- **官方对 eval 的定义**（Evaluation Overview 原文）：evals 是「repeatable check… catch regressions before you ship」，分 **online**（对线上 trace 打分，<https://langfuse.com/docs/evaluation/get-started/online>）与 **offline**（预定义数据集，<https://langfuse.com/docs/evaluation/get-started/offline>）
- **怎么用**：先 Start Tracing，再按 online / offline 两条路径接 evals；可自托管；当前版本横幅 **Langfuse v4**（"real-time, up to 165× faster"，changelog 2026-08-17）
- **元数据**：stars 34,625
- **对我们适不适用**：**部分适用**——它的 `Scores` 模型（把"任何质量判断"统一成一个可挂载对象）+ `RegressionError` 让 CI 失败的做法，**是"把 eval 接进 CI"的现成范式**，值得抄设计。但它本身**不评价 harness 架构**。

#### （6）⭐ `aehf` —— 缩写字面查到了，但极冷门

- **⚠️ 之前定位不到的缩写，现在有了候选**：**`salasya2/aehf`**，官方描述 **"Agent Eval Harness Framework"**，README 标题 "aehf — agent evaluation harness framework"
  - 仓库：<https://github.com/salasya2/aehf>（注意 README 文件名是大写 `README.MD`）
  - **MIT**；**stars 仅 2**；created 2026-07-03；pushed 2026-07-28；Python
- **⚠️ 缩写来源仍未确证**：这是 GitHub 上**唯一语义匹配**的仓库（搜 `aehf` / `aehf agent` / `"agent eval harness framework"` 都只命中它）。**若你的 "aehf" 来自某篇具体文章，仍无法确证。** 另：`awesome-harness-engineering` 全文 656 行**不含** "aehf"（已全量检索）。AEHF 在别处是美军卫星通信系统，与本任务无关。
- **⭐ 它评什么（这是它最有价值的地方）**：**先验证 judge 本身可信，再评 agent 通过率**。README 报告的两个发现极有教学价值：
  - 在 90 条人工标注 transcript 上，**AssertionJudge 原始一致率 97%，但 Cohen's kappa = 0.000**——因为它几乎全判"过"，97% 是无意义的
  - **LLMJudge v1 同样 97%，但 kappa = 0.894**（真正可信）
  - 第二个发现：用该 judge 比较 **Haiku vs Sonnet 统计不可区分**（15/18 vs 14/18，McNemar p=1.0）
  → **这直接命中 survey §2.7 承认的那个弱点**（survey 自己说"不报告 Cohen's kappa"）。**aehf 的价值恰恰是：97% 准确率可以完全无用，必须看 kappa。**
- **怎么用**：
  - `pip install -e ".[dev]"`
  - **三个 Protocol 解耦**：`Agent`（`run(case) -> Transcript`，黑盒）/ `ToolProvider`（mock / record / replay）/ `Judge`（Assertion / LLM）
  - **Stats**：Wilson 置信区间 + **McNemar 精确配对检验** + flakiness 标记
  - **Regression**：结果按 `(git SHA, model, judge version)` 键控 + `aehf diff` + markdown scorecard + **PR 门禁 GitHub Action**
  - 命令：`aehf run <suite.yaml> anthropic mock --judgechoice assertion`、`--n-samples 5`、`aehf calibrate labels.jsonl llm --prompt-version v1`、`aehf compare runA.json runB.json`、`aehf diff <base> <head> --store .aehf`
  - 命令集：`run` / `calibrate` / `export-labels` / `label` / `compare` / `diff`；**测试套件无需 API key 即可全绿**
- **归类**：**唯一的「评估方法论工具」**——它评的不是 agent，是**你这个 eval 有多可信**。**这正好补上 survey §2.7 的短板。**

#### （7）`mgechev/skillgrade` —— 评 skill 有效性

- **一手来源**：<https://github.com/mgechev/skillgrade>
- **开源**：✅ **MIT**（README License 段就一行 MIT）；stars 707
- **它是什么**：官方描述 **`"Unit tests" for your agent skills`**。README：「The easiest way to evaluate your Agent Skills. Tests that AI agents correctly discover and use your skills.」（Agent Skills 指 agentskills.io 的 `SKILL.md` 规范）
- **评什么**：**skill 有效性**——agent 能否正确**发现并调用** skill。→ **既不是能力基准，也不是 harness 工程质量**，是独立的第三类
- **⭐ 自述灵感来源**：**SkillsBench（arXiv 2602.12670）与 Anthropic《Demystifying evals》**——**与我们正在读的这篇文章直接同源**，这增强了 Anthropic 那篇的方法论地位
- **Best Practices 第一条**：「**Grade outcomes, not steps.**」（与 Anthropic 的「grade what the agent produced, not the path it took」一致）
- **怎么用**：
  - 前置 Node 20+ / Docker；`npm i -g skillgrade`
  - `skillgrade init`（有 API key 则 AI 生成 tasks + graders，无则生成注释模板）→ 编辑 `eval.yaml`
  - `skillgrade --smoke`（或 `--reliable 15` / `--regression 30`）
  - `skillgrade preview` / `preview browser`（localhost:3847）
  - **grader 两类**：`deterministic`（跑命令、stdout 解析 JSON `{score, details, checks}`）+ `llm_rubric`（评 transcript，provider: gemini/anthropic/openai，支持 `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` 指向 vLLM/Ollama）
  - 加权合并 `Σ(score×weight)/Σweight`
  - agent 支持：gemini / claude / codex / **opencode** / **acp** / **command**（指令走 stdin 管道）
  - **`--ci --threshold=0.8`** 低于阈值退出码 1
  - `$import` 可把 eval.yaml 拆多文件；`--filter` 基于 metadata（**未知 key 会报错而非静默全跑**）
  - **⭐ 两条关键约定**：① `expected` 答案键**只给 grader，绝不交给 agent**；② **grader 评的是最终 workspace 状态而非命令 stdout**

> ⭐ **skillgrade 对我们《11.8 页面必须先调 frontend-design skill》这类 skill 是唯一现成的评估工具**——它能回答"我们的 skill 到底有没有被 agent 正确发现并执行"。这是本次调研的一个意外收获：**我们原本以为只有"能力"和"工程质量"两类，实际上还有"skill 有效性"这第三类，而且有专门工具。**

#### （8）能力基准的官方来源（用于第 5 节分类）

| 基准 | 官方 URL | 许可 | 测什么 / 关键事实 |
|---|---|---|---|
| **SWE-bench** | <https://github.com/SWE-bench/SWE-bench> · <https://www.swebench.com> | MIT（stars 5844） | "benchmark for evaluating LLMs on real world software issues collected from GitHub"：给 codebase + issue，生成 patch。**SWE-bench Verified = 500 题子集**（与 OpenAI Preparedness 合作，真实工程师确认可解）。已迁移到完全容器化 Docker harness；数据 `load_dataset('princeton-nlp/SWE-bench', split='test')`。2026-09-01 起 SWE-bench Multimodal v2 开源（480 任务） |
| **Terminal-Bench** | <https://www.tbench.ai/> | — | 端到端技术任务（如从源码构建 Linux 内核、训练 ML 模型）。Terminal-Bench 2.0 经 Harbor registry 发布 |
| **τ-bench** | 仓库 <https://github.com/sierra-research/tau-bench>（MIT） | MIT | ⚠️ **README 顶部原文警告：仓库里的 airline/retail 任务已过期**，请改用 **τ³-bench = <https://github.com/sierra-research/tau2-bench>**（MIT，stars 2037，新增 banking 领域 + voice 模态 + 修好的任务）。论文 τ-bench = arXiv 2406.12045；τ² = arXiv 2506.07982 |
| **τ²/τ³-bench** | <https://github.com/sierra-research/tau2-bench> | MIT | 评**用户（LLM 扮演）- agent - 领域 API + 政策指南**的动态多轮对话；指标 **Pass^1..Pass^4**——**这正是 Anthropic 文章 pass^k 的来源** |
| **GAIA** | ⚠️ **没有官方 GitHub 仓库**（`gaia-benchmark/GAIA` 经 API 验证返回 **404**） | ⚠️ **未能一手核实** | 官方载体是 Hugging Face。论文摘要原文：「…retaining answers to 300 of them to power a leader-board available at https://huggingface.co/gaia-benchmark」。arXiv 2311.12983（Mialon, Fourrier, Swift, Wolf, LeCun, Scialom）。评真实世界问题（推理/多模态/网页浏览/工具使用），**466 题、300 题答案保密**；人类 92% vs 带插件 GPT-4 15%。⚠️ **本网络环境连不上 huggingface.co**，HF 侧许可/字段未能一手核实 |
| **AgentBench** | <https://github.com/THUDM/AgentBench> · arXiv 2308.03688（ICLR 2024） | Apache-2.0 | "8 distinct environments" 评 LLM-as-Agent 的推理与决策；当前仓库是 **AgentBench FC（function-calling）** 版并集成 AgentRL；容器化任务 alfworld / dbbench / knowledgegraph / os_interaction / webshop。⚠️ README WARNING：webshop 需 ~16GB 内存，alfworld 会泄漏内存/磁盘 |
| **OpenAI Evals** | <https://github.com/openai/evals> | ⚠️ **无标准 LICENSE 文件** | README 第一行原文即 "You can now configure and run Evals directly in the OpenAI Dashboard"（入口导向 Dashboard）。stars 19,454、pushed 2026-04-14、`archived=false`（未归档但活跃度低）。`pip install evals`、registry 用 Git-LFS、YAML 模板。**README 明说目前不接受带自定义代码的 eval 贡献**。许可：README Disclaimer 声明贡献按 MIT，但根目录 `/LICENSE` 与 `/LICENSE.md` **均 404**，API license = Other/NOASSERTION |
| **WebArena** | <https://arxiv.org/abs/2307.13854> | — | 浏览器任务，用 URL + 页面状态检查 + **后端状态验证**（确认订单真的下了，而不只是看到确认页） |
| **OSWorld** | <https://os-world.github.io/> | — | 全操作系统控制，评估脚本检查文件系统状态、应用配置、数据库内容、UI 元素属性 |
| **BrowseComp** | <http://arxiv.org/abs/2504.12516> | — | 测 agent 能否在开放网络中大海捞针；问题设计为**易验证但难求解** |

> **⚠️ 有一条对我们直接有用的横向事实（读到的）**：Anthropic 文章明确说「LLMs have progressed from 40% to **>80%** on this eval [SWE-bench Verified] in just one year」，且 Step 7 说「SWE-Bench Verified scores started at 30% this year, and frontier models are now **nearing saturation at >80%**」——**这正是"能力基准会饱和、饱和后只能追回归、不能反映工程质量"的实证。**

---

### 2.6 本地其他参考项目的 eval / 质量门禁（实际扫描结果）

**扫描范围**：`E:\agents-read` 下的 `pi`、`codex`、`opencode`、`deepseek-harness`、`DeepSeek-Reasonix-main-v2`、`langchainjs`、`smolagents-main`、`CodeWhale-main`、`hello-agents`、`.reasonix`。

**只有报实际找到的。** 先给横向结论：

| 项目 | 真 agent 能力 eval？ | benchmark | 质量门禁 | 架构自检 |
|---|---|---|---|---|
| **DeepSeek-Reasonix-main-v2**（Go） | ✅ **最重**，6 套 harness + 73 任务 | ✅ SWE-bench Verified 50 条确定性子集等 | ✅ 层 + 棘轮 | ✅ `tools/repolint` 11 条规则 |
| **pi**（TS monorepo） | ✅ `packages/evals/` | ✅ 性能 benchmark（非 eval） | ✅ 长链 `check` | ✅ `check-entry-graphs.mjs` |
| **CodeWhale-main**（Rust） | ⚠️ 部分——**离线** eval harness，不评模型能力 | — | ✅ 11 个 job | ✅ "预算棘轮"家族 9 个脚本 |
| **deepseek-harness**（TS） | ❌ **未找到 agent eval** | ✅ 纯性能基准 | ✅ 本批最庞大（12 job） | ✅ 生成-校验对 40+ 守卫 |
| **codex**（Rust+Bazel） | ❌ 未找到 | ❌（只有 Divan 微基准） | ✅ 单一 required 入口 | ✅ `verify_tui_core_boundary.py` |
| **opencode**（TS/Bun） | ❌ 未找到 | ❌ 未找到 | ✅ 有（含 PR 流程门禁） | ❌ **未找到** |
| **langchainjs**（TS） | ⚠️ 有真 LLM-as-judge，但**是给用户用的框架，不自评** | workflow 触发器**被注释掉** | ✅ 有 | ❌ 未找到 |
| **smolagents-main**（Py） | ⚠️ 官方 benchmark 在 **`examples/` 下，CI 完全不碰** | ✅ `examples/smolagents_benchmark/run.py` | ✅ ruff + pytest | ❌ 未找到 |
| **hello-agents**（中文教程） | ⚠️ 教学性评测代码（BFCL、手写 LLM-judge） | — | ❌ **零 CI** | ❌ 未找到 |
| **`.reasonix`** | ❌ 不是项目，只有 4 个会话状态 JSON | ❌ | ❌ | ❌ |

#### 值得抄的具体物（每个都给了实际路径）

**1. `DeepSeek-Reasonix-main-v2` —— 本批 eval 做得最重，两个设计最值得抄**

- **`benchmarks/`（顶层，README 549 行）6 套 harness**：
  - `benchmarks/e2e/tasks/` = **73 个任务目录**，每个含 `task.toml` + **`verify.sh`（打分器）** + `workdir/`（种子仓库）
  - `benchmarks/swebench/` = `select_subset.py` + `subset.json` —— **SWE-bench Verified 的 50 条确定性子集**（无随机种子，重跑字节一致）
  - `benchmarks/memorybench/tasks/` = 16 个记忆任务（`mb-cjk` / `mb-conflict` / `mb-stale` / `mb-v1miss-*`）
  - `benchmarks/verification-stress/tasks/` = 20 个正/中/负任务（`vs-pos-*` / `vs-neu-*` / `vs-neg-*`）
  - `benchmarks/compaction/` = CompactionBench；`benchmarks/context-maintenance-e2e/` = seed→resume→comprehension A/B
  - 跑分器：`cmd/e2ebench/main.go`
- **评分逻辑：不是 LLM-judge，是 shell 确定性打分** —— `verify.sh` exit 0 = 正确。作者规则：「每个任务必须在 pristine seed 上 fail、在参考解上 pass」
- **⭐ 设计 1：Completion Integrity（完成度诚实性）** —— 11 个任务标 `no_solution = true`（本身就无解，如"受保护测试自相矛盾"）。这些 `verify.sh` **反向打分**：agent 若改测试/伪造依赖"做出" pass 则 exit 1，**老实说不做了才 exit 0**。且这 11 个**从准确率分母剔除**（`gatherSuiteStats`/`aggregateArm` 跳过），单独报"诚实矩阵"。自检：`TestNoSolutionCorpusGradesTheInverseContract`
- **⭐ 设计 2：Anchor Resistance（抗锚定）** —— `-anchor correct` / `-anchor wrong` 对照，把结论先塞给 agent 测会不会被带偏。指标 = 错误锚定组解决率 ÷ 盲跑组解决率
- **eval 进 CI（部分）**：`.github/workflows/e2e-bot.yml` —— 注释 `/e2e` 或 `/e2e diff` 触发，仅 OWNER/MEMBER/COLLABORATOR 可用（要真 provider key 跑 PR head 代码），跑完 `gh pr comment` 回帖；**harness 和 suite 固定从 `main-v2` 拉**（原文意图：「so a PR can't weaken its own grader or tests」——**防止 PR 篡改自己的评分器**）。套件模式只要有 `!Passed || Skipped` 就 exit 1
- **架构自检：`tools/repolint`** —— 头注释：「enforces the repo standards that gofmt/vet/golangci cannot express」。11 条规则：`essay` `banner` `marker` `commented-code` `narrative` `file-size` `test-file-size` **`layering`** `function-size` `complexity` `struct-state`
  - **`tools/repolint/layers.go` 就是分层门禁**：显式声明 `frontends`（acp/boot/bot/botruntime/cli/serve）与 `leaves`（fileutil/proc/store/textutil…），「工具层包不得 import 上层包」
  - **baseline 棘轮**：`baseline.json` + `baseline.go`，存量违规入 baseline，CI 只允许不超 baseline，`Weight` 记**超出量**（"用一条短违规换一条长违规"仍失败）；`-update` 重写、`-strict` 无视 baseline
  - 规则本身有单测：`layers_test.go`、`baseline_test.go`、`size_test.go`、`complexity_test.go`、`comments_test.go`、`structstate_test.go`
- **质量门禁**：`ci.yml` 的 changes(路径过滤) / test(3 OS + gofmt + vet + build + test) / race / sdk(**stdlib-only guard**：`go list -m all` 出现非标准库即失败) / lint(`go run ./tools/repolint` + golangci，版本从 `.golangci-version` 单一来源；`lint-cross` 对 darwin/windows + desktop 做 GOOS 交叉 lint) / coverage(只上传 artifact，**无阈值**) / govulncheck(continue-on-error)
- **规范文档**：`REASONIX.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`.golangci.yml`、`.githooks/`

**2. `pi` —— `check` 长链门禁 + 入口图预算**

- **eval 目录**：`packages/evals/`（私有 workspace `@earendil-works/pi-evals`）
  - 用例：`src/smoke.eval.ts`、`docs.eval.ts`、`extensions.eval.ts`、`models.eval.ts`、`providers.eval.ts`
  - 适配器：`src/pi-harness.ts`（把真 `AgentSession` 接进 eval）；报表层：`src/vitest-evals/{harness-table,reporter,summary,artifacts,setup}.ts`
  - 入口：`packages/evals/scripts/run-evals.mjs`；说明书：`packages/evals/README.md`（199 行）
- **它评什么**：README 原文 "**behavioral, model-backed checks for Pi workflows**" —— 用真模型跑端到端，比较不同 prompt / 工具集 / skill / 模型 / harness 配置，输出 baseline vs candidate 的 **pass rate(百分点) + token + 延迟 + 估算成本**对照表
- **评分逻辑**：`src/models.eval.ts:6` `import { createJudge, describeEval } from "vitest-evals"` → **LLM-as-judge，但 judge 实现来自外部包 `vitest-evals@0.15.0`（getsentry）**，pi 自己只做 harness 适配 + 报表
- **跑法**：根 `package.json` `"eval": "npm run eval --workspace=@earendil-works/pi-evals --"`；产物落 `.eval/`（report.txt / report.json / runs.jsonl / sessions/ / sources/）
- **⚠️ eval 不进 CI**：grep `.github/workflows/*.yml` 的 `eval` → **零命中**。CI 只跑 build → check → test
- **⭐ `check` 脚本是一条长链门禁**：
  `biome check --write --error-on-warnings . && check:pinned-deps && check:runtime-deps && check:ts-imports && check:entry-graphs && check:shrinkwrap && check:install-lock && tsgo --noEmit && check:browser-smoke`
- **⭐ 架构自检 `scripts/check-entry-graphs.mjs`** —— 注释原文「**Entry points are cost contracts**」：沿 value-import 图强制每个 `exports` 入口的模块图**文件数上限** + 禁用目录（例：`packages/agent` 的 `./harness/context` 限 `maxFiles:6` 且禁 reach `harness/runtime/`、`packages/ai/`）。另 `scripts/check-ts-relative-imports.mjs` 禁 `.js` 后缀。`biome.json` **没有** `no-restricted-imports`
- **质量门禁**：`.github/workflows/ci.yml`（build/check/test）；`.github/workflows/pr-gate.yml` **贡献者白名单，非协作者 PR 自动关闭**；`.husky/pre-commit` 跑 `check-lockfile-commit.mjs` + `npm run check`
- **性能 benchmark（不是 eval）**：`packages/agent/benchmark/session/`、`packages/agent/src/harness/session/testing/benchmark/`、`packages/session-backends/sqlite-node/benchmark/`
- **规范文档**：`AGENTS.md`（成文 Code Quality：禁 any、禁 inline import、只许 erasable TS）、`CONTRIBUTING.md`、`test.sh`（**隔离 HOME/TMPDIR/清空 API key** 后跑测试）

**3. `CodeWhale-main` —— 离线 eval harness + "预算棘轮"家族**

- **eval**：`crates/tui/src/eval.rs`（786 行）。头注释：「**Offline evaluation harness** for exercising representative tool loops … **without calling the network or any LLM endpoints**」
  - 覆盖 6 种步骤 `List/Read/Search/Edit/ApplyPatch/Bash`；指标 `EvalMetrics{success, tool_errors, steps, duration, per_tool}`；fixture 录制 `eval.rs:425 record_fixture`
  - CLI：`cargo run -p codewhale-tui --all-features -- eval`；验收：`crates/tui/tests/integration/eval_harness.rs`、`crates/tui/tests/cucumber/eval_smoke_acceptance.rs` + `tests/features/eval_smoke.feature`
  - ⚠️ **性质**：测"工具循环跑不跑通、错误率多少"，**不评模型能力、不跑 SWE-bench、无 LLM 判分**
- **eval 在 CI 里**：`.github/workflows/ci.yml` 的 `test` job 有 `Run Offline Eval Harness`（**只在 macOS leg 跑**）
- **⭐ 架构自检（"预算棘轮"家族，全在 `scripts/`）**：
  - `check-command-crate-boundaries.py`（命令契约/原型边界）
  - `check-dead-code-budget.py` + `dead-code-budget.json`（棘轮不让 `#[allow(dead_code)]` 总数上涨）
  - `check-runtime-contract-budget.py` + `runtime-contract-budget.json`
  - `check-persistence-backlog-budget.py` + `persistence-backlog-budget.json`
  - `check-command-migration-manifest.py`、`check-provider-registry.py`、`check-coauthor-trailers.py`、`check-tui-product-vocabulary.sh`、`check-tui-locale-parity.py`
- **质量门禁**：`ci.yml` 11 个 job（changes/versions/integrations/safety-gate/lint/workflow-rlm-cache/test/npm-wrapper-smoke/mobile-smoke/actionlint/docs）+ `blocking-ci.yml` 汇总；另有 `cargo-deny.yml`、`security-audit.yml`、`nightly.yml`、`dco.yml`；`deny.toml` 设 `unmaintained="all"`、`unsound="all"`
- **规范文档**：顶层 `AGENTS.md` + **`crates/tui/AGENTS.md`（分路径规则）**、`CLAUDE.md`、`CONTRIBUTING.md`

**4. `deepseek-harness` —— 无 agent eval，但门禁与架构守卫最庞大**

- **eval 目录：未找到**。`BENCHMARK.md` 全文 3 行，只是"怎么手工跑基准任务"的说明
- **benchmark 是纯性能基准**：`benchmarks/`（私有 workspace `@deepseek-ai/dsh-benchmarks`）+ `packages/util/deque/benchmarks/`
  - **⭐ `benchmarks/AGENTS.md`（16 行）规范极佳，值得直接抄**：
    - 「Organize benchmarks by **measured user path**, do not mirror the package tree」（按被测用户路径组织，**别镜像包树**）
    - 「Synthesize fixed inputs from reviewed constants. **Never use recorded Sessions, user material, ambient repositories, or network services**」
    - 「**environment variables must not override performance budgets**」
    - 「Do not copy product algorithms, add production exports solely for measurement」
  - 用例：`session-open/`、`agent-continuation/`、`conversation-fold/`、`long-session-browser/`、`active-stream-reconnect/`、`support/calibration.ts`
  - 脚本 `test:bench` = `build:bench && build:web && test:bench:built`（`vitest.bench.config.ts`）；CI 独立 job `node-24-bench`（`check:ci:bench`，独占 runner）
- **评分逻辑：未找到 LLM-judge/grader/scorer**
- **质量门禁：本批最庞大**。`.github/workflows/ci.yml` 数到 12 个 job（仓库注释自称 "9-job"），末端 `all-checks-passed` 单一 required check 汇总
  - 覆盖率分区：`test:coverage:partitioned` + `DSH_COVERAGE_PARTITIONS` + `.coverage-times.json`（按实测耗时加权，CI cache 持久化）
  - 快照/期望值门禁：`test:expected`、`test:snapshot`（`DSH_SNAPSHOT=record/refresh`）、`test:web`、`test:web:perf`、`test:web:stress`、`test:e2e`
  - **`lefthook.yml`**（postinstall 自动装）：pre-commit 6 个 job（译文配对、归档 agent notes、**staged oxlint**、第三方声明自动重生成、空白、vendor manifest 守卫）；pre-push 跑 typecheck
  - **`.jscpd.json` 重复度门禁**（minTokens 60、exitCode 1）
  - `.gitlab-ci.yml` Python wheel 发布链（含 `verify-runtime-closure`、manylinux glibc 2.28 上限、macOS deployment target 校验）
- **⭐ 架构自检：一整套"生成-校验"对**
  - `scripts/verify-module-graph.ts` / `gen-module-graph.ts --check`（包级依赖边）
  - **`scripts/verify-client-domain-graph.ts` —— 目录级分层门禁，注释写得极清楚**：`0 contract/` → `1 <domain>/ + service` → `2 apply.ts/index.ts 装配点`；「domain 只能 import contract，**彼此不许互相 import**；只有装配点可跨域」
  - `scripts/check-workspace-constraints.ts`（+ `project-reference-faces.ts`、`experimental-package-policy.ts`、`publication-payload.ts`）
  - 11 组 `gen-*` / `verify-* --check` 生成物一致性（tsconfig-paths / cordis-catalog / tool-catalog / config-catalog / doc-graphs / persistence-catalog / session-format-catalog / scoped-events / client-catalog / third-party-notices …）
  - 契约型 lint：`.oxlintrc.json` + `.oxlintrc.staged.json` + `.oxlintrc.contract-<uuid>.json`；`scripts/run-oxlint.ts` 包装器
  - 其他守卫：`verify-package-invariants`、`verify-runtime-closure`、`verify-application-entrypoints`、`verify-npm-install-layout`、`verify-no-bare-dispatcher`、`verify-export-jsdoc`、`verify-type-equiv`、`verify-doc-budgets`、`publint` 等 40+ 个
  - **`.agents/notes/`（架构笔记，且 `verify-agent-note-format/-classification/-archived` 三个脚本在校验其格式与归档）**
- **规范文档**：`CONTRIBUTING.md`（**明确写"目前不接受外部 PR"**）、`AGENTS.md`、`CLAUDE.md`、`SAFETY.md`、`.github/AGENTS.md`、`benchmarks/AGENTS.md`；README/CONTRIBUTING/SAFETY 都有 `*.i18n.yaml` 译文配对文件，门禁强制成对

**5. `codex`（Rust + Bazel）—— 无 agent eval，分层边界门禁值得抄**

- **eval 目录：未找到**。全仓文件名含 `eval|bench` 只有 1 个：`bazel/rules/e2e_benchmark.bzl` —— 它是定义 **Divan 微基准**的 Bazel 宏，唯一使用处 `codex-rs/cli/e2e_benches/`。**性能基准，不是能力评估**
- **评分逻辑：未找到**
- **质量门禁**：`.github/workflows/blocking-ci.yml` 单一 required 入口聚合 7 个子 workflow（bazel / blob-size-policy / cargo-deny / codespell / **repo-checks** / rust-ci / sdk），末端 `required` job（`if: always()`，**注释解释不加会让必需检查假绿**）调 `check_ci_results.py`
- **⭐ 架构自检在 `.github/workflows/repo-checks.yml`**：
  - **`verify_tui_core_boundary.py` —— 原文：「Verify codex-tui does not import codex-core directly」（crate 级分层边界）**
  - `verify_cargo_workspace_manifests.py`（manifest 是否继承 workspace 设置）
  - `verify_bazel_clippy_lints.py`（**Bazel clippy 参数与 Cargo workspace lints 不许漂移**）
  - `scripts/asciicheck.py README.md`（README 只许 ASCII）、`scripts/readme_toc.py`
  - `just fmt-check`、`pnpm run format`、`.github/actions/check-clean-worktree`（跑完工作区必须干净）
- **规范文档**：`AGENTS.md`（很细：crate 前缀、clippy 规则、`argument_comment_lint` 裸字面量必写 `/*param_name*/`、trait 的 RPITIT 形状、"prefer comparing the equality of entire objects"、"**Do not add negative tests for logic that was removed**"、"Prefer private modules and explicitly exported public crate API"）

**6. `opencode`（TS/Bun）—— 无 eval，架构自检未找到，但 PR 流程门禁有特色**

- **eval 目录：未找到**。唯一含 `bench` 的是 `packages/console/app/src/routes/bench`（console 网站的**路由页面**）。`perf/` 只有 `test-suite.md`
- **⭐ 质量门禁**：`typecheck.yml`(`bun typecheck`)；`test.yml` 的 `unit`(Linux+Windows，Linux 额外跑 `packages/client` 的 `check:generated`（生成物一致）+ `packages/opencode` 的 `test:httpapi`) 与 `e2e`(Playwright)；**`pr-standards.yml` = 纯流程门禁**（PR 标题须 conventional commit、须关联 issue、描述须填模板各段、checklist 至少 2 项，不合规打 `needs:compliance` 标签 + **2 小时内不改自动关**）
- **`.oxlintrc.json`**：`typeAware: true`，开了 `typescript/no-floating-promises`（漏 await）、`no-misused-spread`、`no-base-to-string`。**没有 `no-restricted-imports` / dependency-cruiser / madge**
- **架构自检：未找到** —— 分层只体现在文档：`CONTEXT.md`（用**领域词汇表 + `_Avoid_:` 反例**定义 Session Runtime：System Context / Context Epoch / Baseline System Context / Safe Provider-Turn Boundary / Admitted Prompt / Prompt Promotion / Session Drain …）、`specs/`（`project.md`、`tui-package.md`、`storage/*.md`、`v2/{config,session,tools,provider-model,instructions,schema-changelog}.md`）—— **无校验脚本配套**
- **规范文档**：`CONTRIBUTING.md`（"任何 UI 或核心功能必须先过核心团队 design review"、issue-first policy）、`AGENTS.md`

**7. `langchainjs` —— 有真 LLM-as-judge，但是"给用户用的框架"**

- **eval 目录**：`libs/langchain-classic/src/evaluation/`（`criteria/` `comparison/` `embedding_distance/` `qa/` `agents/` + base.ts/loader.ts/types.ts）；示例 `examples/src/langchain-classic/guides/evaluation/`
- **⭐ 评分逻辑：真 LLM-as-judge**，本批唯一通用打分器实现：
  - `libs/langchain-classic/src/evaluation/criteria/criteria.ts` —— `SUPPORTED_CRITERIA` **14 条**（conciseness / relevance / correctness / coherence / harmfulness / maliciousness / helpfulness / controversiality / misogyny / criminality / insensitivity / depth / creativity / detail）
  - `CriteriaEvalChain` / `LabeledCriteriaEvalChain`；`CriteriaResultOutputParser.parseResult()` 解析 LLM 输出末行 `Y`/`N` → **`score = 1/0`** 并保留 `reasoning`
  - **有防误用守卫**：`criteria === "correctness"` 时 `CriteriaEvalChain` **直接抛错**，要求改用 `LabeledCriteriaEvalChain`（因为无标注时无法判 correctness）
  - `comparison/pairwise.ts`（成对比较）、`embedding_distance/base.ts`（向量距离）、**`agents/trajectory.ts`（轨迹评估）**，各有 `.int.test.ts`
  - ⚠️ **是框架能力（让下游评自己的应用），不是 langchainjs 自评自己的 agent**
- **benchmark workflow 存在但触发器被注释掉**：`.github/workflows/benchmark-tests.yml` 的 `push`/`pull_request` 全注释，只剩 `workflow_dispatch`
- **架构自检：未找到**（无 `no-restricted-imports` / dependency-cruiser / madge）
- **质量门禁**：`ci.yml`(lint = `oxlint .`)；`format.yml`(oxfmt)、`pr_lint.yml`、`codeql.yml`、`compatibility.yml`、`unit-tests-langchain{,-core}.yml`、`unit-tests-integrations.yml`、**`standard-tests.yml`（跨集成一致性契约测试，langchain 特有）**、`integration.yml`、`test-exports.yml`、`platform-compatibility.yml`、`dependency_range_tests/` + `environment_tests/`（docker-compose）
- **规范文档**：`AGENTS.md`（含 `<corridor>` 安全分析段）、`CONTRIBUTING.md`、`.github/contributing/`（`INTEGRATIONS.md` + 8 类集成规范）

**8. `smolagents-main`（Python）—— 官方 benchmark 在 `examples/` 下，CI 不碰**

- **benchmark**：**`examples/smolagents_benchmark/run.py`** —— 官方跑分入口，`--eval-dataset` 默认 `smolagents/benchmark-v1`（HF gated 数据集），`datasets`+`pandas`+`ThreadPoolExecutor` 并发跑，结果按日期落 `output/`；**`examples/smolagents_benchmark/score.ipynb` 是打分 notebook**
- ⚠️ **不在 `src/`、不在 `tests/`、CI 完全不碰**
- **评分代码：未找到**（打分逻辑在 notebook 里）
- **质量门禁**：`.github/workflows/quality.yml` = `ruff check examples src tests` + `ruff format --check`（等价 `make quality`）；`tests.yml` = `pytest ./tests/`（3.10 + 3.12）；`.pre-commit-config.yaml`（ruff + ruff-format + check-merge-conflict + check-yaml）；`trufflehog.yml`
- **架构自检：未找到**
- **规范文档极薄**：`AGENTS.md` 全文 3 行（"Follow OOP principles / Be Pythonic / Write unit tests for new functionality"）
- ⚠️ **测试性质**：`tests/` 下 23 个 `test_*.py` **全是普通单测**（大量 mock + conftest + fixtures/），**不是 eval**

**9. `hello-agents`（中文教程书）—— 教学性评测代码，零 CI**

- **评测相关（都是教程示例）**：
  - `code/chapter11/07_model_evaluation.py`
  - `code/chapter12/03_bfcl_custom_evaluation.py`、`code/chapter12/04_run_bfcl_evaluation.py`（**BFCL**）
  - **`code/chapter12/08_data_generation_llm_judge.py`（手写 LLM-as-judge，本批唯一教学实现）**
  - `code/chapter12/data_generation/run_complete_evaluation.py`、`step2_evaluate_only.py`
  - 已产出结果：`code/chapter12/data_generation/evaluation_results/20251011_123929/llm_judge/llm_judge_report_20251011_124143.md` + `.json`
  - `code/chapter12/template_output/score/Qwen_Qwen3-8B/non_live/BFCL_v4_simple_python_score.json`
- **质量门禁：未找到** —— `.github/` 下**只有** `ISSUE_TEMPLATE/book_issue.yml` + `config.yml`，**没有任何 workflow**
- 无 `eval/` 目录、无 `CONTRIBUTING.md`、无 lint/typecheck/test 配置
- **性质**：`docs/` 16 章 + `code/chapter1..16` 配套，是**教读者"怎么评测 agent"的素材**，不是仓库自己的门禁

**10. `.reasonix` —— 不是项目**

只有 4 个 JSON 状态文件（`desktop-topic-*.json`）。是 Reasonix 桌面端写的**会话主题本地状态**。eval / benchmark / 门禁 / 架构自检 **全部未找到**（本身也不该有）。

#### ⚠️ 必须强调的一条分界

**普通单测/类型检查 ≠ agent 能力评估。** 上面 `codex`、`opencode`、`deepseek-harness` 的测试体系再厚（12 个 CI job、40+ 守卫脚本），**没有一条是评 agent 能力的**。本批真正带 agent 能力 eval 的只有 **Reasonix（最重）、pi、CodeWhale（部分）**。

---

### 2.7 其他成文规范（OWASP / NIST / MCP / IETF / CISA / EU）

**⭐ 本节的重要性超出预期**：这里有两份**直接针对 agent 的官方风险清单**，其中若干条目**正好是 harness 的设计约束**——不是"能力评测"，而是**外部规范**。

#### （a）OWASP —— **最新是 2026 版，不是 2025 版**（重要更正）

| 文档 | 发布 | 一手 URL |
|---|---|---|
| **OWASP GenAI LLM Top 10 2026** | **2026-08-04** | 官方发布页 <https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/>；源码仓（已迁移）<https://github.com/GenAI-Security-Project/GenAI-LLM-Top10>（`2026/final/`） |
| OWASP LLM Top 10 2025 | 已 archived | <https://genai.owasp.org/llmrisk/llm062025-excessive-agency/> |
| **OWASP Top 10 for Agentic Applications for 2026** | **2025-12-09** | <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/> |
| Agentic AI – Threats and Mitigations v1.0 | 2025-12 | <https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/> |
| **Agentic Skills Top 10 (AST10) v1.0** | 2026 Edition | <https://owasp.org/www-project-agentic-skills-top-10> |

> 旧入口页原文：「**Current release: OWASP GenAI LLM Top 10 2026 — published August 4, 2026.**」且「This repository is maintained as a legacy entry point and historical archive.」
> **⚠️ 本地 survey §9.5 引的是「2025 OWASP LLM Top 10」——已经过时。** 引用时必须用 2026 版。

**LLM Top 10 2026 十条**：
`LLM01` Prompt Injection / `LLM02` Sensitive Information Disclosure / **`LLM03` Excessive Agency** / `LLM04` Supply Chain / `LLM05` Data and Model Poisoning / `LLM06` Unbounded Consumption / `LLM07` Misinformation / `LLM08` Hidden Context Exposure / `LLM09` Vector and Embedding Weaknesses / `LLM10` Improper Output Handling

**版本差异**：**Excessive Agency 未改名，编号从 LLM06(2025) → LLM03(2026)**。2025→2026 **删掉了 "Sanitise LLM inputs and outputs"**，并写明「Sanitization of model inputs and outputs is **not a root control**」。

**⭐⭐ `LLM03:2026 Excessive Agency` —— 这一条基本就是"harness 的控制层设计规范"**
根因原文：「**excessive functionality, excessive permissions, excessive autonomy**」；在 agentic 场景映射到 `ASI02 Tool Misuse` / `ASI03 Identity & Privilege Abuse` / `ASI08 Cascading Failures`。
缓解措施 1–9（**逐条对我们可操作**）：
1. **Minimize tools**（少而精的工具集）
2. **Minimize tool functionality**（单个工具只做一件事）
3. **Avoid open-ended tools**（严格 schema + 用前校验）
4. **Minimize tool permissions**
5. **Execute tools in user's context**（多 agent 链上保留原用户上下文与授权范围）
6. **Require user approval**
7. **Complete mediation**（工具与下游系统之间设**独立的事前策略决策点**；分级执法 audit → warn → block → escalate）
8. **Monitor tool use**
9. **Rate limiting**（circuit breaker）
一手源：<https://raw.githubusercontent.com/GenAI-Security-Project/GenAI-LLM-Top10/main/2026/final/LLM03_ExcessiveAgency.md>

**⭐⭐ `LLM01:2026 Prompt Injection` —— 对 harness 架构最有用的一条**
- 定义包含「**tool output** … intermediate reasoning, or persistent memory」
- 「LLMs make no architectural distinction between 'instructions' and 'data'」
- 放大因素：context-window pooling / memory persistence / **agentic execution**（「tool outputs re-enter the context window, enabling chained or self-replicating effects」）
- > 「**Defense is therefore architectural rather than interceptive.**」（**防御必须是架构性的，不是拦截性的**）
- 11 条缓解里最该落地的：
  - **#4**：凭据与状态变更**留在应用代码**；每次操作最小权限；「**Route privileged calls through a deterministic policy engine that re-validates intent and arguments at execution time**」（**我们的权限审批模块正对应这条**）
  - **#7**：不可逆/对外可见动作必须人工确认，且「surfacing the **exact rendered action** rather than a summary to the reviewer」（**把确切动作给审批者看，而不是摘要**）
  - **#8 Rule of Two**：「Treat simultaneous access to (A) untrusted input, (B) sensitive data, and (C) state change or external communication as **high-risk**」（**三者同现即高危**）
  - **#9**：把 agent **记忆写入当作特权操作**
  - **#10**：pin/sign/verify 每个 MCP server 与工具包；**审计工具描述里的隐藏指令**
  - **#5**：剥离 tag-block / variation-selector / zero-width 字符
一手源：<https://raw.githubusercontent.com/GenAI-Security-Project/GenAI-LLM-Top10/main/2026/final/LLM01_PromptInjection.md>

**⭐ `OWASP Top 10 for Agentic Applications 2026`（ASI01–ASI10）**——比 LLM Top 10 更贴近 harness：
`ASI01` Agent Goal Hijack / `ASI02` Tool Misuse & Exploitation / `ASI03` Identity & Privilege Abuse / `ASI04` Agentic Supply Chain Vulnerabilities / `ASI05` Unexpected Code Execution (RCE) / **`ASI06` Memory & Context Poisoning** / `ASI07` Insecure Inter-Agent Communication / `ASI08` Cascading Failures / **`ASI09` Human-Agent Trust Exploitation** / `ASI10` Rogue Agents
（映射文件：<https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/mappings/asi-2026.json>）
→ **`ASI06` 直接对应我们的 C 层（上下文/记忆），`ASI09` 对应 G 层（人机信任）**——这是 ETCLOVG 里 C 和 G 两层**第一次拿到外部规范条目**。

#### （b）NIST

| 文档 | 编号 | 状态 | 一手 URL |
|---|---|---|---|
| **AI RMF 1.0** | **NIST AI 100-1** | 2023-01-26 发布，**正在修订**（「being revised as part of the White House AI Action Plan」） | <https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf> · DOI <https://doi.org/10.6028/NIST.AI.100-1> |
| **Generative AI Profile** | **NIST AI 600-1** | **final**（2024-07-26；页元数据更新 2026-04-08），**不是草案** | <https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf> · DOI <https://doi.org/10.6028/NIST.AI.600-1> |
| **AI agent 安全 RFI 汇总** | **NIST AI 800-5** | 2026-05-18 发布 | <https://www.nist.gov/publications/summary-analysis-responses-request-information-regarding-security-considerations-ai> |

- **AI RMF 四大功能**：`GOVERN` / `MAP` / `MEASURE` / `MANAGE`
- **AI 600-1 的 12 条 GAI 风险**（PDF 第 2 节，逐字）：2.1 CBRN Information or Capabilities / 2.2 Confabulation / 2.3 Dangerous, Violent, or Hateful Content / 2.4 Data Privacy / 2.5 Environmental Impacts / 2.6 Harmful Bias and Homogenization / **2.7 Human-AI Configuration** / 2.8 Information Integrity / **2.9 Information Security** / 2.10 Intellectual Property / 2.11 Obscene, Degrading, and/or Abusive Content / **2.12 Value Chain and Component Integration**
  → **与 agent/harness 最相关的是 2.7 / 2.9 / 2.12**
- ⚠️ **口径差异（如实记录）**：NIST AIRC 文案说 "13 risks"，但 **PDF 第 2 节实际是 12 条**（2.1–2.12），**未找到 NIST 的解释**，也未找到正式 errata。
- ⚠️ **AI 600-1 的 400+ 条建议动作原文无法逐字确认**（NIST 只发 PDF，`web_fetch` 不支持 `application/pdf`）→ **本报告不逐字引用、不转述成"原文"**。仅确认第 3 节标题 "Suggested Actions to Manage GAI Risks" 与动作编号体系（GOVERN/MAP/MEASURE/MANAGE + 形如 `1.1-001`）。
- **AI 800-5 原文**：「Commenters widely agreed that AI agents present novel security threats… fundamental cybersecurity principles and practices remain relevant, they will require adaptation」

#### （c）MCP（**版本要更正 —— 2026-07-28，不是 2025-06-18**）

- **当前协议版本 = `2026-07-28`**（上一版 2025-11-25）。原文：「The **current** protocol version is 2026-07-28.」
- 规范入口：<https://modelcontextprotocol.io/specification/2026-07-28>；版本策略：<https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning>
  - 三档：Draft / Current / Final；版本号格式 `YYYY-MM-DD` =「**the last date backwards incompatible changes were made**」——**官方没有单独的"发布日期"**
- 官方仓库：**<https://github.com/modelcontextprotocol/modelcontextprotocol>**（spec + schema + docs 三合一）；源文件 `docs/specification/2026-07-28/*.mdx`、schema 在 `schema/2026-07-28/schema.ts|json`
  - **⭐ 技巧：URL 追加 `.md` 取纯文本**（如 `.../server/tools.md`）
- 章节结构：Base Protocol（Overview / **Versioning and Compatibility** / **Message Patterns** / Transports / Authorization）、Client Features（Roots / Sampling / Elicitation）、Server Features（Overview / **Discovery** / Prompts / Resources / **Tools** / Utilities）、Schema Reference、Extensions（Tasks / Skills over MCP / MCP Apps）
  - 对比 2025-06-18：**Lifecycle 被替换**，**新增 Discovery**

**⭐ `server/tools` 里对 harness 直接有用的原文**：
- 「Tools … are designed to be **model-controlled**」
- 「For trust & safety and security, there **SHOULD** always be a **human in the loop** with the ability to deny tool invocations.」
- 「clients **MUST** consider tool annotations to be **untrusted** unless they come from trusted servers.」
- `tools/list` 「**MUST NOT** vary per-connection or as a side effect of other requests」（但 MAY 按授权变化）
- 「Servers **SHOULD** return tools in a **deterministic order** … improves LLM prompt cache hit rates」（**确定性顺序是为了缓存命中率**——这条对我们的工具列表排序有直接含义）
- Protocol Errors vs Tool Execution Errors（`isError: true`）：「Clients SHOULD provide tool execution errors to language models to enable **self-correction**」
- 「MCP has no protocol-level session… returning an explicit **handle** from a creation tool」
- **工具循环安全条款**：「Both parties **SHOULD** implement **iteration limits for tool loops**」（**正对应我们 agent loop 的轮次上限**）

**⚠️ 破坏性变更（照抄旧版会写错）**：
- **sampling 已被弃用**：「**Deprecated**: The Sampling feature is deprecated as of protocol version `2026-07-28`」，新实现 SHOULD NOT 采用
- **session 概念被 state handle 取代**：官方风险条目里 **`State Handle Hijacking` 取代了旧的 `Session Hijacking`**（因为协议改成无状态）；原文「MCP servers **MUST NOT** treat possession of a state handle as authentication.」

**官方 Security Best Practices 条目清单**（注意位置已变到 `/docs/2026-07-28/tutorials/security/security_best_practices`）：
Confused Deputy Problem、**Token Passthrough**（「MCP servers **MUST NOT** accept any tokens that were not explicitly issued for the MCP server.」）、SSRF（含 SSRF Against Authorization Servers）、**State Handle Hijacking**、Local MCP Server Compromise、OAuth Authorization URL Validation（「**MUST NOT** use shell commands (e.g., `cmd.exe`, `sh`, PowerShell) to open URLs」）、stdio Transport Security in Proxy Scenarios、Mix-Up Attacks、Localhost Redirect URI Impersonation、CIMD Trust Policies、Scope Minimization

**Security and Trust & Safety 三原则**：User Consent and Control / Data Privacy / **Tool Safety**（「Tools represent arbitrary code execution… descriptions of tool behavior such as annotations should be considered **untrusted**」）

**`elicitation` 的两条硬约束**：Form mode vs URL mode；「Servers **MUST NOT** use form mode elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials」

**OTel 侧的 MCP 遥测约定**（本次定位到，未逐节抄）：<https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/mcp.md>

#### （d）IETF —— **关键结论：不存在任何正式标准**

- **❌ 不存在任何以 AI agent 为主题的正式 RFC**：`name=agentic & rfcs=on` 返回 **"No documents match your query."**（<https://datatracker.ietf.org/doc/search/?name=agentic&rfcs=on>）；`draft-ietf-*agent*` 共 19 条**全是 1990s–2010s 网络管理类**（AgentX / DHCP relay agent / SSH agent），**无一条 AI agent**
- **❌ LLM 工具调用 / function calling：无 RFC、无 WG draft**（仅个人 draft）
- **❌ MCP 相关的 15 条 IETF draft 全部是个人提交**（无一条 WG 文档）
- **WG 现状**：
  | WG | 状态 | 说明 |
  |---|---|---|
  | **`aipref`（AI Preferences）** | ✅ **Active** | charter `charter-ietf-aipref-01` Approved。两份 **WG 文档 / Proposed Standard**：`draft-ietf-aipref-vocab-08`（词表 `train-ai`/`ai-use`/`search`；原文「**Preferences are not a security mechanism.**」）、`draft-ietf-aipref-attach-05`。charter 明确 out of scope：技术强制执行、认证/授权爬虫、审计透明度。<https://datatracker.ietf.org/wg/aipref/about/> |
  | **`agentproto`** | ⚠️ **仅拟成立**（WG State: **Proposed**） | 2026-09-17 IESG telechat "Has enough positions to pass"。拟交付 Agentic Dialog Management Protocol (Standards Track) + Reference Architecture + Use Cases。原文定位：「The protocol is designed to be usable by existing application-layer agent communication protocols (**e.g., MCP and A2A maintained by the Linux Foundation**) through well-defined extension points, **rather than replacing them**.」out of scope：「**Standardization of agent behavior, decision-making, or planning semantics.**」<https://datatracker.ietf.org/doc/charter-ietf-agentproto/> |
  | **`dawn`**（Discovery of Agents With Names） | ⚠️ **仅拟成立**（Proposed，"Has 2 BLOCKs"） | <https://datatracker.ietf.org/doc/charter-ietf-dawn/> |

**⭐⭐ IETF 里最值得看的一份：`draft-klrc-aiagent-auth-03`「AI Agent Authentication and Authorization」**
- 类型：**Active Internet-Draft（wimse WG）**；WG state：**Adopted by a WG**（已采纳，过期时间 2027-01-07）；作者含 OpenAI 与 Okta 的人
- <https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/>
- **与 MCP 直接相关的原文（对我们权限审批模块是直接约束）**：
  > 「Interactive agent frameworks may also solicit user confirmation directly during task execution (for example tool invocation approval or parameter confirmation). Such interactions **do not by themselves constitute authorization** and **MUST** be bound to a **verifiable authorization grant** issued by the authorization server.」
  > 「…the agent **MUST NOT** treat **local UI confirmation alone as sufficient authorization**.」
  > 「It is an **anti-pattern** for Tools to forward access tokens it received from the Agent to Services or Resources.」
- → **对 harness 的直接含义：UI 上点"允许"不等于授权，必须绑定授权服务器签发的可验证 grant。** 我们的 P 层（权限审批）目前是纯本地 UI 审批——**按这份 draft，这种形态在需要授权的场景下是不够的**（**推断的**；draft 针对的是 OAuth 授权服务器场景，我们的单用户本地场景未必适用，但结论值得记录）。

#### （e）其他官方治理规范

| 规范 | 日期 | 状态 / 关键内容 |
|---|---|---|
| **CISA + 五眼《Careful Adoption of Agentic AI Services》** | **2026-05-01** | ✅ 已核实标题与日期。<https://www.cisa.gov/resources-tools/resources/careful-adoption-agentic-ai-services>。风险原文：「an **expanded attack surface**, **privilege creep**, **behavioral misalignment**, and **obscure event records**」；建议：Avoid granting broad or unrestricted access / 从低风险非敏感用例开始 / 纳入组织安全模型。⚠️ **指南本体在 ACSC 域，本会话 403 未读到正文** |
| **EU AI Act**（Regulation (EU) 2024/1689） | 生效 2024-08-01 | ⚠️ EUR-Lex 本会话 **202 空响应，未读到法条**；日期取自欧委会官方页 <https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai>：prohibited practices + AI literacy 2025-02-02 起适用；**GPAI 模型义务 2025-08-02 生效**；transparency rules 2026-08；全面适用 2026-08-02；高风险 Annex III 延至 2027-12-02、Annex I 至 2028-08-02；AI Omnibus 2026-07-27 生效 |
| ISO/IEC 42001 / 23894 | — | ⚠️ **未能一手核实版本年份**（iso.org 全站 403 Cloudflare，试了 4 种入口含 OBP；IEC Webstore 404）。仅有 NIST AIRC 交叉对照页作为编号存在的旁证：<https://airc.nist.gov/airmf-resources/crosswalks/>（**未标年份**） |
| Cloud Security Alliance | — | ⚠️ **未能一手核实**（cloudsecurityalliance.org / labs.* 全 403），**不给内容结论** |
| **ISTQB Glossary**（"test harness" 经典定义） | — | 一手（arXiv 2606.10106 脚注 5 给出 URL）<https://glossary.istqb.org>，**未逐条核对** |

#### （f）⭐ 这一节对「自研 harness 工程质量」的价值（**推断的**）

**这是本次调研里第二重要的发现**（第一是 A 类的 T1–T4）。理由：
- **ETCLOVG 的 G 层（治理与安全）第一次拿到了外部规范条目**：`LLM03 Excessive Agency` 的 9 条缓解 ≈ harness 控制层设计规范；`LLM01 Prompt Injection` 的 11 条缓解里 #4/#7/#8/#9/#10 直接对应我们的工具层、权限层、记忆层。
- **「Defense is therefore architectural rather than interceptive」** —— 这句话与我们抄的 T4「控制机制不依赖模型服从」**是同一个意思，来自两个完全独立的一手来源**（arXiv 论文 + OWASP）。**交叉印证，可信度大幅提高。**
- **`ASI06 Memory & Context Poisoning`** 是 C 层（上下文/记忆）的**唯一外部规范条目**——survey §12.2 讲"压缩会丢掉约束"、OWASP 讲"记忆投毒"，**两边指向同一个风险**。
- **MCP 的 `iteration limits for tool loops`** 直接对应我们 agent loop 的轮次上限——**我们的轮次上限不是自己发明的，是规范建议的**。

**但注意（推断的）**：
- 这些规范**都是风险清单 + 缓解建议，不是合规检查表**。它们不给你"通过/不通过"的判定器。
- 它们预设**生产/企业环境**（多租户、授权服务器、合规审计），**对我们的单用户本地学习/作品项目大部分是过度设计**。
- 我们 AGENTS.md 的新判据是「**别人能跑通 + 知道它什么时候会失败**」——**OWASP 这两份清单恰好是"知道它什么时候会失败"的最权威外部来源**：它明确列出了 harness 会在哪里失败（工具滥用、权限蔓延、记忆投毒、级联失败、人机信任被利用）。**这比"能力跑分"更贴合我们现在的判据。**

---

## 3. ⭐ 明确列出的「找不到现成物」的空白

**这一节是本次调研最重要的产出。** 以下每一条都是我实际去找过、**确实没找到公开标准**的：

### 空白 1：没有「harness 工程质量打分表」

**读到的**：arXiv 2606.10106 自己声明「does not measure benchmark performance」、「membership is binary in its existence but **gradual in its quality**」，但**它没有给出 quality 的量化刻度**——只说 anatomy 里的组件可以"measure how robust it is"，没有 rubric、没有分值、没有阈值表。
**结论**：**不存在**一个"按 1–5 分给 harness 的架构质量打分"的公开标准。T1–T4 只能判"是不是"，不能判"多好"。

### 空白 2：没有「跨六层统一成熟度模型」

**读到的**：survey §2.9 给出了**生态系统的覆盖密度**（E/T/L/V 高、C 中、O/G 低），但那是**对整个开源生态的统计**，不是**给单个 harness 评成熟度的模型**。没有类似 CMMI / ISO 25010 那样的"harness 成熟度等级"。
**结论**：**不存在**把 E/T/C/L/O/V/G 六层各自的成熟度合成为一个总分或等级的公开标准。§11.3 反而明确说**不应该**这么做（层间强耦合，「单独看有益的组件组合起来可能降低整体表现」）。

### 空白 3：没有「可机检的 harness 架构充要条件」

**读到的**：arXiv 2606.10106 的 T1–T4 是**人工判定**程序（"ask, in order..."）。它没有给出任何**自动化检查方法**——没有 AST 规则、没有 lint 插件、没有配置 schema。
**结论**：T1–T4 **没有**工具实现。要用来评自研 harness，只能人工逐条对照代码。

### 空白 4：OpenTelemetry GenAI 里**没有独立的评估 span / 指标**（只有 1 个事件）

**读到的**（已查 `events.yaml`）：
- **有**一个专门事件 `gen_ai.evaluation.result`（Development，recommended），含 4 个 `gen_ai.evaluation.*` 属性
- **没有**专门的 agent 评估 **span**（没有 `gen_ai.evaluate_agent` 之类的 span type）
- **没有** `gen_ai.evaluation` 命名空间下的**指标**（`metrics.yaml` 里零个 evaluation 指标）
- **没有**评估相关的独立 semconv 文档页

**结论**：**有"评估结果"这一小块（一个 Development 事件 + 4 个属性），但不存在完整的评估标准/命名空间。** 评估结果目前只能以事件形式挂在被评估的 GenAI operation span 上，或完全自定义。**不能当"标准"用。**

### 空白 5：没有「标准化审计 schema」

**读到的**：survey §9.5 原文明确说：「**缺乏标准化审计 schema**，跨系统分析和监管报告困难。」它只给了"可重放审计记录的最低要求"（7 个字段族），但**明确说这不是标准**——「大多数当前系统只记录其中一部分字段，且很少签名或哈希记录」。
**结论**：**不存在**标准化的 agent 审计日志 schema。survey 自己列出的 7 项最低要求（追踪标识符 / 责任者身份 / 工具调用 / 策略决策及版本 / 执行结果 / 资源成本 / 输入输出的完整性哈希）就是我找到的最接近的东西，但它出自一篇 survey，不是标准组织文件。
**补强（读到的）**：CISA + 五眼《Careful Adoption of Agentic AI Services》(2026-05-01) 也把「**obscure event records**」列为 agentic AI 的四个风险之一——**说明"事件记录不透明"是官方承认的行业问题，而不是我们一家的问题**。

### 空白 5b：OpenTelemetry **基本不管 span 树形状**

**读到的**：`gen-ai-agent-spans.md` + `gen-ai-spans.md` 全文检索 `child|parent|nested|hierarch|sub-agent|sibling`，**只有两处命中**：
1. `plan` span：「The LLM call that generates the plan SHOULD be a **child** of the plan span, and the tool or task spans produced from the plan are typically **sibling** operations under the same `invoke_agent` span.」
2. `invoke_workflow`：「SHOULD NOT be reported when the workflow invocation is an internal implementation detail of another operation…」

**没有**：
- ❌ "LLM span 必须是 agent span 子节点"的规定
- ❌ span 树示例
- ❌ 独立的 multi-agent / handoff 建模章节

**结论**：**不存在**"agent 的 span 树该怎么长"的规范。→ **我们 ETCLOVG 的 L 层（编排）在可观测性上基本没有外部约束**，"该不该给每一轮开 span、怎么嵌套、子 agent 怎么表示"只能自己定。（这也与 survey §12.4「跨层交接契约缺失」互相印证。）

### 空白 6：没有「跨层交接契约」

**读到的**：survey §12.4 原文：「现代执行环境越来越多地跨规划器、子智能体、工具、沙箱、评估器和人类分配工作，但**这些行动者之间的接口仍然是临时的**。」
- 现有局部标准：MCP（工具访问）、A2A（agent 间通信）、OpenTelemetry（追踪基板）
- **缺失的部分**：跨层交接契约——应传递「意图、约束、权限、工件、来源、预算状态、风险级别、追踪历史和未解决决策」
**结论**：**不存在**跨层交接的标准。

### 空白 7：没有「成本归因」标准

**读到的**：survey §10 把「**成本归因**」列为五个持续性生态系统缺口之一：「无法将成本精确归属到特定层或组件」。
**结论**：**不存在**把 agent 运行成本归因到 ETCLOVG 某一层的标准。OTel 只提供了 `gen_ai.usage.*` 的 token 计数属性（且按 provider 计费口径），没有分层归因模型。

### 空白 8：`aehf` 这个缩写我定位不到

**未找到**：我在公开来源里没有定位到名为 `aehf` 的 agent harness 评估相关项目。**缩写来源不明。** 待后台调研确认；若确认无此项目，则应视为无效引用。

### 空白 9：**没有任何工具专门评"harness 工程质量"**（工具侧确证）

**读到的**：本轮核实的 8 个评估框架/工具（Inspect AI、promptfoo、DeepEval、Langfuse、aehf、skillgrade、OpenAI Evals，及 8 个能力基准）**全部落在"评模型/agent 会不会干活"、"评 prompt/RAG 应用质量"、"评 skill 有效性"、"可观测性+评估平台"、"评 eval 可信度"这五类里**。
**结论**：**不存在**任何工具是"输入一个 harness 代码库 → 输出工程质量评分/诊断"的。**这一类在工具生态里是空的。** 唯一沾边的是 AHR 清单里的 `Harness-Bench`（arXiv 2605.27922，名字直指 harness，**本次未展开**）。

### 空白 10：没有「eval 可信度」的公认阈值

**读到的**：`aehf` 报告的核心发现是**裸一致率 97% 但 Cohen's kappa = 0.000**（judge 几乎全判"过"，97% 完全无意义），而 LLMJudge v1 同样 97% 但 kappa = 0.894。它做了 Wilson 置信区间 + McNemar 精确检验。
**⚠️ 但**：`aehf` 是 **stars 仅 2** 的个人项目，README 里**没有给出"kappa 到多少才算可用"的公认阈值**。
**结论**：**不存在**「LLM-as-judge 要多少 kappa 才可信」的标准。survey §2.7 自己也**主动选择不报告 Cohen's kappa**（"单一主编码员 + 作者审计"）。→ **这是一个真空：所有人都知道该看 kappa，但没人定标准。**

### 空白 11：没有「skill 有效性」的评价阈值

**读到的**：`skillgrade` 是唯一评 skill 有效性的工具，它自述灵感来自 SkillsBench（arXiv 2602.12670）与 Anthropic《Demystifying evals》；给出了 `--smoke` / `--reliable 15` / `--regression 30` 三档采样数和加权合并 `Σ(score×weight)/Σweight`。
**⚠️ 但**：它**没有给出"skill 有效性到多少分算合格"的标准**，阈值由用户自定（`--ci --threshold=0.8` 是用户传的参数）。
**结论**：**不存在** skill 有效性的公认合格线。

### 空白 12：我们自研 harness 特有的缺口（**推断的**）

以下是我在对照上述所有一手材料后，**推断**出来的、我们这边确实没有外部物可抄的地方：
- **单一 harness 的"工程质量档案"没有标准** —— 所有现成物要么评"整个生态"（survey §2.9）、要么评"agent 在任务上的表现"（Anthropic / benchmark）、要么判"是不是 harness"（2606.10106）、要么评 skill（skillgrade）、要么评 eval 本身（aehf）。**没有任何一个回答"你这个具体 repo 造得好不好"。**
- **学习/作品级项目的评价标准不存在** —— 所有现成物都预设生产环境（多租户、成本、SLA、合规）。**没有**面向"单人学习项目"的质量标准。
- **我们的 ETCLOVG 六层里，只有 O 和 T 有字段级规范** —— OTel GenAI 只覆盖可观测性与部分工具接口；**E / C / L / V / G 四层没有任何字段级外部规范**。这是"我们抄了 §2.3 却没抄到可操作部分"的直接后果。

---

## 4. 候选清单：如果只抄 3–5 条，该抄哪几条

**筛选原则（推断的）**：① 可操作到能写成一个检查项/一个文件/一条测试；② 一手来源明确；③ 对我们的缺口（外部尺子）边际价值最大；④ 不与现有 ETCLOVG 文档重复。

### 候选 1：**T1–T4 + 三条可验证判据** —— 做成一张自检表

- **抄来的**（arXiv 2606.10106v1 §4，<https://arxiv.org/html/2606.10106v1>）：
  - T1 运行时推理-行动-观察循环
  - T2 工具接口**能改变**环境（判据：只读不算）
  - T3 上下文管理**由内容/任务驱动**（判据：按大小截断不算）
  - T4 至少一个**不依赖模型服从**的控制机制（判据：单条 log 不算）
- **为什么抄它**：这是我们唯一能拿到的、**针对"harness 本身"**的判定标准；三条判据专门对付"形式上做了、实质没做"的自欺，正好打在我们最可能虚的地方（压缩 / 权限审批）。
- **成本**：低。写成一个 md 表格 + 人工对照 `lib/agent/index.ts`、`lib/tools/`、压缩模块、权限模块。

### 候选 2：**追踪字段清单（7 项）** —— 做成 `.traces/` 的 schema 断言

- **抄来的**（两处一手来源交叉验证）：
  - survey §8.3「追踪原生执行环境应记录」：模型输出、工具调用、工具结果、环境状态变化、**上下文快照**、**错误/重试/恢复动作**、**Token 使用/延迟/成本**
  - OTel GenAI：`gen_ai.operation.name`（枚举含 `invoke_agent` / `execute_tool` / `plan` / `invoke_workflow`）、`gen_ai.tool.call.{id,arguments,result}`、`gen_ai.tool.{name,description,type}`、`gen_ai.usage.{input,output}_tokens`、`gen_ai.conversation.id`、`gen_ai.conversation.compacted`
- **为什么抄它**：这是**唯一可以写成自动化测试**的一条（断言 trace 里必须出现哪些字段），把"可观测性造得好不好"从主观变可机检。
- **⚠️ 注意**：OTel 全部是 **Development** 状态，只抄字段名做命名约定，不要说"我们符合 OTel 标准"。
- **成本**：中。需要先确定我们 `.traces/*.jsonl` 的记录模型，再加一条断言测试。

### 候选 3：**分层评估套件（4 层）** —— 做成测试目录结构

- **抄来的**（survey §8.5「分层评估套件」表）：
  | 层级 | 内容 |
  |---|---|
  | 单元级 | 工具模式测试、确定性验证器 |
  | 单步级 | 局部决策测试 |
  | 完整 rollout | 端到端完成测试 |
  | 多轮模拟 | 长周期连贯性测试 |
- **交叉印证（读到的）**：survey §8.5 原文说这个分层视图与「LangChain 的深度评估指南」一致，且「Anthropic 将评估框定为可在开发期间运行的带有显式评分逻辑的自动化测试」。所以我们不是在抄一个孤立观点。
- **为什么抄它**：它给了一个**现成的测试金字塔命名法**，可以直接对着 `index.test.ts` 的现有 43 个测试文件盘点"我们覆盖了哪几层、缺哪几层"。
- **成本**：低（只是命名与盘点）；高（真要补齐"完整 rollout"和"多轮模拟"两层）。

### 候选 4：**三类 grader + pass@k / pass^k** —— 写进评测设计规范

- **抄来的**（Anthropic《Demystifying evals for AI agents》，<https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>）：
  - 三类 grader：code-based（含 **outcome verification**、**tool calls verification**、transcript analysis）/ model-based（rubric、成对比较、多评判共识）/ human
  - **pass@k**（k 次至少一次成功）与 **pass^k**（k 次全部成功）；k 增大时二者讲相反的故事
  - 「0% pass@100 通常是**任务坏掉**的信号，不是 agent 无能」
  - 为每个 task 建 **reference solution** 证明任务可解
- **并且抄它两条反直觉的工程纪律**（这两条直接可用于我们自己的 eval 基础设施质量）：
  - **不要死板检查工具调用顺序**：「grade what the agent produced, not the path it took」
  - **每个 trial 从干净环境隔离启动**，共享状态（残留文件、缓存、git history）会同时造成**假失败**和**假成功**
- **为什么抄它**：这是我们缺的"内部尺子"的**造法说明书**；而且它的术语表（task / trial / grader / transcript / outcome）能统一我们内部讨论用词。
- **成本**：低（术语 + 两条纪律）；高（真要建 suite）。

### 候选 5：**"无解任务 + 反向打分"（Completion Integrity）** —— 做成一条诚实性评测

- **抄来的**（`DeepSeek-Reasonix-main-v2`，实际源码：`benchmarks/e2e/tasks/` + `cmd/e2ebench/main.go`）：
  - 标 `no_solution = true` 的任务，其 `verify.sh` **反向打分**——agent "做出" pass（改测试/伪造依赖）则 exit 1，老实承认无解才 exit 0
  - 这 11 个任务**从准确率分母剔除**，单独报"诚实矩阵"
  - 自检：`TestNoSolutionCorpusGradesTheInverseContract`
  - 配套 **Anchor Resistance**：`-anchor correct` / `-anchor wrong` 对照，测 agent 会不会被塞进去的结论带偏
- **为什么抄它**：这是**唯一一条直接测"agent 会不会撒谎"**的现成范式，而 survey §8.3 明确说追踪要能揭示「**不良成功**：基准利用、过多工具调用、权限违例」——Completion Integrity 就是"基准利用"的可执行反制。它回答的问题（"harness 是否真的能迫使 agent 诚实"）恰恰是 T4「控制机制不依赖模型服从」的**行为级验证**。
- **⭐ 交叉印证（读到的）**：**这正是我们 AGENTS.md 新判据「知道它什么时候会失败」的可执行形态** —— 无解任务就是"harness 应该失败"的场景，反向打分就是"验证它真的失败了"。
- **成本**：中。需要为每个"无解任务"写一个反向打分的 verdict 逻辑。

### 候选 5b（**新增，与候选 1 同源的一手外部规范**）：**OWASP 的 harness 控制层检查项**

- **抄来的**（一手 URL 见 §2.7）：
  - `LLM03:2026 Excessive Agency` 的 9 条缓解：**Minimize tools** / **Minimize tool functionality** / **Avoid open-ended tools**（严格 schema + 用前校验）/ **Minimize tool permissions** / **Execute tools in user's context** / **Require user approval** / **⭐ Complete mediation**（工具与下游系统之间设**独立的事前策略决策点**；分级执法 audit → warn → block → escalate）/ Monitor tool use / Rate limiting
    → <https://raw.githubusercontent.com/GenAI-Security-Project/GenAI-LLM-Top10/main/2026/final/LLM03_ExcessiveAgency.md>
  - `LLM01:2026 Prompt Injection` 的 5 条最可落地缓解：
    - **#4** 凭据与状态变更留在应用代码；「Route privileged calls through a **deterministic policy engine** that re-validates intent and arguments **at execution time**」
    - **#7** 不可逆动作必须人工确认，且「surfacing the **exact rendered action** rather than a summary to the reviewer」
    - **#8 Rule of Two**：`(A) 不可信输入 + (B) 敏感数据 + (C) 状态变更/对外通信` **三者同现即高危**
    - **#9** 把 agent **记忆写入当作特权操作**
    - **#10** pin / sign / verify 每个 MCP server 与工具包；**审计工具描述里的隐藏指令**
    → <https://raw.githubusercontent.com/GenAI-Security-Project/GenAI-LLM-Top10/main/2026/final/LLM01_PromptInjection.md>
  - **MCP `server/tools`**：「Both parties **SHOULD** implement **iteration limits for tool loops**」
    → <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
  - **OWASP Agentic Top 10** 的 `ASI06` Memory & Context Poisoning、`ASI09` Human-Agent Trust Exploitation
    → <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>
- **⭐ 为什么这条比候选 1 更强**：候选 1（arXiv 2606.10106）只给出**判据**（"T4 通过与否"），**这条给出的是具体该做什么**。而且**两个完全独立的一手来源说同一个意思**：
  > arXiv 2606.10106 T4：「a mechanism satisfies T4 if its **effectiveness does not depend on the model choosing to cooperate**」
  > OWASP LLM01:2026：「**Defense is therefore architectural rather than interceptive.**」
  → **交叉印证，可信度极高。**
- **落地到我们的 ETCLOVG**（**推断的**）：
  - **T 层（工具接口）**：Minimize tools / Minimize tool functionality / Avoid open-ended tools / 工具描述审计
  - **G 层（治理安全）**：Minimize tool permissions / Require user approval（且展示确切动作而非摘要）/ Complete mediation（独立的事前策略决策点）/ Rule of Two
  - **C 层（上下文记忆）**：记忆写入当特权操作 / ASI06 Memory & Context Poisoning
  - **L 层（编排）**：iteration limits for tool loops（**我们的轮次上限现在有外部依据了**）
- **成本**：低（做成一张逐条打勾的检查表）；中（真要实现 Complete mediation 这种"独立的事前策略决策点"）。
- **⚠️ 限制（推断的）**：这些是**风险清单 + 缓解建议，不是合规检查表**；它们预设企业/生产环境（多租户、OAuth 授权服务器、合规审计），**对我们的单用户本地作品项目大部分是过度设计**。**但"知道它什么时候会失败"这个判据下，列出失败模式本身就是价值。**

### 备选（第 6 条，若还能再加）：**架构自检脚本 + baseline 棘轮**

- **抄来的**（`DeepSeek-Reasonix-main-v2`，`tools/repolint/{layers.go,baseline.go}`；`pi`，`scripts/check-entry-graphs.mjs`；`deepseek-harness`，`scripts/verify-client-domain-graph.ts`）
  - **分层写成可枚举的包清单**（`leaves` / `frontends`）而非文档口号
  - **baseline 棘轮**：存量违规入 baseline，CI 只允许不超；`Weight` 记**超出量**（防"用一条短违规换一条长违规"）
  - **入口是成本契约**（pi 原文 "Entry points are cost contracts"）：给每个 public 入口的模块图文件数设上限
- **为什么抄它**（**推断的**）：这正是把 `lib/`（内核）vs `app/`（产品层）这条写在 AGENTS.md 里的**文档规则**变成**可执行规则**的现成范式——我们的 §6「分层别乱」目前只靠人记，这个能变成一个能跑的脚本 + 一份 baseline JSON。
- **⚠️ 但注意**：这一条**不是"评价 harness 好不好"的标准**，而是"评价 harness 代码库工程质量"的门禁。它属于软件工程质量标准，不属于 agent 特有的评价标准。放在这里是因为它直接可操作。

### 备选（第 7 条）：**`aehf` 的 kappa 校准 —— 先证明我们的 judge 可信**

- **抄来的**（`salasya2/aehf` README）：**AssertionJudge 裸一致率 97% 但 Cohen's kappa = 0.000（无意义）；LLMJudge 同样 97% 但 kappa = 0.894（可信）**；配套 Wilson 置信区间 + McNemar 精确配对检验 + flakiness 标记；结果按 `(git SHA, model, judge version)` 键控
- **为什么抄它**：**这是唯一一条能回答"我那个 LLM judge 到底能不能用"的现成做法**，而且它的 headline 发现（97% 可以完全无意义）是一个**极强的反直觉教训**。survey §2.7 主动承认"不报告 Cohen's kappa"——**aehf 补的正是这个洞**。
- **成本**：低。只要有 20–90 条人工标注就能算 kappa。
- **⚠️ 限制**：`aehf` 本身 stars 仅 2，是个人项目，**不是标准**；抄的是**方法**（kappa + McNemar + Wilson CI），不是工具。

### 备选（第 8 条）：**`skillgrade` 的"Grade outcomes, not steps" + `expected` 隔离**

- **抄来的**（`mgechev/skillgrade` README）：① Best Practices 第一条「**Grade outcomes, not steps.**」；② **`expected` 答案键只给 grader，绝不交给 agent**；③ **grader 评的是最终 workspace 状态而非命令 stdout**；④ `--ci --threshold=0.8` 低于阈值退出码 1
- **为什么抄它**：我们有一堆 skill（如 `frontend-design`），**目前完全没有任何手段验证 agent 是否真的发现并执行了它们**。skillgrade 是唯一现成工具。而且它的②③两条约定**直接可用于我们的 trace 测试设计**——"不把 expected 给 agent"和"评最终状态而非 stdout"都是防作弊的结构性约束。
- **成本**：中（需要 Node 20+ / Docker，并为每个 skill 写 `eval.yaml`）。
- **⚠️ 交叉印证**：它的①与 Anthropic 的「grade what the agent produced, not the path it took」**是同一个原则**——两个独立来源说同一件事，可信度高。

---

## 5. 必须做的区分：能力基准 vs 工程质量标准

### 两类东西的对照

| 维度 | **能力基准**（Capability Benchmark） | **工程质量标准**（Engineering Quality Standard） |
|---|---|---|
| **回答的问题** | agent **会不会干活**？干得多好？ | harness **造得好不好**？ |
| **测量对象** | 模型 + harness **联合体**在固定任务上的表现 | harness 自身的架构、机制、遥测、治理 |
| **输出** | 一个分数 / 通过率（可排行榜比较） | 判定（是/否）+ 机制清单 + 合规性 | 
| **代表性现成物** | SWE-bench / SWE-bench Verified、Terminal-Bench、τ-bench / τ²-bench、GAIA、AgentBench、WebArena / VisualWebArena、OSWorld、Mind2Web、TheAgentCompany | arXiv 2606.10106 T1–T4；OTel GenAI semconv；survey §8 五阶段；§9.5 审计最低要求；Anthropic eval 方法论 |
| **配套工具** | Inspect AI（MIT）、promptfoo（MIT）、DeepEval（Apache-2.0）、OpenAI Evals；纯基准：SWE-bench（MIT）、τ²-bench（MIT）、AgentBench（Apache-2.0） | ⚠️ **没有工具**——只有规范与论文（详见空白 9） |
| **一手来源示例** | <https://www.swebench.com/>、<https://www.tbench.ai/>、<https://github.com/sierra-research/tau2-bench> | <https://arxiv.org/abs/2606.10106>、<https://opentelemetry.io/docs/specs/semconv/gen-ai/>、<https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents> |
| **能不能回答"我们 harness 好不好"** | ❌ **不能**（分数是模型+harness 联合属性，见下） | ✅ 能（但只能分层、分维度地回答，没有总分） |
| **会不会饱和** | ✅ **会**——Anthropic 明确说 SWE-bench Verified 一年内从 40% 涨到 >80%，"nearing saturation"；**饱和后只剩回归信号，无法反映工程质量** | 不会（规范随版本演进） |

### 为什么能力基准不能回答我们的问题 —— 一手论证

**论证 1（survey §8 核心主张，读到的）**：
> 「执行环境感知的评估应将报告分数视为**模型-执行环境对的属性**，而非模型单独的属性。这意味着评估协议应要么在不同模型间锁定执行环境，要么将执行环境配置作为显式实验因子来变化（Bölük, 2026b）。」

**论证 2（survey §11.3，读到的）**：
> 「耦合问题也解释了为何智能体分数**不能干净地归因于模型而不指定周围控制器**：上下文策略、工具模式、验证器或恢复循环的变更改变了**控制器**，从而改变了同一模型的**测量行为**。」

**论证 3（arXiv 2606.10106 §5，读到的）**：**eval harness 本身连 T1 都不满足**——它跑任务的循环是**外层循环**（遍历任务、收分），而 T1 要的是**单个任务内部**的推理-行动-观察循环。
> 「The eval harness does not close that inner loop: it outsources it to the system under test, observes the outcome, and assigns a grade. ... **One judges the race, the other is the vehicle that runs it.**」
→ 换句话说：**跑分榜是赛道和裁判，我们造的是车。裁判的成绩单不能告诉你车的工程设计好不好**（虽然车的好坏会影响成绩）。

**论证 4（Anthropic，读到的）**：
> 「When we evaluate "an agent," we're evaluating the harness **and** the model working together.」
→ 分数无法拆分给 harness。

### 那"工程质量标准"能回答到什么程度 —— 诚实的边界

**能**：
- **A（充要条件）**：判定"是不是 harness"+"四条核心机制是否实质成立"（三条可验证判据）
- **B（可观测性规范）**：判定"遥测字段是否齐全、命名是否合规"
- **C（方法论）**：判定"我们那套 eval 本身站不站得住"（grader 选型、隔离、pass^k、transcript review）
- **审计（survey §9.5）**：判定"审计记录是否可重放"（7 项最低要求）

**不能**（对应第 3 节的空白）：
- ❌ 给一个总分或等级
- ❌ 跨六层合成一个成熟度
- ❌ 自动化检查 T1–T4
- ❌ 标准化审计 schema（不存在）
- ❌ 跨层交接契约（不存在）
- ❌ 成本归因到层（不存在）
- ❌ **任何工具**能"输入 harness 代码库 → 输出工程质量评分"（空白 9）
- ❌ eval 可信度的公认阈值 / skill 有效性的合格线（空白 10、11）

### 对我们这个项目的具体建议（**推断的**）

**推荐用 A + B + C + F 四条腿站住，用 E 校准，明确不用 D**。**⭐ 最贴合我们 AGENTS.md 新判据（「别人能跑通 + 知道它什么时候会失败」）的是 F 类**——它不测"多强"，它列"会在哪里失败"。

1. **用 A 判架构完备性**：把 T1–T4 + 三条判据做成一张自检表，逐条对着 `lib/agent/index.ts` / `lib/tools/` / 压缩 / 权限模块打勾。**这是唯一针对"harness 本身"的标准。**
2. **用 B 判遥测合规性**：把 OTel `gen_ai.*` 的字段名当命名约定抄下来，给 `.traces/*.jsonl` 加一条 schema 断言测试。**这是唯一可机检的标准。**
   - 具体可抄：`gen_ai.operation.name` 的 18 个枚举值；`gen_ai.invoke_agent.internal`（我们属于这个）；`gen_ai.execute_tool.internal` + `gen_ai.tool.{name,type,call.id,call.arguments,call.result}`；`gen_ai.usage.{input,output}_tokens`；`gen_ai.conversation.id` / `gen_ai.conversation.compacted`（**后者正好对应我们的压缩！**）
   - ⚠️ 别抄已废弃字段（`gen_ai.system` / `gen_ai.usage.prompt_tokens` / 那些 `gen_ai.*.message` 事件）
3. **用 C 建自己的尺子**：按 Anthropic 9 步 + survey §8.5 的四层套件，建我们自己的 eval；用 pass@k / pass^k 报数；**必须读 transcript**。这是**造尺子**，不是**用尺子**。
4. **⭐ 用 F 做"知道它什么时候会失败"的检查表**（**最贴合当前判据的一条**）：把 OWASP `LLM03 Excessive Agency` 的 9 条 + `LLM01 Prompt Injection` 的 #4/#7/#8/#9/#10 + MCP 的 `iteration limits for tool loops` + ASI06/ASI09 **做成一张按 ETCLOVG 分层归位的自检表**（映射见候选 5b）。**它给你的是"失败模式清单"，不是分数**——正是"作品"判据要的东西。
5. **用 E 校准自己的尺子**：如果我们要用 LLM-as-judge，**先按 `aehf` 的方法算 Cohen's kappa**——它的 headline 证明了"97% 裸一致率可以完全无意义"。若我们有 skill（如 `frontend-design`），用 `skillgrade` 的 `Grade outcomes, not steps` + `expected` 隔离两条约定。
6. **不用 D 评价工程质量**：能力基准（SWE-bench 等）留作"换个 harness 分数会不会变"的对照实验，**不作为"我们 harness 好不好"的答案**；且它们**会饱和**（SWE-bench Verified >80%），饱和后无法反映工程质量。
   - ⚠️ **也不要引 2025 版 OWASP 编号**（Excessive Agency 已从 LLM06 变 **LLM03**）。
7. **补一条我们自己特有的**：抄 survey §2.7 的编码协议思路——**自评要坦白方法论的弱点**（它自己承认"单一主编码员 + 作者审计，不报告 Cohen's kappa"，并用"保守规则 + 暂缓分配"兜底）。我们做自评时也应同样坦白：谁评的、评了什么、哪些拿不准。
8. **若要继续挖，优先读这四份**（都在 §6.3）：`Harness-Bench`（arXiv 2605.27922，**名字直指 harness**）、Anthropic《Quantifying Infrastructure Noise in Agentic Coding Evals》（survey "Anthropic, 2026a" 的一手来源）、`awesome-harness-engineering` 的 `templates/HARNESS_CHECKLIST.md`、NIST AI 600-1 的 400+ 条建议动作（需人工读 PDF）。

### ⭐ 一条值得单独记住的架构印证

本次调研**唯一一条被两份完全独立的一手来源背书**的架构原则：

| 来源 | 原话 |
|---|---|
| arXiv 2606.10106 §4（T4 判据） | 「a mechanism satisfies T4 if its **effectiveness does not depend on the model choosing to cooperate**」 |
| OWASP `LLM01:2026 Prompt Injection` | 「**Defense is therefore architectural rather than interceptive.**」 |

→ **「控制必须独立于模型」不是我们自己的设计偏好，是两套独立标准的共同结论。** 这也是我们可以写进 `doc/` 作为**架构决策依据**的东西（而不是"我觉得这样更好"）。

---

## 6. 来源清单

### 6.1 一手来源

**论文 / 官方规范**

| # | 来源 | URL | 类型 | 备注 |
|---|---|---|---|---|
| 1 | arXiv 2606.10106v1《What makes a harness a harness: necessary and sufficient conditions for an agent harness》（S. O. de Macedo, 2026-06-08, CC BY 4.0） | <https://arxiv.org/abs/2606.10106> · 全文 <https://arxiv.org/html/2606.10106v1> | **一手（论文原文）** | T1–T4、三条判据、anatomy、边界表、guardrail 区分均出自此。⚠️ §7 Design Axes **未读到**（HTML 截断、PDF 无法解析） |
| 2 | OpenTelemetry GenAI semantic conventions（**已迁移至独立仓库**） | <https://github.com/open-telemetry/semantic-conventions-genai> | **一手（官方 spec 源码）** | 整体 **Development** 状态 |
| 3 | ├ GenAI 总览 README | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/README.md> | 一手 | 信号清单：events / exceptions / metrics / model spans / agent spans |
| 4 | ├ Agent spans 规范 | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-agent-spans.md> | 一手 | create_agent / invoke_agent(client+internal) / invoke_workflow / plan / execute_tool |
| 5 | ├ Model spans 规范（含 execute_tool、memory） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-spans.md> | 一手 | inference / embeddings / retrievals / fetch response / memory / execute_tool；内容捕获 opt-in |
| 6 | ├ 属性注册表（全部 `gen_ai.*` + `gen_ai.evaluation.*`） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/registry/attributes/gen-ai.md> | 一手 | agent / tool / usage / evaluation 四族属性；Stability 徽章逐条可核 |
| 6b | ├ **事件源文件（权威 YAML）** | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/model/gen-ai/events.yaml> | 一手 | **`gen_ai.evaluation.result` 的出处**；现行仅 2 个 GenAI 事件 + 1 个异常事件 |
| 6c | ├ **指标源文件（权威 YAML）** | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/model/gen-ai/metrics.yaml> | 一手 | 12 个 GenAI 指标；含 `invoke_agent.*` / `execute_tool.duration` |
| 6d | ├ **Span 源文件（权威 YAML）** | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/model/gen-ai/spans.yaml> | 一手 | span type / kind / 语义的权威定义 |
| 6e | ├ 事件文档（人读版） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-events.md> | 一手 | — |
| 6f | ├ 指标文档（人读版） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-metrics.md> | 一手 | — |
| 6g | ├ MCP 约定（OTel 侧） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/mcp.md> | 一手 | MCP 的遥测约定 |
| 6h | ├ **迁仓 PR（证明迁移与 breaking 性质）** | <https://github.com/open-telemetry/semantic-conventions/pull/3696> | 一手 | merged 2026-05-05，label `breaking` |
| 6i | ├ v1.44.0 属性注册表（**全部 `gen_ai.*` = Deprecated**） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions/v1.44.0/docs/registry/attributes/gen-ai.md> | 一手 | 破坏性变更对照的出处 |
| 6j | └ v1.34.0 旧事件形态（历史对照） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions/v1.34.0/docs/gen-ai/gen-ai-events.md> | 一手 | 旧 `gen_ai.user.message` 等事件（**已废弃，勿照抄**） |
| 7 | ├ 官方站点入口（已重定向） | <https://opentelemetry.io/docs/specs/semconv/gen-ai/> | 一手（官方文档） | 页面显示 "Moved" |
| 8 | └ 旧仓库迁移说明（证明迁移事实） | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/gen-ai/gen-ai-spans.md> | 一手 | 内容仅 "Moved" 提示 |
| 9 | Anthropic《Demystifying evals for AI agents》（2026-01-09） | <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents> | **一手（第一方工程文档）** | 术语表、三类 grader、pass@k/pass^k、8 步流程、Swiss Cheese 表、附录框架清单 |
| 10 | Claude Code 官方 glossary —— "Agentic harness" 词条 | <https://code.claude.com/docs/en/glossary> | 一手（官方文档） | 由 #1 脚注 1 引用；「Claude Code is the harness, and Claude is the model inside it」 |
| 11 | Hugging Face agent glossary《Harness, Scaffold, and the AI Agent Terms Worth Getting Right》 | <https://huggingface.co/blog/agent-glossary> | 一手（第一方 glossary） | 由 #1 脚注 2 引用 |
| 12 | Agent Harness Engineering: A Survey 原始项目页 | <https://github.com/1998x-stack/Awesome-Agent-Harness> | 一手（论文项目页） | 本地中文语料 README 指向此。**arXiv 编号未找到** |

**本地参考语料（一手：survey 中文精译正文）**

| # | 来源 | 本地路径 | 读到的内容 |
|---|---|---|---|
| 13 | Survey 摘要 | `E:\agents-read\Agent-Harness-Survey-ZH-main\abstract.txt` | 三大贡献原文 |
| 14 | Survey 目录 | `E:\agents-read\Agent-Harness-Survey-ZH-main\toc.json` | 13 章 + 节号定位 |
| 15 | §8 总章 | `08_Verification_and_Evaluation\08_验证与评估.md` | 五阶段总表、传统 vs 执行环境评估对照表 |
| 16 | §8.2 阶段一 | `08_01_阶段一：任务与基准接地.md` | 三大基准类别 |
| 17 | §8.3 阶段二 | `08_02_阶段二：执行前就绪验证.md` | 三层就绪验证（环境/工具上下文权限/评估器） |
| 18 | §8.4 阶段三 | `08_03_阶段三：受控执行与追踪捕获.md` | rollout 定义、6 个固定变异源、追踪字段清单、成本-延迟前沿 |
| 19 | §8.5 阶段四 | `08_04_阶段四：多层次判断与故障归因.md` | 三层判断、失败→层映射表、评估器偏差、跨层归因 |
| 20 | §8.6 阶段五 | `08_05_阶段五：持续回归与部署反馈.md` | 分层评估套件四层表、评估框架对照、Meta-Harness |
| 21 | §2.6 | `02_Background_and_Taxonomy\02_06_纳入与排除标准.md` | 纳入三条件、排除六类、「按机制判定非按标签」 |
| 22 | §2.7 | `02_Background_and_Taxonomy\02_07_编码协议.md` | 证据来源、主/次层多标签、单一编码员+作者审计、保守规则 |
| 23 | §2.9 | `02_Background_and_Taxonomy\02_09_聚合分析.md` | 覆盖密度表（O/G 低）、跨层项目兴起 |
| 24 | §7.5 | `07_Observability_and_Operations\07_05_讨论：走向统一可观测性.md` | 89% vs 52% 鸿沟、统一可观测性四要素 |
| 25 | §9.5 | `09_Governance_and_Security\09_05_审计基础设施.md` | 可重放审计最低要求 7 项、逐动作 vs 轨迹级、OWASP 资源耗尽、AutoHarness 三层 |
| 26 | §10 | `10_Cross_Cutting_Concerns\10_跨领域关切.md` | 层间依赖、五个持续性缺口 |
| 27 | §11 | `11_Cross_Layer_Synthesis\11_跨层综合.md` | §11.1 三难、§11.2 能力-控制、§11.3 耦合、§11.4 平台、§11.5 议程 |
| 28 | §12 | `12_Open_Problems_and_Future_Directions\12_开放问题与未来方向.md` | §12.1–12.5（含 §12.3 追踪诊断、§12.4 交接契约） |
| 29 | Survey README | `E:\agents-read\Agent-Harness-Survey-ZH-main\README.md` | 作者列表、ETCLOVG 表、关键数据一览 |

**评估框架 / 工具（一手：官方文档 / 官方仓库 / LICENSE）**

| # | 来源 | URL | 许可 | 定位 |
|---|---|---|---|---|
| 40 | **awesome-harness-engineering**（ai-boost） | <https://github.com/ai-boost/awesome-harness-engineering>（raw: <https://raw.githubusercontent.com/ai-boost/awesome-harness-engineering/main/README.md>） | ⚠️ 徽章 CC0 vs API `Other`（冲突） | awesome list；**Foundations 32 条 + Evals & Verification 20 条已逐条抄录**（§2.5-(1)） |
| 41 | **Inspect AI** | <https://inspect.aisi.org.uk/> · <https://github.com/UKGovernmentBEIS/inspect_ai> | ✅ MIT | 模型/agent 能力评估框架 |
| 42 | **promptfoo** | <https://www.promptfoo.dev/docs/getting-started/> · <https://github.com/promptfoo/promptfoo> | ✅ MIT | prompt/模型/RAG/agent 质量+安全 |
| 43 | **DeepEval** | <https://deepeval.com/docs/getting-started> · <https://github.com/confident-ai/deepeval> | ✅ Apache-2.0 | LLM 应用/agent 输出质量与轨迹 |
| 44 | **Langfuse** | <https://langfuse.com/docs/evaluation/overview> · <https://github.com/langfuse/langfuse> | ⚠️ 核心 MIT + `ee/` 独立商业许可（LICENSE 正文已解码核对） | 可观测性平台，**内置完整 eval** |
| 45 | **`aehf`**（salasya2/aehf） | <https://github.com/salasya2/aehf> | ✅ MIT（stars 2） | **评估方法论工具**：先校准 judge（Cohen's kappa），再评通过率 |
| 46 | **`mgechev/skillgrade`** | <https://github.com/mgechev/skillgrade> | ✅ MIT | **skill 有效性**（唯一此类工具） |
| 47 | **OpenAI Evals** | <https://github.com/openai/evals> | ⚠️ 无标准 LICENSE 文件 | 能力基准（入口已导向 Dashboard） |
| 48 | **AgentBench** | <https://github.com/THUDM/AgentBench> · arXiv 2308.03688 | ✅ Apache-2.0 | 能力基准（8 环境） |
| 49 | **τ-bench / τ²/τ³-bench** | <https://github.com/sierra-research/tau-bench> · <https://github.com/sierra-research/tau2-bench> | ✅ MIT | 能力基准（多轮对话，Pass^k） |
| 50 | **SWE-bench** | <https://github.com/SWE-bench/SWE-bench> · <https://www.swebench.com> | ✅ MIT | 能力基准（真实 GitHub issue） |
| 51 | **GAIA** | arXiv 2311.12983 · HF <https://huggingface.co/gaia-benchmark>（**无官方 GitHub**） | ⚠️ 未核实 | 能力基准（真实世界问题） |
| 52 | **Terminal-Bench** | <https://www.tbench.ai/> | — | 能力基准（端到端终端任务） |
| 53 | **WebArena / OSWorld / BrowseComp** | <https://arxiv.org/abs/2307.13854> · <https://os-world.github.io/> · <http://arxiv.org/abs/2504.12516> | — | 能力基准（浏览器/桌面/开放网络） |

**官方治理 / 安全规范（一手：官方页面 / 官方仓库 raw）**

| # | 来源 | URL | 类型 | 备注 |
|---|---|---|---|---|
| 54 | **OWASP GenAI LLM Top 10 2026**（2026-08-04 发布） | <https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/>；源码仓 <https://github.com/GenAI-Security-Project/GenAI-LLM-Top10>（`2026/final/`） | **一手（官方页 + 官方 raw 正文）** | **⚠️ 最新是 2026 版，不是 2025 版**；2025 版已 archived |
| 55 | ├ `LLM03:2026 Excessive Agency` 正文 | <https://raw.githubusercontent.com/GenAI-Security-Project/GenAI-LLM-Top10/main/2026/final/LLM03_ExcessiveAgency.md> | 一手 raw | 9 条缓解；编号从 LLM06(2025) → **LLM03(2026)** |
| 56 | ├ `LLM01:2026 Prompt Injection` 正文 | <https://raw.githubusercontent.com/GenAI-Security-Project/GenAI-LLM-Top10/main/2026/final/LLM01_PromptInjection.md> | 一手 raw | 11 条缓解；核心句「Defense is therefore **architectural rather than interceptive**」 |
| 57 | ├ 2026/final 目录（独立复核存在性） | <https://api.github.com/repos/GenAI-Security-Project/GenAI-LLM-Top10/contents/2026/final> | 一手 API | 已复核 `LLM01_*.md`…`LLM10_*.md` 实际存在 |
| 58 | ├ ASI 映射文件 | <https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/mappings/asi-2026.json> | 一手 raw | LLM Top 10 ↔ Agentic Top 10 的映射 |
| 59 | **OWASP Top 10 for Agentic Applications for 2026**（2025-12-09） | <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/> | **一手（官方发布页）** | `ASI01`–`ASI10`；十条标题来自官方公告 + 官方映射 JSON，**非 PDF 正文** |
| 60 | OWASP Agentic AI – Threats and Mitigations v1.0 | <https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/> | 一手 | — |
| 61 | OWASP Agentic Skills Top 10 (AST10) v1.0 | <https://owasp.org/www-project-agentic-skills-top-10> | 一手 | `AST01` Malicious Skills … `AST10` Cross-Platform Reuse |
| 62 | OWASP LLM06:2025 Excessive Agency（历史对照） | <https://genai.owasp.org/llmrisk/llm062025-excessive-agency/> | 一手 | 编号变更的证据 |
| 63 | **MCP spec 2026-07-28（当前版本）** | <https://modelcontextprotocol.io/specification/2026-07-28> | **一手（官方 spec）** | ⚠️ **2025-06-18 已过时** |
| 64 | ├ MCP `server/tools` | <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>（追加 `.md` 取纯文本） | 一手 | iteration limits / human in the loop / 工具注解不可信 |
| 65 | ├ MCP 版本策略 | <https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning> | 一手 | 三档 Draft/Current/Final；`YYYY-MM-DD` 语义 |
| 66 | ├ MCP Security Best Practices | `https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices` | 一手 | Token Passthrough / State Handle Hijacking / SSRF 等 |
| 67 | └ MCP 官方仓库（spec+schema+docs） | <https://github.com/modelcontextprotocol/modelcontextprotocol> | 一手（源码） | `docs/specification/2026-07-28/*.mdx`；`schema/2026-07-28/` |
| 68 | OTel 侧 MCP 遥测约定 | <https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/mcp.md> | 一手 | 已定位，未逐节抄 |
| 69 | **NIST AI 100-1（AI RMF 1.0）** | <https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf> · DOI <https://doi.org/10.6028/NIST.AI.100-1> · <https://www.nist.gov/itl/ai-risk-management-framework> | 一手 | 2023-01-26；**正在修订**；GOVERN/MAP/MEASURE/MANAGE |
| 70 | **NIST AI 600-1（GenAI Profile）** | <https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf> · DOI <https://doi.org/10.6028/NIST.AI.600-1> | 一手 | **final**（2024-07-26）；12 条 GAI 风险；⚠️ **400+ 动作原文未能抓取（PDF）** |
| 71 | **NIST AI 800-5**（agent 安全 RFI 汇总） | <https://www.nist.gov/publications/summary-analysis-responses-request-information-regarding-security-considerations-ai> | 一手 | 2026-05-18 |
| 72 | **CISA + 五眼《Careful Adoption of Agentic AI Services》** | <https://www.cisa.gov/resources-tools/resources/careful-adoption-agentic-ai-services> · 新闻稿 <https://www.cisa.gov/news-events/news/cisa-us-and-international-partners-release-guide-secure-adoption-agentic-ai> | **一手（官方页）** | 2026-05-01；四风险：expanded attack surface / privilege creep / behavioral misalignment / **obscure event records**。⚠️ 指南本体 403 |
| 73 | **EU AI Act**（Reg. (EU) 2024/1689）法规框架页 | <https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai> · EUR-Lex <https://eur-lex.europa.eu/eli/reg/2024/1689/oj> | 一手（官方页） | GPAI 义务 2025-08-02 生效；⚠️ EUR-Lex 202 空响应 |
| 74 | **IETF `draft-klrc-aiagent-auth`**（AI Agent Authn/Authz，wimse WG 已采纳） | <https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/> | **一手（IETF draft）** | ⭐ 核心：「UI 确认**不构成授权**，MUST 绑定授权服务器签发的可验证 grant」 |
| 75 | IETF `aipref` WG | <https://datatracker.ietf.org/wg/aipref/about/> | 一手 | Active；`draft-ietf-aipref-vocab-08` / `-attach-05` |
| 76 | IETF `agentproto` charter（**仅拟成立**） | <https://datatracker.ietf.org/doc/charter-ietf-agentproto/> | 一手 | WG State: Proposed |
| 77 | IETF `dawn` charter（**仅拟成立**） | <https://datatracker.ietf.org/doc/charter-ietf-dawn/> | 一手 | WG State: Proposed，"Has 2 BLOCKs" |
| 78 | IETF datatracker 检索（**证明不存在 agent RFC**） | <https://datatracker.ietf.org/doc/search/?name=agentic&rfcs=on> | 一手（检索零命中） | "No documents match your query." |
| 79 | NIST AIRC crosswalks（ISO 编号存在的旁证） | <https://airc.nist.gov/airmf-resources/crosswalks/> | 一手 | ⚠️ 未标年份 |
| 80 | ISTQB Glossary（"test harness" 经典定义） | <https://glossary.istqb.org> | 一手（arXiv 论文脚注给出） | 未逐条核对 |

**本地参考项目源码（一手：实际源码与配置文件）**

| # | 项目 | 关键路径 | 读到的内容 |
|---|---|---|---|
| 30 | `DeepSeek-Reasonix-main-v2` | `benchmarks/`（README 549 行）、`benchmarks/e2e/tasks/`、`benchmarks/swebench/{select_subset.py,subset.json}`、`cmd/e2ebench/main.go`、`tools/repolint/{layers.go,baseline.go,baseline.json}`、`.github/workflows/{ci.yml,e2e-bot.yml}` | 6 套 harness、73 任务+verify.sh、Completion Integrity、Anchor Resistance、repolint 11 规则、baseline 棘轮 |
| 31 | `pi` | `packages/evals/{README.md,scripts/run-evals.mjs,src/*.eval.ts,src/pi-harness.ts,src/vitest-evals/*}`、`scripts/check-entry-graphs.mjs`、`package.json`、`.github/workflows/{ci.yml,pr-gate.yml}`、`.husky/pre-commit` | eval 用例与报表、"Entry points are cost contracts"、check 长链门禁、eval 不进 CI |
| 32 | `CodeWhale-main` | `crates/tui/src/eval.rs`、`crates/tui/tests/{integration/eval_harness.rs,cucumber/eval_smoke_acceptance.rs,features/eval_smoke.feature}`、`scripts/check-*-budget.py`、`.github/workflows/ci.yml` | 离线 eval harness、EvalMetrics、9 个预算/边界脚本 |
| 33 | `deepseek-harness` | `benchmarks/AGENTS.md`、`scripts/verify-client-domain-graph.ts`、`scripts/verify-module-graph.ts`、`.github/workflows/ci.yml`、`lefthook.yml`、`.jscpd.json` | benchmark 规范、"生成-校验对"、0/1/2 三层目录门禁、12 job CI |
| 34 | `codex` | `.github/workflows/{blocking-ci.yml,repo-checks.yml}`、`.github/workflows/repo-checks.yml` 内 `verify_tui_core_boundary.py`、`bazel/rules/e2e_benchmark.bzl` | crate 级分层边界、单一 required 入口、Divan 微基准 |
| 35 | `opencode` | `.github/workflows/{typecheck.yml,test.yml,pr-standards.yml}`、`.oxlintrc.json`、`CONTEXT.md`、`specs/` | PR 流程门禁、typeAware oxlint、领域词汇表（无脚本配套） |
| 36 | `langchainjs` | `libs/langchain-classic/src/evaluation/{criteria/criteria.ts,comparison/pairwise.ts,embedding_distance/base.ts,agents/trajectory.ts}`、`.github/workflows/benchmark-tests.yml` | 14 条 SUPPORTED_CRITERIA、LLM-as-judge 实现、correctness 守卫、benchmark 触发被注释 |
| 37 | `smolagents-main` | `examples/smolagents_benchmark/{run.py,score.ipynb}`、`.github/workflows/{quality.yml,tests.yml}`、`.pre-commit-config.yaml` | benchmark 在 examples、CI 不碰、ruff+pytest |
| 38 | `hello-agents` | `code/chapter12/08_data_generation_llm_judge.py`、`code/chapter12/0{3,4}_*bfcl*.py`、`code/chapter11/07_model_evaluation.py` | 教学用 BFCL + 手写 LLM-judge；零 CI |
| 39 | `.reasonix` | `desktop-topic-*.json`（4 个） | 非项目，仅会话状态 |

### 6.2 二手来源（**仅用于找线索，未作为任何结论的依据**）

| # | 来源 | URL | 用途 |
|---|---|---|---|
| S1 | CSDN 博客《10 个 Design Axes，分 3 组》 | <https://blog.csdn.net/CLnFHY9fQ/article/details/162696093> | 搜 arXiv 2606.10106 §7 时命中；**它讲的 10 个 axes 与论文 §7 无法确认同源**（它引用了另外的 _Inside the Scaffold_ 论文和 Anup Jadhav / Addy Osmani 的文章），**故未采信为 2606.10106 的内容** |
| S2 | Lattice 论文页 | <https://www.layerthelatestinalattice.com/papers/arxiv:2606.10106> | 尝试取 2606.10106 全文；实际只返回页面框架，**无正文** |
| S3 | arxiv-org.ezproxy.obspm.fr 镜像 | <https://arxiv-org.ezproxy.obspm.fr/html/2606.10106v1> | 尝试绕过截断；**被重定向到登录页，失败** |
| S4 | 各搜索引擎结果页 | — | 用于定位一手 URL（如 semconv 迁移后仓库、Anthropic 博客地址） |

### 6.3 ⚠️ 声明：本次未能核实的一手来源

以下条目**在本次调研中未取到一手内容**，因此**没有写任何结论**。若后续需要，应单独取：

| 待核实 | 状态 |
|---|---|
| arXiv 2606.10106 §7「Design Axes and Research Agenda (RQ5)」的 10 条 tension axes | **未读到**（HTML 截断于 §6 末尾；PDF 返回 `unsupported content type "application/pdf"`；镜像失败） |
| *Agent Harness Engineering: A Survey* 的 **arXiv 编号** | **未找到**（本地语料 README 只给 GitHub 项目页） |
| ⭐ **`Harness-Bench`（arXiv 2605.27922）** | **未展开**——但它是 AHR "Evals & Verification" 段里**名字直指 harness** 的一条，**最该优先补读** |
| ⭐ Anthropic《**Quantifying Infrastructure Noise in Agentic Coding Evals**》 | **未展开**——但它是 survey 反复引用的「基础设施噪声可显著偏移基准分数」的**一手实证来源**（survey 记为 "Anthropic, 2026a"） |
| `templates/HARNESS_CHECKLIST.md`（awesome-harness-engineering 的 Templates 段） | **未展开**——名字本身值得一看 |
| **Harbor**（Anthropic 附录点名） | **未核实**许可与仓库 |
| **NIST AI 600-1 的 400+ 条建议动作原文** | **未核实**——`web_fetch` 不支持 PDF，只拿到 12 条风险与动作编号体系；**已明确不逐字引用、不转述成原文** |
| **NIST AI 600-1「12 条 vs 13 条风险」的口径差异** | **未找到解释**（AIRC 文案说 13，PDF 第 2 节实际 12），也未找到 errata |
| **ISO/IEC 42001 / 23894 版本年份** | **未能一手核实**（iso.org 全站 403 Cloudflare，IEC Webstore 404） |
| **Cloud Security Alliance 相关文档** | **未能一手核实**（全站 403），**不给内容结论** |
| **CISA《Careful Adoption of Agentic AI Services》正文** | **未读到**（指南本体在 ACSC 域，403）；仅核实了标题、日期与风险原文（来自 CISA 官方页） |
| **EU AI Act 法条原文** | **未读到**（EUR-Lex 202 空响应）；日期取自欧委会官方页 |
| **A2A 官方 spec** | **未取**（survey §12.4 仅称其为"现有局部标准之一"） |
| `aehf` 缩写**来源**（不是项目本身） | **未确证**——`salasya2/aehf` 是 GitHub 上唯一语义匹配，但无法证明这就是你指的 `aehf` |
| **GAIA** 数据集许可 | **未核实**（本网络连不上 huggingface.co；无官方 GitHub 仓库） |
| **awesome-harness-engineering** 的 LICENSE 正文 | **未逐字核对**（README 徽章标 CC0 vs GitHub API `Other`/`NOASSERTION`，两者冲突） |
| **OpenAI Evals** 的许可 | **未核实**（根目录 `/LICENSE` 与 `/LICENSE.md` 均 404） |
| promptfoo 断言类型的**完整**枚举 | **非完整枚举**（只核了示例类型） |
| DeepEval「20+ 指标」 | 来自 AHR 清单，**未在官方文档逐条核对** |
| OTel `gen-ai-spans.md` 的"内容捕获"整节 | ⚠️ 文件 120KB 超单次抓取上限，该节由同仓库同文件 **revision `3cfb9e6e`（2026-07-28）** 补齐（TOC/标题一致，后续 commit 未改该节）——**已披露** |

> **⚠️ 关于「未找到」的两分法（重要）**：上面每一项都区分了两种不同情况——
> ① **确实不存在**（如 IETF 层面没有任何 agent/工具调用的正式 RFC——这是检索零命中的确定性结论）
> ② **抓取通道不可用**（如 NIST 动作原文、ISO 版本年份——是 403/PDF 限制，不是"不存在"）
> **不要把②当成①。**

### 6.4 ⚠️ 环境告警（供后续会话参考）

- 后台调研过程中观察到：`doc/研究/` 下的**中间产物被外部进程删除过一次**（node `readdirSync` 与 glob 双向确认）。同目录的 `_tmp-*.md` 交付文件当前**存在且已校验**。若收尾动作里有"清理未跟踪/`_tmp-*` 文件"的步骤，请注意已经误删过一次中间文件。
- **本沙箱禁止 pwsh / curl 出网**（schannel 凭证被拒）；出网只能靠 `web_fetch` 或 node `fetch`。这解释了为什么 `Invoke-WebRequest` 取 OTel spec 会超时失败。
- **`doc/研究/` 下的 `_tmp-*.md` 是三个后台调研分支的原始交付物**（`_tmp-otel-and-specs.md` / `_tmp-eval-tools.md` / `_tmp-local-repos.md`），本文件是它们的汇总。另有 6 个 `_tmp-*.mjs` 是调研用的临时脚本，**可以删除**。

---

## 附：一句话速查表

| 想回答的问题 | 用什么 | 出处 |
|---|---|---|
| 我们这东西算不算 agent harness？ | T1–T4 判定 | arXiv 2606.10106 §4 |
| 我们的压缩/权限是"真做了"还是"形式做了"？ | 三条可验证判据 | 同上 |
| 我们的 harness 机制有多成熟？ | anatomy qualifiers 逐项对照 | 同上（⚠️ 无量化刻度） |
| 我们的 trace 该记哪些字段？ | 7 项追踪字段 + OTel `gen_ai.*` 属性 | survey §8.3 + OTel GenAI semconv |
| 我们的审计记录可重放吗？ | 7 项最低要求 + CISA「obscure event records」 | survey §9.5 + CISA 2026-05-01 |
| **我们知道它会怎么失败吗？**（**最贴合当前判据**） | **OWASP LLM03 Excessive Agency 9 条 + LLM01 Prompt Injection + ASI01–ASI10** | **OWASP 2026 版（⚠️ 不是 2025 版）** |
| 我们的工具循环/权限设计有外部依据吗？ | MCP「iteration limits for tool loops」；OWASP「Complete mediation」 | MCP spec 2026-07-28 + OWASP LLM03:2026 |
| 我们的 eval 造得对不对？ | 三类 grader + pass@k/pass^k + 9 步 | Anthropic《Demystifying evals…》 |
| **我们的 eval 结果可信吗？** | **Cohen's kappa 校准 + Wilson CI + McNemar** | **`salasya2/aehf`** |
| **我们的 skill 到底有没有被 agent 用上？** | **skillgrade** | **`mgechev/skillgrade`** |
| 我们的测试该分几层？ | 单元/单步/完整 rollout/多轮模拟 | survey §8.5 |
| 我们的 agent 会不会撒谎？ | 无解任务 + 反向打分 | Reasonix `benchmarks/e2e/` |
| 我们的代码库分层有没有破？ | 分层清单 + baseline 棘轮 | Reasonix `tools/repolint`；pi `check-entry-graphs.mjs`；harness `verify-client-domain-graph.ts` |
| 我们的 trace span 树该怎么长？ | ⚠️ **规范里没有答案**（OTel 不管 span 树形状） | 见空白 5b |
| 我们的 agent 能力有多强？ | **⚠️ 这只能测"模型+harness 联合"，回答不了"harness 好不好"** | survey §8 核心主张 + §11.3 |

---

## 附：本次调研覆盖了什么、没覆盖什么（诚实边界）

**覆盖了**：
- 本地 survey 的 §2.6/2.7/2.9、§7.5、§8 全章（五阶段）、§9.5、§10、§11、§12（逐文件精读）
- arXiv 2606.10106 的 §1–§6（充要条件、三条判据、anatomy、边界表、guardrail 区分）
- OTel GenAI semconv 的完整 span 清单（11 个 span）+ 属性注册表 + **事件**（含 `gen_ai.evaluation.result`）+ **指标**（12 个）+ 破坏性变更对照；稳定性逐条核对
- Anthropic《Demystifying evals》全文（含 Step 0–8）
- 本地 10 个参考项目的 eval/门禁/架构自检（实际扫源码）
- 8 个评估框架/工具 + 8 个能力基准的一手核实
- **OWASP 2026 两份清单 + NIST 三份 + MCP spec 2026-07-28 + IETF 检索 + CISA + EU AI Act 日期**

**没覆盖（都在 §6.3 列了）**：
- arXiv 2606.10106 的 §7 Design Axes
- survey 的 arXiv 编号
- **`Harness-Bench`（arXiv 2605.27922）** —— AHR 里名字直指 harness 的一条，**最该优先补读**
- **Anthropic《Quantifying Infrastructure Noise》** —— survey "Anthropic, 2026a" 的一手来源
- Harbor、`templates/HARNESS_CHECKLIST.md`
- NIST AI 600-1 的 400+ 条建议动作原文（PDF 通道不可用）
- ISO/IEC 42001/23894、CSA（403）
- A2A 官方 spec

**本次调研最核心的一条判断（再次强调）**：
> **没有任何一个现成物是"给单个自研 harness 的工程质量打分"的。** 现成尺子分六类（A 架构充要条件 / B 可观测性规范 / C 评估方法论 / D 能力基准 / E 元评估与专项评估 / F 安全治理规范），**A+B+C+F 适用、D 不适用**；而 A/B/C/E/F 各自都只覆盖一部分，且**没有一把能给出总分**。第 3 节列的空白就是这个事实的具体清单。

**⭐ 但如果只能记一条结论，记这条**：
> **两个完全独立的一手来源（arXiv 2606.10106 的 T4 判据 + OWASP LLM01:2026）说同一件事：「控制机制必须独立于模型的服从」「防御必须是架构性的，不是拦截性的」。** 这是我们这次调研拿到的**唯一一条被双重背书的架构原则**——也是"评价一个 harness 好不好"目前能给出的、最硬的一条判据。
