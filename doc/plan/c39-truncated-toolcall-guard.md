# C39 · 流式 tool_call 的截断保护

> **这是「攒材料」阶段的需求文件**（`AGENTS.md` 第 10 条 ②）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 C39 行（2026-09-18 搬入）—— **下面全是原文照搬，未加工、未发明方案**。
> ⚠️ **「详细设计」与「验收」现在是空的 —— 没定案就不许开工。**

## 一、需求（池子行原文）

**流式 tool_call 的截断保护**（2026-09-18 从退役的 `会话检查点.md` 收编）：模型输出被截断时（`stopReason="length"`），流式累积的 arguments 是**残缺 JSON**，可能被 parse 成不完整对象**拿去执行**。pi 有 `failToolCallsFromTruncatedMessage`，我们没有（`todo` 只靠 `validateTodos` 兜底）。⚠️ **它原先躺在检查点的「关键决策（别再翻案）」一节里 —— 缺口被当成决策封存，所以永远排不上期**

## 二、依据（跟谁学 / 触发条件）

pi 引擎的 `failToolCallsFromTruncatedMessage`；我们 `lib/deepseekModel/`（流式累积 + 一次 parse）

## 三、详细设计

> ⛔ **未定案。** 补齐本节 +「验收」才能进迭代（`PLAN.md` 的开工门禁）。

## 四、验收（怎么算做完）

> ⛔ **未定案。**
