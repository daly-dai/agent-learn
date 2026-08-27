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
//   ×（悬停）  → 删除（项目自己的确认弹框，不用浏览器 confirm）
// ============================================================

import { useState } from "react";
import type { SessionSummary } from "../../lib/use-sessions";
import { formatClock } from "../../lib/format";
import { ConfirmDialog } from "../confirm-dialog";
import { Menu } from "../ui/menu";
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
  // 待删除的会话（非 null 时弹确认框）——替换浏览器 window.confirm
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
                    placeholder="会话名称"
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
                    {/* V2 二次调整（2026-08-26，抄 DSH 会话列表）：
                        不再显示 session 文件 id。没标题时回退到首条消息
                        （preview），再没有才显示「未命名会话」——原始 id
                        （s_2026-08-26T..._xxx）是存储细节，不是给人看的名字 */}
                    <div className={styles.sessionTitle}>
                      {session.title ?? session.preview ?? "未命名会话"}
                    </div>
                    {session.title && session.preview && (
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
                  /* V2（2026-08-26）：⋯ 菜单（重命名/删除，34px 命中区）。
                     二次调整：从"常驻显示"改回"鼠标移上去才显示"（抄 DSH
                     会话列表的 hover 操作模式）——行平时干净，干预才动手。
                     键盘可达：焦点进到行内（focus-within）时同样显示 */
                  <Menu
                    label={`会话操作：${
                      session.title ?? session.preview ?? "未命名会话"
                    }`}
                    /* V2 微调（2026-08-26，用户要求"偏右，别挡会话列表"）：
                       side = 弹框贴 ⋯ 右侧水平展开，浮到转录稿上方，
                       不再往下盖住下面会话行的标题/预览 */
                    align="side"
                    className={styles.sessionMenu}
                    items={[
                      {
                        label: "重命名",
                        onSelect: () => startRename(session),
                      },
                      {
                        label: "删除",
                        hint: "不可恢复",
                        danger: true,
                        onSelect: () => setPendingDelete(session),
                      },
                    ]}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={styles.sidebarFoot}>
        <p>点击切换会话 · 悬停 ⋯ 重命名 / 删除</p>
      </div>

      {/* 删除确认弹框：替换浏览器 confirm，走纸记录仪语言（危险操作 error 红） */}
      {pendingDelete && (
        <ConfirmDialog
          title="删除会话"
          message={`删除会话「${pendingDelete.title ?? pendingDelete.id}」？此操作不可恢复，会话记录将被清空。`}
          confirmLabel="删除"
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}
