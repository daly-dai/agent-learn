"use client";

// ============================================================
// useAgentRun —— 当前会话 run 状态的「投影层」（B22 变薄版）
// ============================================================
//
// B22 前：本文件是 run 状态的唯一持有者（366 行 useState 集合 +
// send/applyFrame/历史恢复全在这）。B22 后：状态归会话（run-store.ts
// 的桶），本文件只剩两件事——
//   1. 投影：从 store 订阅「当前会话」的桶（sessionId 变 = 换桶）
//   2. 转发：send/stop/approve/… 薄转发到 store 的对应动作
//
// 为什么保留这个薄层（不直接让 page.tsx 用 store）：
//   对外签名完全不变 → page.tsx 解构区/组件接线零改动，先验证
//   单会话行为与 B22 前一致（投影迁移的回归最小化）。
//   store 动作要 sessionId 参数，页面已经手握 currentId，但把
//   「currentId 喂给哪个会话的动作」收口在这里，页面不用关心
//   sessionId 到底传给了谁。
//
// 历史恢复（原 useEffect 拉 GET /api/chat）也移到 store 的
// hydrate/hydrateIfMissing：切到冷会话（无桶）才拉；切回在跑的
// 会话不重拉，直接投影实时流接上（B22 验收场景 5/6）。
// ============================================================

import { useCallback, useEffect } from "react";
import {
  useRunStore,
  useSessionRun,
} from "./run-store";
import type { RunState } from "./run-fold";

// 类型 re-export：approval-dialog / ask-user-card 从这里 import，
// 定义已随状态迁移到 run-fold.ts（桶字段类型），这里只保持引用路径不变
export type { ToolApprovalRequest, PendingAsk } from "./run-fold";

export function useAgentRun(sessionId: string) {
  // 投影当前会话的桶。冷会话（没桶）→ EMPTY_RUN 兜底（页面显示空态），
  // hydrate 完成后自动换成真桶（store 更新 → 本 selector 重新求值）
  const run: RunState = useSessionRun(sessionId);

  // store 动作（薄转发，闭包捕获 sessionId——永远作用于当前会话的桶）
  const send = useCallback(
    (text: string) => useRunStore.getState().startRun(sessionId, text),
    [sessionId],
  );
  const stop = useCallback(
    (runId: string) => useRunStore.getState().stopRun(sessionId, runId),
    [sessionId],
  );
  const runCommand = useCallback(
    (line: string) => useRunStore.getState().runCommand(sessionId, line),
    [sessionId],
  );
  const approve = useCallback(
    (decision: { allow: boolean; session?: boolean; persist?: boolean }) =>
      useRunStore.getState().approve(sessionId, decision),
    [sessionId],
  );
  const answerAsk = useCallback(
    (answers: string[]) =>
      useRunStore.getState().answerAsk(sessionId, answers),
    [sessionId],
  );
  const setError = useCallback(
    (message: string) => useRunStore.getState().setError(sessionId, message),
    [sessionId],
  );

  // 切到冷会话（无桶）→ hydrate 拉历史落桶；有桶（在跑/跑完/已 hydrate）
  // → 跳过。sessionId 变化本身不改本地状态——换桶即换投影（原 resetLocal
  // 的清空由「桶 = EMPTY_RUN」兜底覆盖，不再需要手动清）
  useEffect(() => {
    void useRunStore.getState().hydrateIfMissing(sessionId);
  }, [sessionId]);

  return {
    messages: run.messages,
    observed: run.observed,
    loading: run.loading,
    error: run.error,
    setError,
    runId: run.runId,
    model: run.model,
    send,
    runCommand,
    commandFeedback: run.commandFeedback,
    commandRunning: run.commandRunning,
    contextPressure: run.contextPressure,
    stats: run.stats,
    pendingApproval: run.pendingApproval,
    approve,
    pendingAsk: run.pendingAsk,
    answerAsk,
    toolOutputs: run.toolOutputs,
    todos: run.todos,
    stop,
    compacting: run.compacting,
  };
}
