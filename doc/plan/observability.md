# doc/plan/observability —— 可观测性与轨迹（Trace）

> 来源：PLAN.md 第四章（2026-08-26 PLAN 拆解时移入 doc/plan/）。**横切地基**——不是某个阶段的功能，而是贯穿全程的设计；L2 已实现（`lib/trace.ts`），L3 Trace Viewer 排队（A3）。

## 为什么把"轨迹"当作一等公民

这个项目的核心会越来越依赖 AI 生成，失控是迟早的。失控时的第一反应不应该是"猜"，而是"读轨迹"。所以可观测性不是某个阶段的功能，而是贯穿全程的横切地基——**Event Timeline 是实时仪表盘，轨迹（Trace）是黑匣子**。

能不能"追责"到具体一步，取决于三件事：

1. 每个事件有**稳定序号 `seq`** 和**归属 `runId`**，顺序和归属不会被多会话、并发、重试搞乱。
2. 每个关键步骤有**快照 snapshot**（上下文 token、leafId、模型名、工具 I/O、错误堆栈）。
3. 轨迹**持久化且可回放**——离线也能重绘出同样的时间线，把"哪一步开始错"钉死。

## 三层视图（对应三个成熟度）

| 层 | 名字 | 时机 | 内容 | 现状 |
| --- | --- | --- | --- | --- |
| L1 | 实时事件流（Event Timeline） | run 进行中 | 边跑边推的 `AgentEvent` | ✅ 已有 |
| L2 | 持久轨迹（Trace / 黑匣子） | 每次 run 落盘 | `事件 + 快照`，JSONL 追加 | ✅ 已有（`lib/trace.ts`） |
| L3 | 可视化回放（Trace Viewer） | 事后调试/展示 | 按 turn 分泳道、工具调用↔结果配对、token 用量、step 前进 | ⏳ A3 排队 |

关键设计：**不动 `types.ts` 里现有的 `AgentEvent`**。轨迹是"事件 + 快照"的一层包装，引擎和前端不用大改，轨迹作为横切层叠加在现有五层之上。这符合"内核稳定、能力外挂"。

## TraceEntry 数据模型（示意）

```ts
// 轨迹条目：包装 AgentEvent，额外带定位和快照信息
type TraceEntry = {
  seq: number;         // 全局递增，决定顺序
  runId: string;       // 本次 run 唯一 id（多会话/并发/重试不串）
  ts: number;          // 墙钟时间
  turn?: number;       // 属于第几轮
  event?: AgentEvent;  // 原有事件（复用 types.ts，不改）
  snapshot?: {         // 每步快照，用于回放/诊断
    contextTokens?: number;
    leafId?: string;
    model?: string;
    toolInput?: unknown;   // 工具入参快照
    toolOutput?: unknown;  // 工具输出快照
    errorStack?: string;
  };
};
```

## 轨迹要回答的调试问题

| 调试问题 | 轨迹里的答案 |
| --- | --- |
| 模型为什么调了这个工具？ | 该 turn 的 assistant 消息 + 工具入参快照 |
| 工具结果为什么是错的？ | 工具 I/O 快照 + 错误堆栈 |
| 上下文为什么爆了？ | 每步 `contextTokens` 快照 + 压缩事件 |
| 哪一步开始偏离预期？ | `seq` 定位 + 回放到该步 |
| 这次和上次有什么不同？ | 两个 `runId` 的轨迹 diff |

## 轨迹落在路线图的哪里

- **Phase 0**：给事件流补 `seq`/`runId`/`ts`，先落盘成最简 JSONL 轨迹（L2 打地基）。✅ 已做
- **Phase 1**：session store 本身就是轨迹的一部分（`id`/`parentId`/`leafId`），此时把"消息轨迹"和"事件轨迹"统一，实现回放。✅ 已做
- **Phase 6**：做 L3 Trace Viewer（参考 pi 的 `export-html`），把轨迹渲染成可读的调试视图。⏳ A3

参考源码：

- pi 事件/遥测：`pi/packages/agent/src/harness/events.ts`、`telemetry.ts`
- pi 会话 JSONL：`pi/packages/agent/src/harness/session/jsonl/{codec,storage,repo}.ts`
- pi 可视化导出：`pi/packages/coding-agent/src/core/export-html/{index,ansi-to-html,tool-renderer}.ts`

## "失控防线"（针对 AI 开发核心会漂移）

| 防线 | 做法 |
| --- | --- |
| 协议即真相 | `types.ts` 是唯一事实源；改协议先改这里并全量 typecheck |
| 轨迹即黑匣子 | 出问题先读轨迹，不靠猜；能回放到"哪一步开始错" |
| 阶段提交 + 测试 | 每个 phase 一次 `git commit`；loop/sessionStore/tools 补单测 |
| 小内核 + 清晰边界 | 内核尽量不改，新能力加在适配层/产品层 |
| 每次 run 独立 runId | 多会话、并发、重试都不串轨迹 |
