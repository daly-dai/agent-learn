// ============================================================
// /api/chat 系列接口定义（对话：发消息 / 历史 / 清空 / 审批 / 停止）
// ============================================================
// 与 app/services/sessions 对应服务端 /api/sessions；这里对应 /api/chat
// 及其子路由 /api/chat/approve、/api/chat/stop。
//
// 唯一特殊：sendMessage 是 SSE 流式接口，要原始 res.body 交给
// readStream，不走 api<T>（JSON 封装）——但定义依然收口在这里。
//
// 依赖 plugins/http（通用 fetch 封装）；本层是业务接口清单。
// 注意：本目录是客户端调用层，勿与 app/api/（Next.js 约定的
// 服务端路由位置）混淆——命名差异是刻意的。
// ============================================================

import { api } from "@/plugins/http";
import type {
  ChatHistoryResult,
  ApproveParams,
  ApproveResult,
  StopRunParams,
  StopRunResult,
  ClearHistoryResult,
  SendMessageParams,
} from "./types";

/** GET /api/chat?sessionId= —— 会话历史 + 会话级统计（挂载/切换时恢复） */
export function fetchHistory(
  sessionId: string,
  opts?: { signal?: AbortSignal },
): Promise<ChatHistoryResult> {
  return api(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`, {
    signal: opts?.signal,
  });
}

/** DELETE /api/chat?sessionId= —— 清空当前会话消息（「清空记录」按钮） */
export function clearHistory(sessionId: string): Promise<ClearHistoryResult> {
  return api(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

/** POST /api/chat/approve —— 回传工具确认的用户决定 */
export function approveTool(params: ApproveParams): Promise<ApproveResult> {
  return api("/api/chat/approve", { method: "POST", body: params });
}

/** POST /api/chat/stop —— 停止一次 run（中止模型请求 + 杀命令进程树） */
export function stopRun(params: StopRunParams): Promise<StopRunResult> {
  return api("/api/chat/stop", { method: "POST", body: params });
}

/** POST /api/chat —— 发消息（SSE 流式）。不走 api<T>：需要 res.body 交给 readStream */
export function sendMessage(params: SendMessageParams): Promise<Response> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}
