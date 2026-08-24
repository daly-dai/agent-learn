// ============================================================
// userAnswers —— 模型提问的人工回答注册表（A4）
// ============================================================
//
// ask_user_question 工具执行时，route.ts 会推一个提问帧给前端并 await；
// 前端弹卡片，用户回答后调 POST /api/chat/ask-user 回传，这里负责把
// 「toolCallId → 用户回答」联系起来（与 toolApproval.ts 同模式，语义从
// 「允许/拒绝」换成「回答问题」）。
//
// 为什么挂 globalThis 而不是模块级变量：与 toolApproval 相同的理由——
// Next dev server 可能开多个 worker，SSE 请求（挂起提问）和 ask-user
// 请求（回传回答）若落在不同 worker，模块级 Map 就找不到了。
// ============================================================

export type PendingAsk = {
  /** 用户逐题回答时调用；返回给 await 中的 onAskUser（answers[]） */
  resolve: (answers: string[]) => void;
};

const g = globalThis as { __userAnswers?: Map<string, PendingAsk> };

export const userAnswers: Map<string, PendingAsk> =
  (g.__userAnswers ??= new Map());

/** 生成一个带 runId 前缀的 key（便于 run 结束时按 runId 清理挂起提问） */
export function makeAskKey(runId: string): string {
  return `ask:${runId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/** 清理某个 run 的全部挂起提问，并强制 resolve 成"（用户未回答）"。
 *  run 结束（正常完成/被 stop/SSE 断连）时调用，防止挂起的 onAskUser
 *  Promise 永远等不到、残留内存（用户关浏览器/切会话时触发）。 */
export function clearRun(runId: string): void {
  const prefix = `ask:${runId}:`;
  for (const [key, pending] of userAnswers) {
    if (key.startsWith(prefix)) {
      userAnswers.delete(key);
      pending.resolve(([] as unknown[]) as string[]); // 空数组 = 未回答
    }
  }
}
