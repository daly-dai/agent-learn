// ============================================================
// /api/repos 接口定义（仓库更新面板 C15）
// ============================================================
// 与 /api/sessions 同构：客户端 hooks 只调这里的语义化函数，
// method/URL 在这里消化。类型在 ./types.ts，与服务端 route 一一对应。
// ============================================================

import { api } from "@/plugins/http";
import type { RepoListResult, UpdateResult, UpdateLogListResult, UpdateLogContentResult } from "./types";

/** GET /api/repos —— 仓库列表 + 状态（不带 check：瞬时，页面秒开） */
export function listRepos(opts?: { signal?: AbortSignal }): Promise<RepoListResult> {
  return api("/api/repos", { signal: opts?.signal });
}

/** GET /api/repos?check=1 —— 附实时更新检查（ls-remote，5s 超时兜底）。
 *  页面加载后单独调，tag 渐进出现，不阻塞首次渲染 */
export function checkRepos(opts?: { signal?: AbortSignal }): Promise<RepoListResult> {
  return api("/api/repos?check=1", { signal: opts?.signal });
}

/** POST /api/repos —— 更新单个仓库（body: { name }；GET/POST 共用 route.ts） */
export function updateRepo(name: string): Promise<UpdateResult> {
  return api("/api/repos", { method: "POST", body: { name } });
}

/** GET /api/repos/logs —— 全部更新日志列表（倒序） */
export function listUpdateLogs(opts?: { signal?: AbortSignal }): Promise<UpdateLogListResult> {
  return api("/api/repos/logs", { signal: opts?.signal });
}

/** GET /api/repos/logs?name= —— 该项目最新一条日志全文（markdown） */
export function readUpdateLog(name: string, opts?: { signal?: AbortSignal }): Promise<UpdateLogContentResult> {
  return api(`/api/repos/logs?name=${encodeURIComponent(name)}`, { signal: opts?.signal });
}
