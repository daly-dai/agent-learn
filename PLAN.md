# Agent Harness 项目：整体评估与长期方案（骨架版）

> 本文件是"做中学"的长期路线图**骨架**：只放核心规则与计划列表，
> 各阶段/功能的详细施工方案在 `doc/plan/*.md`（开工对应项时才读）。
> 渐进式加载分层：
> | 层 | 文件 | 什么时候读 |
> |---|---|---|
> | **入口** | `PLAN.md` 顶部的**需求池**说明 | **新会话第一件事**：看池子 → 找标了「去向 = `→ I<n>`」的行 → 打开 `doc/iteration/i<n>.md` |
> | **需求池（本文件）** | `PLAN.md` | 加一行 / 挑迭代成员 / 看全局规则 |
> | 迭代 | `doc/iteration/i<n>.md` | 这一批做什么 · 三格门禁 · 顺序 · 出口 |
> | 详案 | `doc/plan/*.md` | **开工某一项时**才读对应文件 |
> | 架构与决策 | `ARCHITECTURE.md` | 加新东西前：长哪个接缝 · **已确认的决策（别再翻案）** |
> | 归档 | `doc/plan-archive/*.md` | 考古：查已完成阶段的历史决策 |
>
> 项目定位：**做中学的 Agent Harness 项目** —— **不是生产系统**（不需要多租户 / SLA / 合规），**但是作品**（判据见 §一），站在多个成熟开源项目肩上——参考系是 **pi / DSH / codex / smolagents / CodeWhale / Reasonix** 等 + 理论框架（《Agent Harness Engineering: A Survey》的 ETCLOVG 七层）。完整参考坐标系与"每个阶段抄谁"见 `ARCHITECTURE.md` 的第 0 · 1 节；参考项目清单见 `doc/开源项目导航手册/index.md`。
>
> 目标不是复制某一个项目，而是用 **Next.js + TypeScript** 写出一个保留各家核心思想、可一步步长成的 Agent。

---

## 一、当前前提与目的变更（**变了就改这里**）

> 这一章是**全文的前提** —— 下面所有判断都从它推。**前提变了先改这里，再改别处。**

### ⚠️ 目的变更（2026-09-14）

**原来**：目的是**学习** → 项目是**玩具**（功能存在即可 —— "按需"、"非核心"、"顺手件"、"刻意不开工" 都是这个前提下的合理判断）。
**现在**：目标是**作品** → 要求随之改变。

**判据**：**玩具** = 「我能跑通」；**作品** = 「**别人能跑通** + **知道它什么时候会失败**」。
**推论**：① 能力面不能有洞（阶段 C 从"按需" → **必须**）② 每个核心能力要有一条别人能复现的验证路径 ③ 包装是交付物的一部分。

**因此 PLAN 里一切「按需 / 非核心 / 顺手件 / 刻意不开工 / 推迟到…」的判词，全部作废**，按 §7.3 排期表重排。

### 当前前提

- **目的**：学习 / 玩具 → **作品**（2026-09-14 变更）
- **判据**：别人能跑通 + 知道它什么时候会失败
- **优先级轴**：功能面 > 质量与可信 > 包装与形态
- **章节改版（2026-09-14）**：原 §二「功能 → 模块 → 阶段 映射」已删（内容被 §7.3 完全覆盖）；原 §三「分阶段路线图」已并入 §7.3 —— Phase 0–5 进了排期表开头的「地基」块，Phase 6 的 4 条子项 → **B3** / **B8** / **A3 ✅** / monorepo 抽包（§7.3.5）。**两处内容现在都只有一份，在 §7.3**；章节编号随之重排为**连续**（**四/五/六/七 不动** —— 它们被外部引用，`§7.x` 更是全库高频）
- **已否掉的方案**（连理由记下来，免得下个会话重提）：
  - **模块地图重构**（按模块 × 前置/核心/优化 重排）—— 改动太大；收益用"功能 / 优化"两桶就拿到了
  - **迭代工作流**（功能迭代 ⇄ 技改迭代 + 收口清单）—— 是包装，且**不可查**
  - **V 层 benchmark 体系** —— 形态过重；改用小形态："每个核心能力有一条别人能跑的验证路径"
  - **删掉 A/B/C 编号** —— 文档 ~1200 处 + 48 条 commit message 引用，**不可逆**；改为"字母无含义"
- **落地判据**（提新机制前先回答）：**它的"检查方式"是什么？** 答不出 → 必然变形，别写进规则

---

## 二、历史归档（早期评估 / 答疑 / 施工单 —— **考古用**）

> 目录 `doc/plan-archive/`，**已决定的事都在结论里，别重新讨论**：
> `01-当前状态评估.md`（起步评估）· `02-四个直接问题回答.md`（**不换架构 / 不用 SDK / 手写 SSE** —— 结论全部兑现）· `07-phase0-实现要点.md`（DeepSeek 适配器施工单）
> 另：`.a5-notes-dsh.md`（A5 当时的 DSH 笔记，点文件）—— **保留**（2026-09-14 定）。

---

## 三、目标架构（高维度）——核心规则

对齐 pi 的三层架构（DSH / smolagents / CodeWhale / Reasonix 同构，只是切分粒度不同）——**完整分层见 `ARCHITECTURE.md` 第 2 节**：

> **三层架构图与完整分层见 `ARCHITECTURE.md` 第 0 节。**
> 本文件**不再重复画图** —— 一条信息只在一处（原图 2026-09-14 移出）。

- **模型适配层**：provider 差异关在这里。DeepSeek 的 OpenAI 兼容字段只在 `lib/deepseekModel/index.ts` 里出现，`runAgentLoop` 永远只看 `AssistantMessage`。
- **Agent 内核层**：越稳定越小越好。**agent-loop 是红线**：改引擎必须先精读 pi → 对比 → 展示 → 用户判断（AGENTS.md）。
- **产品运行层**：会话、终端、task、面板这些"麻烦但关键"的事都长在这里，是可替换、可迭代的部分。

