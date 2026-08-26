# doc/plan/phase-1 —— Phase 1 单个会话 + 记忆（施工补记）

> 来源：PLAN.md 第六章 Phase 1 段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**，保留作施工历史。

## 目标

- 移植教学版的 `JsonlSessionStore`（`how-pi-agent-works/examples/teaching-agent/src/server/agent/sessionStore.ts`）。
- 核心：JSONL 追加写 + `id`/`parentId`/`leafId` 会话树 + `buildContext()`（从 leaf 回溯）+ `compactIfNeeded()`（超窗口时用摘要替代旧消息）。
- 改 `route.ts`：不再每次新建 `[userMessage]`，而是 `appendMessage(user) → buildContext() → runAgentLoop → appendMessage(assistant/toolResult)`。
- 把"事件轨迹"与"会话消息轨迹"统一，实现离线回放（L2 完整）。

## 实现前补记（AGENTS.md：先想清楚再动手）

- 会话文件：`.sessions/<sessionId>.jsonl`，与 `.traces/` 平级、进 gitignore。为什么放 `.sessions/` 而不是 workspace/sessions：workspace 是 agent 的工作区（工具可读写），会话数据是运行时状态，不该被 agent 工具碰到。
- sessionId：Phase 1 固定 `"default"`；POST body 预留可选 `sessionId` 字段（不传则用 default）——为 Phase 2 多会话留接口，前端零改动。
- store 生命周期：每次 POST 新建 store 实例（loadOrCreate 从磁盘读全量）。多进程安全、内存态与磁盘一致；会话文件小，读全量可接受。
- 引用安全：`buildContext()` 返回新数组 + `runAgentLoop` 内部再复制，不污染 store 内存态；run 结束把 `result.newMessages`（assistant + toolResults）逐条 `appendMessage` 落盘。
- `compactIfNeeded` 触发：每次 run 结束后调用；初值 `maxApproxTokens=4000`、`keepRecentMessages=8`（教学版测试里的 20/2 是逻辑验证值，不是生产值）。
- 历史展示（经用户授权，本会话接管 UI 线这部分）：done frame 改为带**全量会话历史**（`store.buildContext()`）；新增 `GET /api/chat?sessionId=` 返回历史（前端挂载时恢复、刷新不丢）、`DELETE /api/chat?sessionId=` 清空会话（配合前端「清空记录」）；前端发送时不再清空消息。
- 测试：本阶段不引入测试框架（原计划 Phase 6 再补），教学版 `sessionStore.test.ts` 留作参考。

## Phase 1 后续优化（暂缓，等主线跑稳再回来）——「真摘要」压缩

当前 `compactIfNeeded` 的摘要只是原文拼贴（`role: 文本` 连起来），token 几乎不省，是教学简化。真实产品（pi）会**调用 LLM 生成结构化摘要**（`pi/packages/agent/src/harness/compaction/compaction.ts` 的 `generateSummary`）：专用系统提示词 + 一次性 complete 请求，产出 `## Goal / ## Progress / ## Key Decisions / ## Next Steps / ## Critical Context` 结构，把几千 token 压成几百。升级方案：复用 `TeachingModel` 接口（摘要 = 调模型 complete 一次），照抄 pi 的结构化提示词；注意 `MOCK_MODE` 下无 key 的降级策略（可回退到现在的拼贴式）。对照细节见 `workspace/实现走读-pi对照.md`。

> **已升级**（2026-08-26）：B2 ③ LLM 结构化摘要已完成，施工单见 `doc/plan/b2-compaction.md`，方案对照见 `doc/02-B2-LLM结构化摘要-改造方案.md`。
