# B18 · 测试质量细节

> **这是已完成项的「竣工记录」**（`AGENTS.md` 第 10 条：材料住 `doc/plan/<名>.md`）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 B18 行（2026-09-18 搬入；原行的实质内容只写在池子里，没有家 ⇒ 建本文件）

## 一、要做什么（原文）

**测试质量细节**（体检报告行动④⑤⑦）：
1. 消灭弱断言（`grep` truncated 未断言 / `store.test` 条件断言 / `config.test` 恒真）
2. 补 store 树语义测试（switchLeaf / appendTodo / getLatestTodos / stats）
3. `approval-memory` 显式 reset 接口 + `approval-log.test` 补真实清理 + `store.test` describe 改名 `prepareCompaction`

**依据**：体检报告 2.2 节。

## 二、实际做了什么（验收）

✅ 完成（2026-09-01，**随 B16 一起做**）：
- `grep` 补 truncated 断言 + 去条件断言
- `store` 8 处早退改 **fail-loud** + describe 改名 + 新增**树语义 6 用例**
- `config` 删恒真 `it`
- `approval-memory` 加 **`resetSessionApprovals()`**（测试不再黑进 `globalThis` 内部）
- `approval-log` 补 `afterAll` 真实清理
- **全套 31 文件 263 用例全绿**

> 施工过程见 `doc/weekly-review/2026-W36/00-过程日志.md`（与 B16 同一条）。
