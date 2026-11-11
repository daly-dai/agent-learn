// ============================================================
// /api/workspaces 接口定义（工作空间：登记 / 改名 / 删除 / 打开 / 浏览）
// ============================================================
// 与 /api/sessions 同构：hooks 只调这些语义化函数，method / URL 在这里消化。
// 参数与返回类型在 ./types.ts，与服务端 route 一一对应。
// ============================================================

import { api } from "@/plugins/http";
import type {
  CreateWorkspaceParams,
  CreateWorkspaceResult,
  DeleteWorkspaceResult,
  DirectoryListing,
  OkResult,
  RenameWorkspaceParams,
  RenameWorkspaceResult,
  WorkspaceListResult,
} from "./types";

/** GET /api/workspaces —— 全部记录（服务端顺手补登记） */
export function listWorkspaces(opts?: {
  signal?: AbortSignal;
}): Promise<WorkspaceListResult> {
  return api("/api/workspaces", { signal: opts?.signal });
}

/** POST /api/workspaces —— 把一个文件夹登记为工作空间（重复登记 → 409） */
export function createWorkspace(
  params: CreateWorkspaceParams,
): Promise<CreateWorkspaceResult> {
  return api("/api/workspaces", { method: "POST", body: params });
}

/** PATCH /api/workspaces —— 只改显示名，不动磁盘上的文件夹 */
export function renameWorkspace(
  params: RenameWorkspaceParams,
): Promise<RenameWorkspaceResult> {
  return api("/api/workspaces", { method: "PATCH", body: params });
}

/** DELETE /api/workspaces?id= —— 删记录**并连带删它名下的会话** */
export function removeWorkspace(id: string): Promise<DeleteWorkspaceResult> {
  return api(`/api/workspaces?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** POST /api/workspaces/open —— 在资源管理器里打开（仅 Windows） */
export function openWorkspaceFolder(id: string): Promise<OkResult> {
  return api("/api/workspaces/open", { method: "POST", body: { id } });
}

/** GET /api/workspaces/browse?path= —— 列一层目录（不带 path = 家目录） */
export function browseDirectory(
  path?: string,
  opts?: { signal?: AbortSignal },
): Promise<DirectoryListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return api(`/api/workspaces/browse${query}`, { signal: opts?.signal });
}
