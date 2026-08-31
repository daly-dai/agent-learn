# 开源项目导航手册（Reference Map）—— 索引

> **定位**：给未来的 AI 会话用的**项目导航卡**——回答"想找某类知识，去哪个项目的哪个文件，用什么关键词搜"。省掉每次重头摸索项目结构的时间。
> **与 PLAN.md 第四节 / 三项目精读路线图的关系**：那两份回答"**学什么**"（按主题列文件）；本手册回答"**去哪找**"（按项目列结构 + 搜索配方）。先读本手册定位，再读对应走读笔记深入。
> **存储位置**：参考项目本体在 `E:\agents-read\<项目名>\`（how-pi-agent-works 已删除，2026-08-31 起不再参考）。
> **使用方式**：① 新需求 → 看下方"项目速览"表 → 打开对应项目文件（功能→位置映射表）→ 直接打开对应文件；② 没找到 → 用该项目的"搜索配方"；③ 走读笔记标 ✅ 的模块**不用重读**，直接引用结论（见文末"已读走读索引"）。
> **维护规则**：新增/删除参考项目时，按 `sop-新增参考项目.md` 走完整流程（确认存在 → 架构解析 → 填导航卡 → 回填 → 验收）；每完成一篇新走读，更新对应项目文件的"已读"列。

---

## 项目文件（渐进式：每个项目一个文件，按需打开）

| 项目 | 文件 | 一句话定位 |
|---|---|---|
| pi（主参考） | [pi.md](pi.md) | agent-loop / session / compaction，架构源头 |
| codex | [codex.md](codex.md) | 工业毕业形态（Rust）：审批引擎 / 沙箱 / rollout |
| deepseek-harness（DSH） | [deepseek-harness.md](deepseek-harness.md) | 功能全景 / 插件化（50+ 包），官方中文文档优先 |
| Reasonix | [reasonix.md](reasonix.md) | 前端 UI / 面板 / 审批交互主参考（Go + React） |
| smolagents | [smolagents.md](smolagents.md) | 轻量 Python agent 框架对照 |
| CodeWhale | [codewhale.md](codewhale.md) | Rust 审批四档 / hooks / 状态参考 |
| Survey（综述） | [survey.md](survey.md) | ETCLOVG 七层分类法，学术坐标系 |
| langchainjs | [langchainjs.md](langchainjs.md) | LangChain JS：新一代 agent 框架 + middleware 生态 |
| opencode | [opencode.md](opencode.md) | 终端 Agent 完整实现（TS，dev 分支） |

> **新增项目流程**：见 [sop-新增参考项目.md](sop-新增参考项目.md)（确认项目存在 → 架构解析 → 填导航卡 → 回填 → 验收）。

---

## 〇、项目速览（先看这张表定位去哪个项目）

| 想学什么 | 去哪个项目 | 核心位置（详见对应文件） |
|---|---|---|
| 架构纪律 / 分层 / 会话树 / 压缩 | **pi** | `pi/packages/agent/src/harness/` |
| 产品层（bash 执行 / 会话管理 / 斜杠命令） | **pi** | `pi/packages/coding-agent/src/core/` |
| 工业级 Rust 实现 / 审批引擎 / 沙箱 | **codex** | `codex/codex-rs/core/src/` + `execpolicy/` + `sandboxing/` |
| 功能全景 / 一能力一包 / 插件化 | **DSH** | `deepseek-harness/packages/` + `docs/` |
| 前端 UI / 面板 / 交互设计 | **Reasonix** | `DeepSeek-Reasonix-main-v2/desktop/frontend/` |
| 轻量 Python agent / 代码执行器 | smolagents | `smolagents-main/src/smolagents/` |
| Rust 审批 / hooks / 状态 | CodeWhale | `CodeWhale-main/crates/` |
| 学术分类法（ETCLOVG 七层） | 综述 | `Agent-Harness-Survey-ZH-main/` |
| agent 生态 / 中间件体系 | **langchainjs**（新增 08-31） | `langchainjs/libs/langchain/src/agents/` |
| 终端 Agent 完整实现 | **opencode**（新增 08-31，dev 分支） | `opencode/packages/opencode/src/` + `packages/core/src/` |

---

## 已读走读索引（引用结论时查这里，不重读）

| 走读 | 项目 | 主题 |
|---|---|---|
| 01-05 | pi | 循环/事件/会话/压缩/工具 |
| 06 | codex | execpolicy 审批引擎 |
| 07 | DSH | todo 任务面板 |
| 08 | codex | sandboxing 沙箱 |
| 09 | DSH | 架构（waterfall/seam） |
| 10 | DSH | subagent |
| 11 | codex | rollout 轨迹 |
| 12 | pi | 产品层 |
| 13 | DSH | hooks |
| 14 | codex | skills/hooks/memories |
| 15 | DSH | skill |
| 16 | codex | core+tools |
| 17 | DSH | sandbox+shell |
| 18 | Reasonix | 产品端面板（UI） |
| 19-23 | smolagents/codex/Reasonix 等 | web 工具族 / skills 精读 |
| 24 | DSH | 压缩对照（B2.1 触发） |
