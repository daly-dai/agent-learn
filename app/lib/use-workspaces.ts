"use client";

// ============================================================
// useWorkspaces —— 工作空间列表 + 增删改（C51）
// ============================================================
// 页面用它拿 `workspaces`，再和会话列表一起交给 `groupSessions` 分组。
// 全部请求走 app/services/workspaces，本文件不直接 fetch。
//
// 为什么 `create` 返回 workspace 而不只是布尔：新建完要立刻选中它
// （界面上"刚加的空间"应该马上出现并可用），而 list 的刷新是异步的。
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  createWorkspace,
  listWorkspaces,
  openWorkspaceFolder,
  removeWorkspace,
  renameWorkspace,
} from "@/app/services/workspaces";
import type { Workspace } from "@/app/services/workspaces/types";

export type { Workspace } from "@/app/services/workspaces/types";

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  /** 面向用户的一句话（建立/改名/删除/打开 失败时都能显示出来） */
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await listWorkspaces({ signal });
      setWorkspaces(data.workspaces ?? []);
      return data.workspaces ?? [];
    } catch (e) {
      if ((e as Error).name === "AbortError") return [];
      // 列表拉不到不阻塞页面（显式降级），下次操作会再刷新
      return [];
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进 loading 要等 fetch，只能由 effect 驱动；改成派生值要推翻整个 hook 状态模型（重构级改动）→ 见池子 C46
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  /** 登记一个文件夹；失败把服务端那句话原样交给界面（409 的文案是给人看的） */
  const create = useCallback(
    async (path: string): Promise<Workspace | null> => {
      setError(null);
      try {
        const data = await createWorkspace({ path });
        await refresh();
        return data.workspace;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      setError(null);
      try {
        await renameWorkspace({ id, title });
        await refresh();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    [refresh],
  );

  /** 删记录 + 连带删它名下的会话；返回删掉的会话数（null = 失败） */
  const remove = useCallback(
    async (id: string): Promise<number | null> => {
      setError(null);
      try {
        const data = await removeWorkspace(id);
        await refresh();
        return data.deletedSessions;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [refresh],
  );

  /** 在资源管理器里打开（失败信息同样交给界面） */
  const open = useCallback(async (id: string) => {
    setError(null);
    try {
      await openWorkspaceFolder(id);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  return { workspaces, error, setError, refresh, create, rename, remove, open };
}
