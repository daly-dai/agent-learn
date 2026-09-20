# C29 · 整体评价体系

> **这是「攒材料」阶段的需求文件**（`AGENTS.md` 第 10 条 ②）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 C29 行（2026-09-18 搬入）· 用户 2026-09-14 三次修正 · `doc/研究/agent评价标准-调研.md`
> ⚠️ **只搬事实，不发明方案**。**「详细设计」与「验收」现在是空的 —— 没定案就不许开工。**

## 一、需求（要做什么）

**用户原话（2026-09-14）**：「**要不然鬼知道你这玩意到底好不好，也没个标准的**」。

**三次修正（这就是需求的确切形状）**：
1. 「值得封装成 skill」
2. → 「**先考虑有没有，然后再看看好不好**」
3. → 「**等我们把大功能做完了之后开始搭建整体评价体系**」

⇒ **做法第一步是调研现成的，不是自造**；**排期 = 大功能全部完成之后**。

## 二、参考（现成的一手来源，已知候选）

| # | 来源 | 备注 |
|---|---|---|
| ① | ⭐ **`Agent-Harness-Survey-ZH-main` §8「Verification and Evaluation」整章** | 本项目 `PLAN.md` 的 ETCLOVG 抄自同一份 survey 的 §2.3 —— **只抄了分类法，§8 整章还没用**；就在 `E:\agents-read` 里 |
| ② | `awesome-harness-engineering` 的 Evals & Verification 段 | |
| ③ | OpenTelemetry GenAI 语义约定 | |
| ④ | arXiv 2606.10106「harness 的充要条件」 | |
| ⑤ | Anthropic《Demystifying Evals for AI Agents》 | |
| ⑥ | 工具：Inspect AI / promptfoo / DeepEval / LangFuse / skillgrade | |

**判据（用户定的顺序）**：**有 → 对齐或抄，并写清哪条不适用；确实没有 → 才自造。**

## 三、⚠️ 第一步已经有一份了（开工先读它，别从零再调研）

`doc/研究/agent评价标准-调研.md`（**1,426 行**，2026-09-15 调研子代理在被叫停前写完的）：
- 一手来源优先 + 明确区分「**读到的 / 推断的**」
- 专列 **12 条「找不到现成物」的空白**
- 结论：现成尺子分五类（A 架构充要条件 / B 可观测性规范 OTel GenAI / C 评估方法论 / D 能力基准 / **E 元评估** —— 意外收获），但**没有任何一条是"给 harness 工程质量打分"的通用量表**
- 并且**在我们自己的参考项目源码里挖到了现成质量门禁**：`DeepSeek-Reasonix-main-v2` 的 `benchmarks/e2e/tasks/`（无解任务 + 反向打分，专测 agent 会不会撒谎）+ `tools/repolint/`（分层 + baseline 棘轮）、`pi` 的 `scripts/check-entry-graphs.mjs`、`deepseek-harness` 的 `scripts/verify-client-domain-graph.ts`

## 四、产出顺序（用户定的）

```
调研报告  →  评价维度  →  评一遍 statve 自己（差距清单）  →  固化成 skill + 检查项
                                                            ↑ 并纳入收尾流程
```
（**C28** 会成为其中一条检查项。）

## 五、详细设计

> ⛔ **未定案。** 补齐本节 +「验收」才能进迭代。

## 六、验收（怎么算做完）

> ⛔ **未定案。**
