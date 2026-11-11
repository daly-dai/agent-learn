// ============================================================
// /api/sessions 接口的参数与返回类型
// 服务端 route 见 app/api/sessions/route.ts（GET 列表 / POST 新建 /
// PATCH 重命名 / DELETE 删除）
// ============================================================

/** 会话摘要（列表一项）：id 是身份，title 是给人看的名字。
 *  2026-09-01：messageCount 已删（左侧不展示条数，用户拍板"前后端都省事"） */
export type SessionSummary = {
  id: string;
  title?: string;
  /** 文件最后修改时间（毫秒） */
  updatedAt: number;
  preview?: string;
  /** 会话所属工作空间的 canonical 路径（会话头的 cwd）—— 侧栏分组就靠它。
   *  2026-11-11 新增：分组从"全局单工作区"改成"按工作空间分组"之后，它必须随列表返回。 */
  cwd: string;
};

/** GET /api/sessions → { sessions, sessionsRoot } */
export type SessionListResult = {
  sessions: SessionSummary[];
  /** 会话根（数据根下 sessions/），页脚展示用 */
  sessionsRoot: string;
};

/** POST /api/sessions 参数：**workspaceId 必填**（没有工作空间就没有落盘位置），
 *  title 可选，不传则显示回退用 id */
export type CreateSessionParams = { workspaceId: string; title?: string };

/** POST /api/sessions → 新建的会话 id */
export type CreateSessionResult = { id: string };

/** PATCH /api/sessions 参数 */
export type RenameSessionParams = { id: string; title: string };

/** PATCH / DELETE 成功返回（失败抛 ApiError） */
export type OkResult = { ok: true };
