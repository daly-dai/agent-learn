# B16 · 引擎核心零测试补齐

> **这是已完成项的「竣工记录」**（`AGENTS.md` 第 10 条：材料住 `doc/plan/<名>.md`）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 B16 行（2026-09-18 搬入；原行的实质内容只写在池子里，没有家 ⇒ 建本文件）

## 一、要做什么（原文）

**引擎核心零测试补齐**（体检报告行动①③，最高优先级）：补
- `lib/agent/index.ts`（runAgentLoop：block→isError 进 context / rewrite 换参 / 工具抛错不崩循环 / maxTurns guardrail / 事件序列）
- `lib/deepseekModel/index.ts`（tool_call_id 配对 / compactionSummary 伪装 / SSE 坏 JSON）

单测 —— FakeModel 基建已现成（`summarize.test.ts`），复用成本低。

**依据**：pi（引擎测试思想）/ DSH test-support。

## 二、实际做了什么（验收）

✅ 完成（2026-09-01）：
- `lib/agent/index.test.ts` **11 用例** + `lib/deepseekModel/index.test.ts` **13 用例**
- FakeModel **提炼为共享** `lib/testing/fake-model.ts`（原来在 `summarize.test.ts` 里私有）
- 对照 pi `agent-loop.test.ts` 的**六个测试模式**
- **全套 31 文件 263 用例全绿** + `tsc` 绿

## 三、顺带修掉的坑

- **`vitest.config` 缺 `@/` alias** 的隐性坑 —— repos 测试第一批用别名全挂（修法是 `resolve.alias` 映射到仓库根）。

> 施工过程见 `doc/weekly-review/2026-W36/00-过程日志.md`（B16 / B18 同一条）。
