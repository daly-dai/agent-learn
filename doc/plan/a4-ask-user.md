# doc/plan/a4-ask-user —— A4 ask_user_question（施工补记）

> 来源：PLAN.md 第十三节 A4 行 + "A4 实现前补记"段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**（`9de50d5`），保留作施工历史。

**核心思想**：复用审批的"挂起等待 + 回传接口"模式（`toolApproval.ts` + approve 接口 + 前端弹框），但语义从「允许/拒绝（布尔）」换成「回答问题（字符串）」——ask_user_question 不是审批，是模型主动要信息。参考：DSH tool-ask-user（问题 + 结构化回答）。

- **工具**（`lib/tools/ask-user/index.ts` 新目录，一工具一目录）：`ask_user_question`，参数 `question: string`（必填）。execute 里 **`const answer = await options?.onAskUser?.(question)`**——旁路回调，工具不碰前端/route。返回 content 带用户回答 + details { question, answer }。**不进 `TOOLS_NEEDING_CONFIRM`**（本身就是交互，别再叠审批弹框）。
- **回调签名**（`lib/tools/types.ts`）：`ToolExecutorOptions` 加 `onAskUser?: (question: string) => Promise<string> | string`——和 onTodoWrite 同模式，但它是「请求-响应」（要等答案），onTodoWrite 是「单向通知」。
- **引擎只透传**（`lib/agent.ts`）：`RunAgentLoopOptions` 加 `onAskUser`，`executeToolCall` 原样递给工具（与 onTodoWrite 并列）。
- **挂起注册表**（`lib/userAnswers.ts` 新文件，仿 toolApproval.ts）：`globalThis.__userAnswers: Map<toolCallId, { resolve(answer), timer }>`——多 worker 场景同审批的解法。
- **route.ts 注入**：SSE 新帧 `{ type: "ask_user_request", toolCallId, question }`；`onAskUser` 实现 = 推帧 → 注册 pending → await（**60s 超时兜底**：resolve "（用户未在 60 秒内回答）"，run 不挂死）。新接口 `POST /api/chat/ask-user`（body `{ toolCallId, answer }`）回传答案。
- **前端**：`app/lib/sse.ts` 加帧类型；`use-agent-run.ts` 加 `pendingAsk` state + `answerAsk(answer)` + reset 清空；新组件 `app/components/ask-user-dialog/`（复用 approval-dialog 弹框形态 + 输入框 + 提交/取消）；page.tsx 挂载。
- **系统提示词**：加 ask_user_question 说明（需要用户提供信息/决策/澄清时才调用，问题要具体，别滥用）。
- **测试**（A2 框架）：`ask-user/index.test.ts`——mock onAskUser 返回答案 → 断言 content/details；question 空抛错；无 onAskUser 时返回"（未回答）"降级。
- **验收**：模型调 ask_user_question → 前端弹框 → 用户输入回答 → 答案回模型 → 模型基于答案继续；60s 不答返回超时文案；`pnpm test` 全绿。
