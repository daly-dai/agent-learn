// ============================================================
// 会话分组（C49）—— 纯函数，node 可测
// ============================================================
// 输入：会话列表（每条带 cwd）+ 工作空间记录表。
// 输出：按工作空间分好的组。**不做任何请求、不持有状态** —— 所以它是
// `app/lib/` 里的纯函数，而不是 hook（第 11.9 条的分界）。
//
// 归属判据：会话头里的 `cwd` 与记录的 `path` 相等（注册表不存会话，
// 也不另存 workspaceId —— 少一个会漂的字段）。
//
// ⚠️ 注册表里**没有被任何会话引用的工作空间也要出现**（空组）：用户刚建的
// 空工作空间必须看得见，否则"先建空间、再开会话"这条路上第一个人会以为没建成。

import type { Workspace } from "@/lib/workspace";

/** 每组默认先渲染几条（详案 4.4 规则 7） */
export const INITIAL_VISIBLE_SESSIONS = 5;

/** 分组只依赖这三个字段：传进来的对象原样保留（title / preview 都跟着走） */
export type GroupableSession = {
  id: string;
  updatedAt: number;
  cwd: string;
};

export type SessionGroup<T extends GroupableSession> = {
  /** 工作空间的 canonical 路径 */
  key: string;
  title: string;
  /** 每个组都对应一条真实记录（不再有"未登记"这种没有记录的分组） */
  workspaceId: string;
  sessions: T[];
};

/**
 * 按工作空间分组。
 * 组顺序 = 工作空间记录的 `updatedAt` 倒序（最近动过的排前面）；
 * 组内按会话 `updatedAt` 倒序。
 */
export function groupSessions<T extends GroupableSession>(
  sessions: T[],
  workspaces: Workspace[],
): SessionGroup<T>[] {
  const byPath = new Map(
    workspaces.map((workspace) => [workspace.path, workspace]),
  );
  const buckets = new Map<string, T[]>();

  for (const session of sessions) {
    // 匹配不到记录的会话**丢弃**（见文件头：bootstrap 保证这种状态不该存在）
    const workspace = byPath.get(session.cwd);
    if (workspace === undefined) continue;
    const bucket = buckets.get(workspace.path) ?? [];
    bucket.push(session);
    buckets.set(workspace.path, bucket);
  }

  return [...workspaces]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((workspace) => ({
      key: workspace.path,
      title: workspace.title,
      workspaceId: workspace.id,
      sessions: sortByUpdatedDesc(buckets.get(workspace.path) ?? []),
    }));
}

/**
 * 折叠：一组只先展示前 `limit` 条，剩下的折成「展开其余 N 个」。
 * 展开态由界面持有（纯界面态，不落盘），这里只负责算。
 */
export function foldGroup<T>(
  sessions: T[],
  expanded: boolean,
  limit: number = INITIAL_VISIBLE_SESSIONS,
): { visible: T[]; hiddenCount: number } {
  if (expanded || sessions.length <= limit) {
    return { visible: sessions, hiddenCount: 0 };
  }
  return {
    visible: sessions.slice(0, limit),
    hiddenCount: sessions.length - limit,
  };
}

function sortByUpdatedDesc<T extends GroupableSession>(sessions: T[]): T[] {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
}
