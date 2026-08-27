"use client";

// ============================================================
// 会话列表 —— 左侧栏（Phase 2 多会话）
// ============================================================
// 纯展示 + 交互壳：列表数据与操作（select/create/rename/remove）
// 由页面从 useSessions 传入，本组件不自己发请求。
//
// 2026-08-28 重构：单行渲染拆到 SessionRow（同行目录）——
// 本组件只回答"列表长什么样"（容器 + 行内状态的持有者），
// "一行有几种形态"（正常/重命名/删除确认/⋯菜单）归 SessionRow。
// 行内状态（editingId/draft/pendingDelete）保持单值提在这里：
// 这是有意的互斥设计——同一时刻只有一行在编辑或删除。
// ============================================================

import { useState } from "react";
import type { SessionSummary } from "../../lib/use-sessions";
import { SessionRow } from "./session-row";
import styles from "./session-list.module.css";

type SessionListProps = {
  sessions: SessionSummary[];
  currentId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

export function SessionList({
  sessions,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SessionListProps) {
  // 行内重命名的编辑态：editingId 是正在编辑的会话，draft 是输入框草稿
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 待删除的会话：非 null 时该行替换成行内确认条（就地确认，不弹框）
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(
    null,
  );

  function startRename(session: SessionSummary) {
    // 草稿只回填已有标题；没标题就让用户从空输入开始（不预填文件 id）
    setEditingId(session.id);
    setDraft(session.title ?? "");
  }

  function cancelRename() {
    setEditingId(null);
    setDraft("");
  }

  function commitRename() {
    if (editingId && draft.trim()) {
      onRename(editingId, draft.trim());
    }
    cancelRename();
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHead}>
        <span className={styles.sidebarTitle}>会话</span>
        <span className={styles.sidebarCount}>{sessions.length}</span>
        <button
          className={styles.sidebarNew}
          type="button"
          onClick={onCreate}
        >
          ＋ 新建
        </button>
      </div>

      <div className={styles.sessionList}>
        {sessions.length === 0 ? (
          <p className={styles.sessionEmpty}>还没有会话，点「新建」开始。</p>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              current={session.id === currentId}
              editing={session.id === editingId}
              confirmingDelete={pendingDelete?.id === session.id}
              draft={draft}
              onSelect={() => onSelect(session.id)}
              onStartRename={() => startRename(session)}
              onRenameDraft={setDraft}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onRequestDelete={() => setPendingDelete(session)}
              onConfirmDelete={() => {
                onDelete(session.id);
                setPendingDelete(null);
              }}
              onCancelDelete={() => setPendingDelete(null)}
            />
          ))
        )}
      </div>

      <div className={styles.sidebarFoot}>
        <p>点击切换会话 · 悬停 ⋯ 重命名 / 删除</p>
      </div>
    </aside>
  );
}
