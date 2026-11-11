// ============================================================
// /api/workspaces 接口的参数与返回类型（与服务端 route 一一对应）
// ============================================================

/** 一条工作空间记录（服务端 lib/workspace 的 Workspace 原样） */
export type Workspace = {
  id: string;
  /** canonical 绝对路径 —— 会话头里的 cwd 与它比对，所以两边必须同源 */
  path: string;
  /** 显示名（默认 = 文件夹末段；可重命名，重名允许） */
  title: string;
  createdAt: string;
  updatedAt: string;
};

/** GET /api/workspaces → { workspaces }（updatedAt 倒序） */
export type WorkspaceListResult = { workspaces: Workspace[] };

/** POST /api/workspaces 参数：path 必填，title 不填则取文件夹末段 */
export type CreateWorkspaceParams = { path: string; title?: string };

/** POST /api/workspaces → { workspace } */
export type CreateWorkspaceResult = { workspace: Workspace };

/** PATCH /api/workspaces 参数：只改显示名 */
export type RenameWorkspaceParams = { id: string; title: string };

/** PATCH /api/workspaces → { workspace } */
export type RenameWorkspaceResult = { workspace: Workspace };

/** DELETE /api/workspaces?id= → { ok, deletedSessions } */
export type DeleteWorkspaceResult = { ok: true; deletedSessions: number };

/** POST /api/workspaces/open → { ok } */
export type OkResult = { ok: true };

// ---- 目录浏览（GET /api/workspaces/browse）----

export type DirectoryEntry = {
  name: string;
  /** 绝对路径：直接拿它请求下一层 */
  path: string;
  /** 点前缀。是否显示由界面上的「显示隐藏项」决定 */
  hidden: boolean;
};

export type Crumb = { name: string; path: string };

export type DirectoryListing = {
  path: string;
  home: string;
  parent: string | null;
  crumbs: Crumb[];
  entries: DirectoryEntry[];
  /** 超过 1000 项时为 true（界面要说一声，不能悄悄少给） */
  truncated: boolean;
  /** 真实存在的盘符（Windows 上从家目录点不到别的盘） */
  drives: string[];
};