抓住这些边界（pi 的核心教训）：
1. **LLM 边界**：进模型前把 `AgentMessage` 转成 provider 格式，出模型后把 provider 事件转回 `AssistantMessage`。
2. **副作用边界**：模型不能直接读写文件/执行命令，只能提 tool call；副作用发生在工具里，可被审批和权限拦截。
3. **可观测性边界**：引擎只负责产出事件，不负责展示和存储；展示（Event Timeline）和落盘（轨迹 Trace）由外部消费者完成。详案见 `doc/plan/observability.md`。

---

## 四、参考项目源码阅读地图

**参考项目清单**（`E:\agents-read` 下）：**唯一列表在 `doc/开源项目导航手册/index.md`**（每个项目一个文件：架构/功能→位置/搜索配方，按需打开）——新增/删除项目只改那里，PLAN 不各自维护，避免两套列表不同步。

---

## 五、原则（核心规则）

> **原 §五 的「暂缓 / 不要做」表已于 2026-09-14 清空** —— 目的从「学习 / 玩具」改为「作品」后逐条重审，**5 条全部有去向**（§五 不再另起一张与 §7.3 平行的表）：

| 原条 | 去向 |
| --- | --- |
| 同时接多家模型 | ✅ **翻为「要做」** → `C25 多模型支持`（§7.3.2） |
| 完整权限审批系统 | ✅ **已完成**（B1 审批四步，2026-08-26） |
| 漂亮动画 / 复杂 UI | **就是 `B3`**（UI V2 尺度升级 + 原语库）—— 不是「不做」 |
| 交互式 TTY 终端 | ✅ **翻为「低优先级要做」** → `C26 交互式 TTY 终端`（§7.3.2） |
| 一步到位做多 agent | **就是 `C3`**（子智能体，现为「大功能 · 必选」）—— 不是「不做」 |

> **判据（以后往这里加「不做」之前先过一遍）**：不做的理由是「**学习项目没必要**」→ **重审**；理由是「**工程上不划算**」→ 保留（→ 记进 **§7.3.5 条件触发**）。
> （原表摘自教学路线 `build-00-roadmap.md` 的「暂缓事项」+ pi 的教训）

**核心心法**：模型会变、工具会变、UI 会变，但 Agent Loop 相对稳定。让"稳定的内核"和"不稳定的外部"分离，你后面每一步都是在往对的位置加东西，而不是推倒重来。

---

## 六、横切文档（不属于任何单项，但开工会读到）

> **单项的详案在 §7.3 的「详细设计」列** —— 本节只放跨多项、或不属于任何单项的文档。
> （原 §六 是第二份详案索引，2026-09-14 收窄 —— 见「当前前提」）

| 文档 | 讲什么 |
| --- | --- |
| `doc/plan/far-map.md` | 远期功能地图（Top5 + 五规律）—— 很后期 |
| `doc/plan/agent-loop-purity.md`（+ `doc/01-*.md`） | agent-loop 纯净性改造（历史） |
| `doc/开源项目导航手册/index.md` | 参考项目导航卡 —— **参考项目唯一列表** |

---

## 七、综合长远规划（综述分类法 × 6 个项目）

