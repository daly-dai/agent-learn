// ============================================================
// /api/chat 系列接口的参数与返回类型
// 服务端 route 见 app/api/chat/route.ts（POST 发消息 / GET 历史 /
// DELETE 清空）、app/api/chat/approve/route.ts、app/api/chat/stop/route.ts
// ============================================================

import type { AgentMessage, SessionStats, TodoItem } from "@/lib/types";

/** GET /api/chat?sessionId= → 会话历史（叶子路径全部消息）+ 会话级统计 + 任务清单 */
export type ChatHistoryResult = {
  sessionId: string;
  leafId: string;
  messages: AgentMessage[];
  stats: SessionStats;
  /** 任务清单（Phase 5）：叶子回溯取最新 todo 条目；没有则为空数组 */
  todos: TodoItem[];
};

/** POST /api/chat/approve 参数：回传用户对挂起确认的决定（B1-④ 三档信任） */
export type ApproveParams = {
  toolCallId: string;
  allow: boolean;
  /** 本会话允许：该工具本会话内不再询问（内存记忆） */
  session?: boolean;
  /** 一直允许：该工具跨会话不再询问（持久化规则） */
  persist?: boolean;
  /** 写"本会话允许"记忆时按哪个会话记 */
  sessionId?: string;
};

/** POST /api/chat/approve → 成功返回 */
export type ApproveResult = { ok: true; allow: boolean };

/** 审批模式（B1-②）：suggest 默认（只读放行+弹框）/ bypass 全放 / never 全拒 */
export type ApprovalMode = "suggest" | "bypass" | "never";

/** GET /api/chat/approval-mode → 当前审批模式 */
export type ApprovalModeInfo = { mode: ApprovalMode };

/** POST /api/chat/approval-mode → 切换成功 */
export type ApprovalModeResult = { ok: true; mode: ApprovalMode };

/** POST /api/chat/stop 参数 */
export type StopRunParams = { runId: string };

/** POST /api/chat/stop → 成功返回 */
export type StopRunResult = { ok: true; runId: string };

/** DELETE /api/chat?sessionId= → 成功返回 */
export type ClearHistoryResult = { ok: true; sessionId: string };

/** POST /api/chat 参数（SSE 流式接口，返回形状特殊，见 index.ts） */
export type SendMessageParams = { text: string; sessionId: string };
