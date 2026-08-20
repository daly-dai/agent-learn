// ============================================================
// /api/sessions 接口定义（会话本身：列表 / 新建 / 重命名 / 删除）
// ============================================================
// hooks 只调这些语义化函数，不直接碰 fetch / method / URL——
// method（GET/POST/PATCH/DELETE）在这里消化，调用方见不到。
// 参数/返回类型在 ./types.ts，与服务端 route 一一对应。
//
// 依赖 plugins/http（通用 fetch 封装）；本层是业务接口清单。
// 注意：本目录是客户端调用层，勿与 app/api/（Next.js 约定的
// 服务端路由位置）混淆——命名差异是刻意的。
// ============================================================

import { api } from "@/plugins/http";
import type {
  SessionListResult,
  CreateSessionParams,
  CreateSessionResult,
  RenameSessionParams,
  OkResult,
} from "./types";

/** GET /api/sessions —— 会话列表 */
export function listSessions(opts?: {
  signal?: AbortSignal;
}): Promise<SessionListResult> {
  return api("/api/sessions", { signal: opts?.signal });
}

/** POST /api/sessions —— 新建空会话（title 可选，不传则显示回退用 id） */
export function createSession(
  params: CreateSessionParams,
): Promise<CreateSessionResult> {
  return api("/api/sessions", { method: "POST", body: params });
}

/** PATCH /api/sessions —— 重命名（只改头里的 title） */
export function renameSession(params: RenameSessionParams): Promise<OkResult> {
  return api("/api/sessions", { method: "PATCH", body: params });
}

/** DELETE /api/sessions?id= —— 删除整个会话 */
export function removeSession(id: string): Promise<OkResult> {
  return api(`/api/sessions?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
