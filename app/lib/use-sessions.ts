"use client";

// ============================================================
// useSessions —— 会话列表 + 当前会话（Phase 2 多会话）
// ============================================================
//
// 页面用它拿 currentId，传给 useAgentRun({ sessionId })：
// 「切换会话」= 换 currentId，聊天区随之加载对应历史。
//
// 行为一览：
//   refresh()  拉会话列表（GET /api/sessions）
//   select(id) 切换当前会话（只改本地 state，数据加载由 useAgentRun 响应）
//   create()   新建空会话并切过去（POST /api/sessions）
//   rename()   重命名（PATCH /api/sessions）
//   remove()   删除会话；删的是当前会话时自动切到列表第一个（DELETE）
// ============================================================

import { useCallback, useEffect, useState } from "react";

export type SessionSummary = {
  id: string;
  title?: string;
  messageCount: number;
  /** 文件最后修改时间（毫秒） */
  updatedAt: number;
  preview?: string;
};

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [loading, setLoading] = useState(false);

  /** 拉列表；返回最新列表，供 create/remove 决定切到哪 */
  const refresh = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return [];
      const data = (await res.json()) as { sessions?: SessionSummary[] };
      const list = data.sessions ?? [];
      setSessions(list);
      return list;
    } catch {
      // 列表拉取失败不阻塞页面，下次操作会再刷新
      return [];
    }
  }, []);

  // 挂载：拉列表，默认选中第一个（最近活跃的）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh().then((list) => {
      if (!cancelled) {
        setLoading(false);
        setCurrentId((prev) => prev || list[0]?.id || "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const select = useCallback((id: string) => {
    setCurrentId(id);
  }, []);

  const create = useCallback(
    async (title?: string) => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(title ? { title } : {}),
        });
        if (!res.ok) return "";
        const data = (await res.json()) as { id: string };
        setCurrentId(data.id); // 新建即切换
        await refresh();
        return data.id;
      } catch {
        return "";
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      try {
        const res = await fetch("/api/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, title }),
        });
        if (!res.ok) return false;
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) return false;
        const list = await refresh();
        // 删的是当前会话 → 切到列表第一个（决策：不自动新建）
        setCurrentId((prev) => (prev === id ? (list[0]?.id ?? "") : prev));
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  return { sessions, currentId, loading, refresh, select, create, rename, remove };
}
