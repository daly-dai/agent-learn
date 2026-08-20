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
//
// 请求全部走 app/services 接口层，本文件不再直接 fetch：
//   listSessions / createSession / renameSession / removeSession
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  listSessions,
  createSession,
  renameSession,
  removeSession,
} from "@/app/services/sessions";

// 类型定义搬到 app/services/sessions/types.ts；
// 这里 re-export 保持组件 import（session-list.tsx）不变
export type { SessionSummary } from "@/app/services/sessions/types";
import type { SessionSummary } from "@/app/services/sessions/types";

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [loading, setLoading] = useState(false);

  /** 拉列表；返回最新列表，供 create/remove 决定切到哪 */
  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<SessionSummary[]> => {
      try {
        const data = await listSessions({ signal });
        const list = data.sessions ?? [];
        setSessions(list);
        return list;
      } catch (e) {
        if ((e as Error).name === "AbortError") return []; // 组件卸载导致的取消
        // 其他失败：列表拉取失败不阻塞页面，下次操作会再刷新（显式降级）
        return [];
      }
    },
    [],
  );

  // 挂载：拉列表，默认选中第一个（最近活跃的）
  // AbortController：卸载时 abort() 取消请求，替代手写 cancelled 标志
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    refresh(controller.signal).then((list) => {
      if (controller.signal.aborted) return; // 已卸载，不再 setState
      setLoading(false);
      setCurrentId((prev) => prev || list[0]?.id || "");
    });
    return () => controller.abort();
  }, [refresh]);

  const select = useCallback((id: string) => {
    setCurrentId(id);
  }, []);

  const create = useCallback(
    async (title?: string) => {
      try {
        const data = await createSession(title ? { title } : {});
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
        await renameSession({ id, title });
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
        await removeSession(id);
        const list = await refresh();
        // 删的是当前会话 → 切到列表第一个（决策：不自动新建）
        setCurrentId((prev) => {
          if (prev !== id) return prev;
          return list[0]?.id ?? "";
        });
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  return { sessions, currentId, loading, refresh, select, create, rename, remove };
}