> 来源：《Agent Harness Engineering: A Survey》（110+ 论文 / 23 系统的 harness 分类法，本地中文版 `E:\agents-read\Agent-Harness-Survey-ZH-main\`）+ 本地 6 个参考项目（pi / DSH / smolagents / CodeWhale / Reasonix）。详细版见 `workspace/综合长远规划.md`。
> 原则：**架构好的学架构，功能丰富的学功能**。每项标注"参考谁、详细设计在哪、怎么验收"——落地意义 = 每步都知道做什么、为什么、跟谁学。
> 定位：我们的项目 = mini-harness（综述分类法的实践投影）。**计划只有两桶：功能待办（必选）· 工程优化（可选）** —— 见 §7.3。
> 学术背书（binding-constraint thesis，综述第 1 章）：实证显示——只改进 harness（不碰模型）就能让基准提升 **10 倍**（改编辑工具格式）、+13.7 个百分点（Terminal-Bench 2.0 纯 harness 优化）。结论：**执行环境（harness）比模型本身更能决定现实世界的可靠性**（OpenAI 2026-02 已把 harness engineering 确立为独立学科）。我们做的正是 harness——方向有学术背书。

### 7.1 综述对照表（官方 ETCLOVG 七层 ↔ 我们 ↔ 差距）

> 分类法出处：综述第 2.3 节。**E/T/C/L 是结构性骨架，O/V/G 是控制平面**——综述把可观测性（O）和治理（G）提为独立层，因为它们"藏在工业系统商业平台里、开源生态最稀疏"，而这恰是我们的主战场（轨迹 + 审批）。

| 层 | 全称（回答的问题） | **差距**（这层缺什么 → 对应项） | 参考 |
|---|---|---|---|
| **E** | Execution Environment & Sandbox（代码在哪运行、什么沙箱约束） | bash 一行 `cd ..` 出围栏；无容器隔离 → **C2** | OpenHands / DSH sandbox |
| **T** | Tool Interface & Protocol（工具如何描述/发现/调用） | 无 MCP 外部工具源 → **C1**；edit 无 diff / 模糊匹配 → **B4** | Cline / smolagents mcp_client |
| **C** | Context & Memory Management（模型能看到什么） | 无记忆分层（回忆 / 遗忘 / 新鲜度）→ **B6**；无工作区记忆注入 → **B10** | pi compaction / Reasonix memory |
| **L** | Lifecycle & Orchestration（步骤如何组织、简单循环→复杂编排） | 无子智能体 / handoffs → **C3**；无 goal 三件套 → **C10** | DSH todo/subagent / CodeWhale todo_snapshot |
| **O** | Observability & Operations（如何测量追踪 / 成本 / 可靠性） | 无成本跟踪 → **C5**；轨迹视图还是 v1（密列表 / 检查器）→ **C20** | pi export-html / OpenHands 泳道 |
| **V** | Verification & Evaluation（轨迹→反馈 / 护栏 / 回归） | 无 benchmark；无「别人能跑的验证路径」（作品判据） | smolagents / DSH test-support |
| **G** | Governance & Security（权限 / 身份 / 策略 / 审计） | bash 不做危险分析 → **B7**；无沙箱容器 → **C2** | CodeWhale 四档 / Reasonix 静态分析 |

注：模型适配（TeachingModel 接口）与配置集中化不在七层内——综述把"模型本身"排除在研究范围外、配置属横切关注点（第 10 章），另设模块处理（见 §7.3）。



> **工具全景参考源（2026-08-24）**：开工任何"工具"相关项（B1/B7/新工具），查 `workspace/工具全景对比-7项目.md`（7 项目工具全景 + 缺口三档）与 `workspace/三项目横向对照-施工决策表.md` 第五节（工具参考源 + 裁决增补）——那里已把 7 个项目的工具名实读核对完毕，含 ask_user_question / web_search / 后台任务三件套 / 只读放行等新缺口与抄谁。

### 7.3 需求池（原「排期表」；**唯一的需求入口**）

> **本表是「有什么可做」的唯一入口 —— 它是索引，不是内容仓库。** 内容住 `doc/plan/<名>.md`；流程见 `AGENTS.md` 第 10 条。
> **加一行 = 入池**：`ID | 做什么（一句话）| 依据（跟谁学 / 触发条件）| 详细设计 | 验收 | 状态`。**六格，一格不少** —— `scripts/check-plan.mjs` 查这一格数（≠ 6 判失败）；**不建文件、不写验收、不排优先级**（那三样是后面的事）。
> **状态**（最后一格，只有四个值，2026-09-18 定）：`未开始` · `已纳入 <迭代或另一项>`（如 `已纳入 I1` / `已纳入 C24` —— **进度看那份迭代 md**，或看被并入的那一项）· `进行中`（**已开工、还没交付**）· `已交付`（历史）。**四个值各只在一次动作里变一次 —— 所以它不会漂**（旧那套 5 种状态位要人"记得"改，实测漂成 10 处不一致）。
> **内容分工（2026-09-18 定）**：一项的**材料**（需求 / 各家怎么做 / 待拍板 / 详细设计 / 验收）全住 `doc/plan/<名>.md` —— **一句话放得下就不建文件，放不下了才建**（别预挖空壳）。**空壳 = 盘上没人指向的文件** —— `scripts/check-plan.mjs` 查这一条（没有入口就挂入口，或搬 `doc/plan-archive/`）。
> **⭐ 旧状态位已全部收编（2026-09-18 起，2026-09-20 收完）**：`💡 讨论中` / `⏳ 排队` / `⏳ 进行中` / `✅` 已全按上面四个值换掉 —— **没有一行在值域外**（原先唯一的例外 C38，2026-09-20 那一格搬进 `doc/plan/c38-communication-protocol.md` 后收编；`scripts/check-plan.mjs` 里的例外表随之删掉）。**新加的行直接写这四个值之一。**
> **开工门禁（搬了位置，没放松）**：**三格齐（依据 · 详案 · 验收）才能进迭代开工** —— 而且 **「有文件」≠「能开工」**：那个文件里必须已经写出「详细设计」+「验收」两节。以前卡在"进池子"，现在卡在"进迭代"。
> **编号**（`A5` / `B19` / `C24`）仅为稳定引用符，**字母无含义**（历史残留）；不复用、不重编。

**地基（Phase 0–5，已完成 · 无编号）** —— 早于 A 阶段，装的是「一个 agent 从零长出来」的骨架（**原「分阶段路线图」一节，2026-09-14 并入此处**）：

- **Phase 0 · 接入 DeepSeek（真实大脑）**（✅ 完成）：`lib/deepseekModel/index.ts`（流式 + 真实 token）+ MockModel 开关（`.env.local` `MOCK_MODE`）+ 轨迹打地基（L2）。施工单已归档：`doc/plan-archive/07-phase0-实现要点.md`。
- **Phase 1 · 单个会话 + 记忆**（✅ 完成）：JSONL 会话树 + `buildContext()` 回溯 + `compactIfNeeded`。详案：`doc/plan/phase-1-session.md`（含"真摘要"优化前史 → B2 落地）。
- **Phase 2 · 多个会话**（✅ 完成）：SessionManager + 前端会话列表；sessionId 校验防路径越界；清空 ≠ 删除。详案：`doc/plan/phase-2-sessions.md`。
- **Phase 3 · 文件增删改查**（✅ 完成）：read/write/edit/delete/grep/find + 路径沙箱 + 写操作全量弹框审批（60s 超时自动拒绝）。详案：`doc/plan/phase-3-tools.md`。
- **Phase 4 · 终端运行**（✅ 完成）：BashRunner（spawn 流式 + 两级终止 + run 级取消）+ bash 全量弹框。**2026-08-26 乱码根治**：受限语言模式下 cmd+chcp+EncodedCommand。详案：`doc/plan/phase-4-bash.md`。
- **Phase 5 · task 面板**（✅ 完成）：todo 是会话事件（非独立存储）；`todo_write` 整表替换幂等；面板只读展示；Reasonix 式关闭交互（未完成强制可见）。详案：`doc/plan/phase-5-todo.md`。

> 每完成一个阶段就 `git commit` —— Agent 项目的 bug 常跨协议 / loop / 工具 / 存储，阶段提交能帮你回到最近的可用点。

#### 7.3.1 功能待办 · 大功能（**必选**）

> **顺序规则**：**已完成在前**（作为基础与历史，按完成时间）→ **未完成在后**（按优先级）；**有依赖关系的，前置在前**（依赖关系写在状态格末尾）。
> ⚠️ **顺序是默认指引，不是硬约束** —— 想先做后面的，完全可以（2026-09-14 用户明示）。
> **开工门禁**：三个格子（依据 / 详细设计 / 验收）齐了才算定案 —— 验收格为 `—` = 未定案 = **不许开工**，状态应是 `未开始`。

| # | 做什么 | 依据 | 详细设计 | 验收（怎么算做完） | 状态 |
|---|---|---|---|---|---|
| A1 | **Phase 5 task 面板** | DSH todo / CodeWhale todo_snapshot | — | 模型产出任务清单，前端显示进度，刷新不丢 | 已交付 |
| B1 | **审批升级四步**：只读命令放行 / 分级模式 / 审批日志 / 面板 + 记忆 | Reasonix / CodeWhale / pi | `doc/plan/b1-approval.md` | ✅ 四步全部落地（2026-08-26） | 已交付 |
| B2 | **真摘要压缩**：拼贴 → 调模型生成结构化摘要（pi 六段 + DSH Files/Errors 两段；增量 previousSummary；经济性检查；MOCK 降级拼贴） | pi compaction + DSH + Reasonix | `doc/plan/b2-compaction.md` + `doc/02-*.md`（四家对照） | — | 已交付 |
| B22 | **多会话并行 run（session-owner 架构）**：run 的 owner 从 UI 变会话 —— 切会话不取消在跑的 run | DSH useProjection / opencode run-coordinator | `doc/plan/b22-multi-session-run.md` | ✅ 浏览器人工验收场景 1-10 全过（09-04） | 已交付 |
| A3 | **L3 Trace Viewer** | pi export-html / OpenHands 泳道（v2 见 C20） | `doc/plan/observability.md` | ✅ 8 条验收全过（2026-09-14） | 已交付 |
| A5 | **web_search / web_fetch** | DSH tool-web / codex 决策边界 / opencode webfetch | `doc/plan/a5-web-search.md` | ✅ 真机验收通过（2026-09-14） | 已交付 |
| C1 | MCP 接入 | Cline / smolagents mcp_client | — | — | 未开始 |
| C8 | **Skills**：`skill` 工具 + `/` 面板技能条目 + 裸名手势 `/名字` | DSH tool-skill / pi core/skills.ts / opencode / codex | `doc/plan/c8-skills.md` | ✅ §5 十条验收全过（2026-09-17） | 已交付 |
| C2 | 沙箱容器（**2026-09-14 扩范围：加"网络维度"**——原设计只有文件/进程，网络是空白） | **codex `network-proxy` + Windows MXC**（最新侦察）/ OpenHands / DSH sandbox | — | — | 未开始 |
| C3 | 子智能体 / handoffs | DSH subagent（8 种实现）；⚠️ **动红线文件** `lib/agent/index.ts`（改动前须精读 pi → 对比 → 展示 → 用户拍板） | — | — | 未开始 |
| B6 | **记忆分层**：会话 + 摘要已有，补"主动回忆/新鲜度" | Reasonix memory | — | — | 未开始 |
| C6 | 工作区选择 | future-plans 已有设计；⚠️ **C33（围栏加固）跟它一起做** | `doc/plan/future-plans.md` | — | 未开始 |
| C27 | **刷新后重连正在跑的 run**（2026-09-14 从「条件触发」**升为排期项**）：runStore 是内存态，刷新即丢 —— **在作品里是明显短板** | opencode `Session Runtime` 形态（run 与 POST 连接**解耦** + 可重连订阅）；对照我们的 `app/lib/run-store.ts`（内存态 zustand） | `doc/plan/c27-run-reconnect.md`（材料已归位 · 未定案） | — | 未开始 |
| C31 | **输入框改造**：纯文本 `<textarea>` → 结构化输入（片段模型 + 行内 chip）。用户 2026-09-16 提；须拍 **甲 / 乙 / 丙** + 与 C8·C14 的先后 | **待侦察**（DSH Web / opencode / codex / pi 的输入台 —— 尚未读过） | `doc/plan/c31-input-editor.md`（材料已归位 · 未定案） | — | 未开始 |
| C32 | **项目级 agent 配置目录 `.statve/`**（含项目级技能），与用户级合并。用户 2026-09-17 定「下个版本要加上」；难点 = **同名谁赢** | **待侦察**（Claude Code `.claude/` / codex / DSH / opencode —— 尚未读过） | `doc/plan/c32-project-config.md`（材料已归位 · 未定案） | — | 未开始 |
| C33 | **围栏加固：跨盘符绝对路径能穿出工作区**（⚠️ **已知漏洞**：`read_file` 免审批读到了 C 盘，而工作区在 `E:`；2026-09-16 用户在 T2 真机验收时定「**先不修，跟项目分组（C6）一起做**」） | C8 详案 `doc/plan/c8-skills.md` 的 **11.2 节**（现象 / 根因 / 影响面 / 修法 / 用例全在里面）+ Node `path.relative` 的跨盘语义 | `doc/plan/c8-skills.md`（11.2 节即诊断与修法；加固方案随 C6 的围栏语义定） | ① 跨盘符绝对路径被拒（先红后绿的用例）② `read_file` 被挡 ③ `bash` 读同一资源照常（退出码 0） | 已纳入 I1 |
| C34 | **工具规矩的归属**：文本住工具文件，提示词由注册表装配 | 五家一手对照（详案 §二） | `doc/plan/c34-tool-guidelines.md` | ✅ 代码 + 真机探针都过 | 已交付 |
| C35 | **反馈色不许复用「面」的 token**（白底上画白色）：中性壳之后「拿 `--paper` 当悬停 / 高亮」的浮层**反馈静默消失** —— 键盘选中也一起没了（**既有**缺陷，非 C8 T6 引入） | 用户 2026-09-16 报障「方向键上下选中没有了」+ 三处实证（`app/globals.css:35-36` · `command-menu.module.css` · `ui/menu/menu.module.css:50,83-86`） | `doc/plan/c35-feedback-colors.md`（材料已归位 · 未定案） | — | 已纳入 I1 |
| C36 | **bash 错误流：可见、可读、可判**（2026-09-17 从一条**真实**会话记录里查出：模型一条命令 **18 个文件全报错、退出码 0、工具回「成功」**） | 会话记录 `.sessions/s_2026-09-17T00-18-22-102Z_sj9bo2.jsonl`（31-33 行原始证据）+ 本机双版本探针（5.1 与 pwsh 7.6.6）+ 五家一手对照（**file:line 全在详案**） | `doc/plan/phase-4-bash.md` 的 **2026-09-17 追加节**（三个断点 / 实测 / 五家对照 / T1-T3 方案 / 明确不做 / 验收） | ① `readPwshErrors` 解真 CLIXML 并去重计数 ② 判据抽纯函数后测四种组合（吸收 B19 那五条）③ bash 投稿进提示词 ④ T1 / T2 / T3 各自独立验收 | 已交付 |
| C37 | **技能清单的规模策略**：可见技能上百时，提示词里那份清单怎么办（用户定性：**优化，不是缺陷**） | 用户 2026-09-17 提出 + 本机实测（21 条 / 4,390 字符）+ 各家一手对照；**触发条件：可见技能 > 40 条，或清单 > 8,000 字符** | `doc/plan/c37-skill-catalog-scale.md`（材料已归位 · 未定案） | — | 未开始 |

#### 7.3.2 功能待办 · 小功能（**必选**，按成本）
| # | 做什么 | 依据 | 详细设计 | 验收（怎么算做完） | 状态 |
|---|---|---|---|---|---|
| A4 | **ask_user_question** | DSH tool-ask-user / codex request_user_input | `doc/plan/a4-ask-user.md` | ✅ 弹层 → 回答 → 继续 | 已交付 |
| C13 | **斜杠命令面板**（`/compact` · `/clear` · `/export` + ContextMeter） | pi slash-commands / Reasonix commands | `doc/plan/c13-slash-commands.md` | ✅ 全链路可用（2026-09-01） | 已交付 |
| B14 | **上下文余量指示**（外部评估 B 级顺手件）：数据已齐（done 帧 stats.tokens + 压缩阈值在 config），只差读数盘加一格"上下文 X%" | Claude Code /context | `doc/plan/c13-slash-commands.md`（并入 C13 的竣工记录） | ✅ ContextMeter 圆环已挂在页面上（`app/page.tsx`，2026-09-01） | 已交付 |
| C15 | **开源仓库更新面板**（`/repos` 左右布局 + LLM 总结新增 commit） | git CLI + 复用 B2 模型管道 | `doc/plan/c15-repo-updater.md` | ✅ 5 文件 36 用例全绿（2026-09-01） | 已交付 |
| B15 | **自动会话命名**（外部评估 B 级顺手件）：首轮 assistant 回复完成后用首条用户消息（或小模型一句话）生成 title 更新会话（title 字段 + 改名接口都有） | Claude Code / DSH；**成本：顺手，半小时** | — | — | 未开始 |
| C12 | move_file / read_image | Reasonix move_file / DSH read_image | — | — | 未开始 |
| B10 | **工作区记忆文件注入**：`systemPrompt` 常量 → `createSystemPrompt(workspaceRoot)` 工厂，尾部拼接 `workspace/AGENTS.md` | Claude Code CLAUDE.md / pi AGENTS.md / Codex | `doc/plan/b10-workspace-memory.md`（材料已归位 · 未定案） | 记忆文件写一条规矩 → 新会话模型遵守；文件不存在行为不变 | 未开始 |
| C14 | **@ 文件匹配**（file mention）：输入 `@` 触发文件模糊搜索（文件+文件夹）→ 选中注入模型上下文（代码编写时点名要读的代码/配置；用户 08-27 提，**排在 C13 之后做**） | Codex `mention_codec`/`fuzzy_file_search` + pi `file-processor`（已实读） | `doc/plan/c14-file-mention.md` | — | 未开始 |
| B4 | **文件 diff 预览**：edit/write 前生成 diff（红绿视图） | Cline / DSH DiffBlock | — | — | 未开始 |
| C4 | 定时任务 | DSH schedule | — | — | 未开始 |
| C5 | 遥测/分析面板 | pi usage-totals / DSH feedback；← 延伸自 A3（已完成） | — | — | 未开始 |
| C7 | 设置页 | DSH settings / pi .pi/；← **依赖 C6（工作区）** | `doc/plan/c7-config.md` | — | 未开始 |
| C9 | 代码执行器（python） | smolagents local_python_executor；← **依赖 C2（沙箱）** | — | — | 未开始 |
| C10 | goal 三件套 | DSH goal / CodeWhale goal / Reasonix update_goal | — | — | 未开始 |
| C11 | complete_step 证据签收 | Reasonix complete_step | — | — | 未开始 |
| C25 | **多模型支持**（2026-09-14 目的变更后**从「暂缓」翻为「要做」**）：接第二家 provider，**验证 `TeachingModel` 接缝真的能换** | pi `packages/ai`（pi-ai 包，多 provider 抽象）；我们的 `config.provider` + `TeachingModel` 接缝已留（A5 的两次调用已证明端点可分开） | `doc/plan/c25-multi-provider.md`（材料已归位 · 未定案） | — | 未开始 |
| C26 | **交互式 TTY 终端**（pty：能跑 `vim` / `top` / 交互式命令）。⚠️ **Windows 上是难点**（ConPTY） | pi / DSH 的终端面板；对照我们的 `BashRunner`（一次性 spawn + 流式，**无 pty**） | `doc/plan/c26-tty-terminal.md`（材料已归位 · 未定案） | — | 未开始 |
| C40 | **思考过程渲染（`reasoning_content`）**：适配器**完全没捕获** ⇒ 推理模型的思考既不进上下文、也上不了界面 | 参考项目怎么渲染 reasoning：**待侦察**（DSH / pi / opencode，**尚未读过，别当已有依据**） | `doc/plan/c40-reasoning-render.md`（材料已归位 · 未定案） | — | 未开始 |

#### 7.3.3 工程优化待办（**可选** —— 想做就挑，按成本）

| # | 做什么 | 依据 | 详细设计 | 验收（怎么算做完） | 状态 |
|---|---|---|---|---|---|
| A2 | **测试框架 vitest** | smolagents / DSH test-support | `doc/plan/a2-vitest.md` | ✅ tools 全测过、`pnpm test` 绿 | 已交付 |
| B16 | **引擎核心零测试补齐**：`runAgentLoop` + `deepseekModel` 的单测（block→isError / rewrite / 抛错不崩 / maxTurns；tool_call_id 配对 / 坏 JSON） | pi（引擎测试思想）/ DSH test-support | `doc/plan/b16-engine-tests.md` | ✅ 31 文件 263 用例全绿（2026-09-01） | 已交付 |
| B18 | **测试质量细节**：消灭弱断言 / 补 store 树语义 / `approval-memory` 显式 reset | 体检报告 2.2 节 | `doc/plan/b18-test-quality.md` | ✅ 随 B16 一起完成（2026-09-01） | 已交付 |
| B20 | **前端状态派生 CSS 化（方法论）**：结构位置→兄弟选择器 / 布尔→`data-*` / 尺寸→container query | DSH `chatperf` 三 commit + 决策笔记 | `doc/plan/b20-css-derived-state.md`（**B21 动手前先读**） | ✅ 已记录（2026-09-01） | 已交付 |
| B17 | **前端渲染优化**（②③⑤）+ **决策区输入框常驻**（④） | 体检报告前端专项 + 输入框常驻模式 | `doc/plan/b17-frontend-race-and-render.md` | ✅ 流式不再全树重渲；审批/提问时输入框被盖住且行为等价 | 已交付 |
| C19 | **存量模块「实现与单测同目录」收编**：20 处存量违规搬进 `<模块>/index.ts` | `AGENTS.md` 6.5 + 自家 `lib/tools/` 先例 | `doc/plan/c19-module-colocation.md` | ✅ 20 处 / 40 文件全搬完，git 认作改名（`dea7d1b`） | 已交付 |
| C28 | **会漂的东西改成「跑一下就报」**：① 状态列生成式 ② 判词扫描。判据 = **凡是「需要有人定期回头检查」的字段都会烂**（实测 10 处不一致） | 2026-09-14 对账实测 + 09-15 前提同步审计 | `doc/plan/c28-generated-status.md`（材料已归位 · ⚠️ ① 的旧设计已被 09-18 落地改写 · 未定案） | — | 未开始 |
| B19 | **bash 工具定义测试补齐**：`lib/tools/bash/index.ts`（`createBashTool`）零测试，其他 10 个工具都有 | 对齐 lib/tools 其他工具 index.test.ts | `doc/plan/b19-bash-tool-tests.md`（材料已归位 · 未定案） | — | 已交付 |
| B21 | **前端状态派生 CSS 化（落点实施）**：B20 的两个落点（command-menu hover 去 JS 化 / 布尔类名 → `data-*`） | B20 方法论 | `doc/plan/b21-css-derived-state-rollout.md`（材料已归位 · 未定案） | — | 未开始 |
| B11 | **会话级运行锁**（外部评估 S3）：route.ts POST 入口 per-session 占用表（`Map<sessionId, runId>`），占用中返回 409 + 明确文案，finally 释放 | 所有成熟 harness 隐含前提 | — | 并发两请求同 session → 第二个 409；不同 session 不受影响 | 未开始 |
| B12 | **中断 / 崩溃会话自愈**：扫描尾部未配对 toolCall → **不改文件**，重建上下文时补合成 toolResult | Claude Code / pi resume | `doc/plan/b12-interrupted-session-heal.md`（材料已归位 · 未定案） | 手工构造孤儿 toolCall 会话文件 → 正常发消息不 400；合成结果进上下文且前端可见 | 未开始 |
| B5 | **hooks 注册表**：`beforeToolCall` 泛化成 `onBeforeTool` / `onAfterTool`。⚠️ **含 E5**（审批策略硬编码 → per-tool 重构） | CodeWhale / DSH hooks；⚠️ **动红线文件** `lib/agent/index.ts` | `doc/plan/b5-hooks-registry.md`（材料已归位 · 未定案） | — | 未开始 |
| B9 | **模型请求重试与退避**（外部评估 S1）：瞬时错误（429/5xx/超时）指数退避重试 2~3 次（`Retry-After` 头优先）、永久错误（401/400）fail-fast、请求加空闲超时兜底；重试过程发轨迹事件 | Claude Code / pi / DSH | — | stub fetch 前两次 429 第三次成功 → complete 正常返回 + 轨迹 2 条 retry；401 不重试 | 未开始 |
| C24 | **网络查询优化 —— web 后端整体复查**（用户 2026-09-14：「后端我们单独开一个网络查询优化 task，进行整体的复查」）：**不是加功能，是把 A5 这一整块从头到尾过一遍**；复查范围是**草稿 9 条，开工前定稿** | opencode `core/src/tool/`（`webfetch` + `websearch` + `tool-output-store` + `AGENTS.md`）/ DSH `packages/web/tool-web/` / codex `web.run` 决策边界 | `doc/plan/c24-web-review.md`（范围草稿已归位 · 未定案） | — | 已纳入 I1 |
| C22 | **工具输出的「超限不丢」两层**：现在是**截断即丢弃**，opencode 是**留一份 + 给路径**；第二件 = **生产者上限与模型上限分两层** | opencode `core/src/tool-output-store.ts` + `core/src/tool/AGENTS.md`（Output 节）／对照 langchain `webbrowser.ts`（"不把全文给模型"的 RAG 路线） | `doc/plan/c22-output-overflow.md`（材料已归位 · 未定案） | — | 已纳入 C24 |
| C23 | **抽取降噪：把导航 / 页脚 / 图片链接从正文里剔掉**（2026-09-14 用户真机复跑给了**真实样本**：36氪频道矩阵 17 个品牌名，粗估 2000 字符 / 40%） | 反参照：opencode `core/src/tool/webfetch.ts` 与 DSH `tool-web/fetch.ts` 都**不**按标签删导航（它们只做 §7.14.4 那层"删不可见内容"） | `doc/plan/c23-extraction-denoise.md`（材料已归位 · 未定案） | — | 已纳入 C24 |
| C20 | **轨迹视图 v2：密列表 + 记录检查器 + 泳道总览**（A3 v1 形态保留可用，**这是优化项不是返工**） | DSH `packages/client/ui-trajectory`（`TrajectoryTable` / `TrajectoryTimeline` / 文案表 / 快照构建）—— file:line 见详案 | `doc/plan/observability.md`（材料已归位 · 未定案） | — | 未开始 |
| C21 | **轨迹文件瘦身：`message_update` 不重复存整份累积消息**（实测 3266 条 entry 撑成 1.1MB，折叠后只有 11 条记录） | DSH `session-persistence-jsonl`（按类型裁剪 + 可选 zstd 压缩 + 分代文件 `session.vN.jsonl`） | `doc/plan/observability.md`（材料已归位 · 未定案） | — | 未开始 |
| B3 | **UI V2：尺度升级 + 原语库**（按钮 ≥34px 命中区 / 第一个原语 Menu / 面板 chrome 统一） | DSH `dsh-client-ui-primitives` + Reasonix 面板族（走读 18） | `doc/plan/ui-design.md`（材料已归位 · 未定案） | ✅ ①尺度（`--hit: 34px` ×7 处）②Menu 原语接进会话行 ③④经 §10.8 评估收口 ⑤checklist 落地（2026-09-18 复核） | 已交付 |
| B8 | **前端单元测试**（**非核心**）：纯函数层先行，组件 / hooks 层等「冻结信号」 | vitest + Testing Library（参考 DSH test-support） | `doc/plan/b8-frontend-tests.md`（材料已归位 · 未定案） | — | 未开始 |
| B7 | **终端加固**：bash 输出全量落盘 + shell 危险分析（重定向/嵌套检测） | Reasonix shellsafe | — | — | 未开始 |
| C18 | **会话 + 压缩 联合重构**（产品化前置）：**A 档已收口**（砍树 + 撤兼容）· B 档消解 · C 档条件触发；余 ⑥「按工作目录分组」与 C6 绑一起 | DSH `session-format` / `session-projection` / `session-query` / `compaction` / `session-persistence-jsonl`（两层的 project/session 目录树）+ C6 工作区选择 —— 完整清单见详案 | `doc/plan/session-compaction-refactor.md`（材料已归位 · 未定案） | ✅ A 档 3 件 + 砍树（`10850dc`）已落地；B 档消解（2026-09-14，详见详案 §7 / §8） | 已交付 |
| B2.1 | **压缩打磨三件套**（DSH 走读 24 触发）：① compaction entry 补审计字段（被压消息 id 列表 + 摘要模型名）② "摘要必须更小" fail-closed 检查（摘要 ≥ 被压区域不落盘）③ tool-pairing balance 升级（替代"第一条不是 toolResult"单点修正）；B 类不抄（锁/KV cache/影子价格/错误分类/接口抽象——场景不需要） | DSH compaction（走读 24 施工单） | — | — | 💡 讨论中（条件触发：① 长期会话复盘时 ② 下次动 compact.ts 时 ③ 遇孤儿工具坑时）。⚠️ **若 C18 开工则并入 C18**（本项是"够用版打磨"，C18 是"重构级"——同一处别改两遍） ← 并入 C18 |
| C39 | **流式 tool_call 的截断保护**：模型输出被截断（`stopReason="length"`）时，残缺 JSON 可能被 parse 成不完整对象**拿去执行** | pi 引擎的 `failToolCallsFromTruncatedMessage`；我们 `lib/deepseekModel/`（流式累积 + 一次 parse） | `doc/plan/c39-truncated-toolcall-guard.md`（材料已归位 · 未定案） | — | 未开始 |
| C42 | **`PLAN.md` 池子表结构收缩：6 列 → 4 列（`ID / 做什么 / 依据 / 去向`）+ 文末「已交付」区**（2026-09-18 定） | 2026-09-18 实测（列数 / 字符数）+ C19 的干跑先例 | `doc/plan/c42-pool-table-shrink.md`（材料已归位 · 未定案） | ① 干跑清单经人核过 ② 收缩后池子主表 grep **不出现** `✅ / ⏳ / 💡` ③ 全部 ID 一个不少、引用零断裂 | 未开始 |
| C43 | **隐藏技能守卫用例的子串误报**：`lib/skill/index.test.ts` 用 `catalog` 的**子串**包含判断，而隐藏技能 `teach` 是可见技能 `slidev` 描述里 "teaching materials" 的子串 ⇒ **产品行为是对的**（隐藏技能确实没进清单），错的是断言的匹配方式 | 2026-09-20 全量单测实测（C36 T1 验收时撞见；`git stash` 摘掉 T1 改动后照样红 ⇒ 非 C36 引入）+ 本机技能根实读（9 个 `disable-model-invocation: true`） | — | — | 未开始 |

#### 7.3.4 项目级事项（不属于任何功能/优化）

| # | 做什么 | 依据 | 详细设计 | 验收（怎么算做完） | 状态 |
|---|---|---|---|---|---|
| C17 | **包装与开源**（README / 录屏 GIF / 在线 demo 评估 / 开源准备）—— **2026-09-14 定：快速迭代期先不做** | 自身经验 | `doc/plan/c17-packaging-opensource.md`（材料已归位 · 未定案） | — | 未开始 |
| C29 | **整体评价体系**：先调研现成的 → 评价维度 → 评一遍 statve 自己 → 固化成 skill + 收尾检查项。排期 = 大功能全完成之后 | 首要依据 `Agent-Harness-Survey-ZH-main` §8 + 6 个候选（一手） | `doc/plan/c29-evaluation-system.md`（材料已归位 · **开工先读 `doc/研究/agent评价标准-调研.md`**） | — | 未开始 |
| C30 | **改名：`Teaching Agent` / `agent-learn` → `statve`**（2026-09-16 用户拍板；「观测台」一并清理） | `workspace/agent命名-欧洲小语种候选.md` §5.5（占用矩阵，RDAP 实测）+ §2.1（词义） | `doc/plan/rename-statve.md`（材料已归位 · 未定案） | ✅ 代码 / UI / 文档全落地（`package.json` name · `app/layout.tsx` 标题 · `nameplate` wordmark · 提示词自称 · 护栏消息 · User-Agent）；旧三串 0 命中（2026-09-18 复核） | 已交付 |
| C38 | **沟通协议：把「讲明白」变成有检查方式的规则**（8 条病 + 4 个候选方向 · 2026-09-17 用户提出；原话 / 触发场景 / 检查方式全在详案里） | 用户 2026-09-17 原话 + C8 三天的真实样本（同一个决定被二次解释；a1/a2 两条 bug 是功能自己引发的返工） | `doc/plan/c38-communication-protocol.md`（材料已归位 · 未定案） | —（定案后再写；**必须含"检查方式"**） | 未开始 |

| C41 | **仓库是 public、git 历史里有旧内容 —— 怎么处置**（2026-09-18 从退役的 `会话检查点.md` 收编；**已决但没落地**） | 2026-09-15 会话实测；关联 **C17** 的「敏感信息扫描」这条验收**从来没做过** | `doc/plan/c41-public-repo-history.md`（材料已归位 · 未定案） | 用户拍板三选一（转私有 / rewrite / 明确承担不改）+ 执行完复验 | 未开始 |

#### 7.3.5 条件触发（不排期，但连理由一起记着 —— 免得反复重提）

> **判据（2026-09-14 加）**：不做的理由是「**学习项目没必要**」→ **重审**；理由是「**工程上不划算**」→ 保留。

| 项 | 状态 | 复查结论（目的改为「作品」后） |
|---|---|---|
| **LSP 代码智能** | 💡 讨论中 | 原判理由含「**教学项目收益低**」→ 🔴 **该理由已失效**；但"要起语言服务器进程"是**真实的工程成本** → 作为高成本可选项留在讨论中 |
| **tool_search 工具发现** | ⏳ 条件触发 | 原判「工具超过 20 个才需要，现在 13 个」是**工程理由** → ✅ **仍成立**，等工具膨胀 |
| **monorepo 抽包**（`lib/` 抽成共享包） | ⏳ 条件触发 | 原 Phase 6：「若出现『内核要被多个入口复用』的需求，这是**换架构的正确时机**」→ **工程理由，仍成立** |
| **内存态 Map**（`toolApprovals` / `userAnswers` / `runControllers`） | ⏳ 条件触发 | 单进程 OK，**多进程失效**（外部评估 E6；原先只记在已删的「外部评估问题清单」里）。与 **C6 工作区 / 部署**相关，触发时处理 |
| **工具注册表生命周期改长驻**（会话级 / 进程级） | ⏳ 条件触发 | 现状是**每请求组装**（贴 pi create-harness；08-27 特意拆掉了 route.ts 顶部的模块级单例），`ToolContext` 的值因此可以在组装时焊进工具闭包。**用户 2026-09-16**：「**我不能给你肯定我们的注册表以后一定还是每次请求重建**……如果改动的话就是大改了，整个会话应该都是大改了」→ 故记为**条件触发**。**触发时要做的**：环境值不能再靠组装时焊死，必须改走 `execute` 的**运行时参数** —— **pi 的长驻形态就是这么做的**（`execute(toolCallId, params, onUpdate, toolContext, …)`）；⚠️ **会碰红线文件 `lib/agent/index.ts`** → 走红线流程（精读 pi → 对比 → 展示 → 用户拍板）。**为什么现在不做**：今天没有让它长驻的需求（14 个工具对象每请求重建的开销可忽略），提前做就是**为一个造不出来的场景动红线**。背景见 `doc/plan/c8-skills.md` §11.1 第 3 条 |

> **已从本表移出**：~~B22 衍生「刷新后重连正在跑的 run」~~ → **已升为排期项 `C27`**（§7.3.1，2026-09-14 定）。

**原判原文留档**（2026-09-14 之前写的，一个字没改）：

> **非核心/可选（暂不排期，条件触发）**：**LSP 代码智能**（重型依赖——要起语言服务器进程，教学项目收益低；真需要代码智能时再评估）和 **tool_search 工具发现**（工具超过 20 个才需要，现在 12 个；等工具膨胀时再评估）。这两项不是"不学"，是"条件触发"。
> **B22 衍生未来项（2026-09-02，用户暂不接受当前方案、记入优化项）**：**刷新后重连正在跑的 run**——B22 一期接受"刷新 = 放弃实时观察，回 A 看落盘结果"（runStore 内存态，刷新丢；服务端 run 仍继续跑完落盘）。要补实时需服务端 run **脱离请求生命周期**（run 与 POST 连接解耦、可重连订阅，opencode Session Runtime 形态），是独立大工程，条件触发（用户明确要时）。

### 7.4 落地原则（核心规则）

1. **每步标注"参考谁"**：学的是思路不是代码；实现时对照参考项目源码（本地都有）
2. **一次收口一个 commit**：收口时小步提交，每步展示清单等确认
3. **先补思路再动手**：开工前先在 `doc/plan/<名>.md` 补详案 —— **PLAN 只留指针与一句摘要**
4. **验收标准先行**：三格（依据 / 详细设计 / 验收）没齐 = **未定案 = 不许开工**（见 §7.3 顶部）
5. ~~B1 优先~~ → **已完成**（B1 审批四步，2026-08-26）；本条作废

> **计划增改与维护流程以 `AGENTS.md` 第 10 条为准** —— 本节不重复。
> （2026-09-14 去重：原文的「先在 7.3 排期表加一行 / 核心排 A/B 阶段 / 完善排 C 阶段」讲的是**旧结构**，已删。）
> **位置与状态**见 §7.3 顶部的说明；**「不做」记哪**见 §五。
