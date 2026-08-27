// ============================================================
// _pipeline/ask-user.ts —— 模型提问挂起（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 与 askUserApproval 同模式，但语义是「回答问题列表」不是「允许/拒绝」：
// 推 ask_user_request 帧（附 questions）给前端逐题作答 → 用户答完走
// POST /api/chat/ask-user 回传 answers[] → resolve 交回 await 中的 onAskUser
// → 工具结果回模型继续。
// 【用户要求 2026-08-24】不设超时——模型无限等用户，用户想跳过就点「跳过」
// （回传空数组 → 工具返回 SKIPPED_TEXT），不会被强制打断。
// 但 run 结束（正常/被 stop/断连）时由 finally 里的 clearRun 清掉挂起，
// 防止 Promise 残留（关浏览器/切会话的兜底）。
// ============================================================

import type { AskQuestion } from "@/lib/tools/ask-user";
import { userAnswers, makeAskKey } from "@/lib/userAnswers";
import type { StreamFrame } from "./frames";

export function askUserAnswer(
  questions: AskQuestion[],
  runId: string,
  send: (frame: StreamFrame) => void,
): Promise<string[]> {
  return new Promise((resolve) => {
    // key 带 runId 前缀，run 结束时 clearRun(runId) 能按前缀精确清理
    const key = makeAskKey(runId);

    send({ type: "ask_user_request", toolCallId: key, questions });

    userAnswers.set(key, {
      resolve: (answers: string[]) => {
        userAnswers.delete(key);
        resolve(answers);
      },
    });
  });
}
