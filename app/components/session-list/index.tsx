"use client";

// ============================================================
// 会话列表 —— 左侧栏（Phase 2 多会话）
// ============================================================
// 纯展示 + 交互壳：列表数据与操作（select/create/rename/remove）
// 由页面从 useSessions 传入，本组件不自己发请求。
//
// 交互约定：
//   点击行      → 切换会话
//   ＋新建      → 新建空会话并切过去
//   ✎（悬停）  → 行内重命名：Enter 保存 / Esc 或失焦取消
//                 （失焦不保存，避免和 Enter 触发两次提交）
//   ×（悬停）  → 删除（confirm 确认）
// ============================================================

import { useState } from "react";
import type { SessionSummary } from "../../lib/use-sessions";
import { formatClock } from "../../lib/format";
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

  function startRename(session: SessionSummary) {
    setEditingId(session.id);
    setDraft(session.title ?? session.id);
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
          sessions.map((session) => {
            const current = session.id === currentId;
            const editing = session.id === editingId;

            return (
              <div
                key={session.id}
                className={`${styles.sessionItem}${
                  current ? " is-current" : ""
                }`}
                onClick={() => !editing && onSelect(session.id)}
              >
                {editing ? (
                  <input
                    className={styles.sessionRenameInput}
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={cancelRename}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className={styles.sessionTitle}>
                      {session.title ?? session.id}
                    </div>
                    {session.preview && (
                      <div className={styles.sessionPreview}>
                        {session.preview}
                      </div>
                    )}
                    <div className={styles.sessionMeta}>
                      <span>{session.messageCount} 条</span>
                      <span>{formatClock(session.updatedAt)}</span>
                    </div>
                  </>
                )}

                {!editing && (
                  <div className={styles.sessionActions}>
                    <button
                      className={styles.sessionAction}
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(session);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className={styles.sessionAction}
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `删除会话「${session.title ?? session.id}」？`,
                          )
                        ) {
                          onDelete(session.id);
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={styles.sidebarFoot}>
        <p>点击切换会话 · ✎ 重命名 · × 删除</p>
      </div>
    </aside>
  );
}
