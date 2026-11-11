"use client";

// ============================================================
// 会话列表 —— 左侧栏：按工作空间分组（C49 + C51）
// ============================================================
// 本组件只回答"侧栏长什么样"，数据与操作全部由页面传入（不自己发请求）：
//
//   groups            已经分好组的会话（app/lib/session-groups 的纯函数算的）
//   onSelect/...      会话级动作
//   onCreateSession   在**某个**工作空间里新建会话（组头 ＋）
//   onCreateWorkspace 打开"选文件夹"对话框（侧栏头部 ＋）
//   onStartRenameWorkspace / onDeleteWorkspace / onOpenWorkspaceFolder
//
// 行内状态（重命名草稿、待删除会话）**单点持有在这里**：同一时刻只允许一行在
// 编辑或删除。组级状态（折叠、先 5 条）也在这里，因为它是"每组各一份"的集合，
// 放在组组件里会让"刷新后记住"这类需求无处安放（现在：不记住，刷新回默认）。
// ============================================================

import { useMemo, useState } from "react";
import type { SessionSummary } from "../../lib/use-sessions";
import type { Workspace } from "../../lib/use-workspaces";
import { foldGroup, type SessionGroup } from "../../lib/session-groups";
import { SessionRow } from "./session-row";
import { WorkspaceGroup } from "../workspace-group";
import styles from "./session-list.module.css";

type SessionListProps = {
  groups: SessionGroup<SessionSummary>[];
  /** 全部会话数（页脚显示；分组后头部那个总数没意义了） */
  totalSessions: number;
  /** 数据根路径（页脚交代"会话存在哪"） */
  sessionsRoot: string;
  workspaces: Workspace[];
  currentId: string;
  onSelect: (id: string) => void;
  onCreateSession: (workspaceId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCreateWorkspace: () => void;
  onRenameWorkspace: (workspace: Workspace, title: string) => void;
  onOpenWorkspaceFolder: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
};

export function SessionList({
  groups,
  totalSessions,
  sessionsRoot,
  workspaces,
  currentId,
  onSelect,
  onCreateSession,
  onRename,
  onDelete,
  onCreateWorkspace,
  onRenameWorkspace,
  onOpenWorkspaceFolder,
  onDeleteWorkspace,
}: SessionListProps) {
  // 行内重命名：editingId 是正在编辑的会话，draft 是输入框草稿
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 待删除的会话（就地确认条）
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(
    null,
  );

  // 工作空间级：折叠整组的 key 集合、组内"展开其余"的 key 集合
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  // 正在改名 / 正在确认删除的工作空间
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(
    null,
  );
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(
    null,
  );

  const byId = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );

  function toggleCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function showMore(key: string) {
    setExpandedGroups((prev) => new Set(prev).add(key));
  }

  function startRename(session: SessionSummary) {
    setEditingId(session.id);
    setDraft(session.title ?? "");
  }

  function cancelRename() {
    setEditingId(null);
    setDraft("");
  }

  function commitRename() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    cancelRename();
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHead}>
        <span className={styles.sidebarTitle}>工作空间</span>
        <button
          className={styles.sidebarAdd}
          type="button"
          title="新增工作空间（选一个文件夹）"
          aria-label="新增工作空间"
          onClick={onCreateWorkspace}
        >
          ＋
        </button>
      </div>

      <div className={styles.sessionList}>
        {groups.length === 0 ? (
          <p className={styles.sessionEmpty}>
            还没有工作空间。点右上角 ＋
            选一个文件夹，它会成为你的第一个工作空间。
          </p>
        ) : (
          groups.map((group) => {
            const workspace = byId.get(group.workspaceId);
            if (!workspace) return null; // 理论上不会：组就是从记录算出来的
            const folded = foldGroup(
              group.sessions,
              expandedGroups.has(group.key),
            );

            return (
              <WorkspaceGroup
                key={group.key}
                title={group.title}
                count={group.sessions.length}
                collapsed={collapsedGroups.has(group.key)}
                onToggleCollapse={() => toggleCollapsed(group.key)}
                hiddenCount={folded.hiddenCount}
                onShowMore={() => showMore(group.key)}
                onCreateSession={() => onCreateSession(workspace.id)}
                onStartRename={() => {
                  setRenamingWorkspaceId(workspace.id);
                  setWorkspaceDraft(workspace.title);
                }}
                onOpenFolder={() => onOpenWorkspaceFolder(workspace)}
                onDelete={() => setDeletingWorkspaceId(workspace.id)}
                renaming={renamingWorkspaceId === workspace.id}
                draft={workspaceDraft}
                onDraftChange={setWorkspaceDraft}
                onCommitRename={() => {
                  const title = workspaceDraft.trim();
                  // 改名落地交给页面（它调 PATCH 并刷新列表）；空名字等于取消
                  if (title) onRenameWorkspace(workspace, title);
                  setRenamingWorkspaceId(null);
                }}
                onCancelRename={() => setRenamingWorkspaceId(null)}
                confirmingDelete={deletingWorkspaceId === workspace.id}
                onConfirmDelete={() => {
                  setDeletingWorkspaceId(null);
                  onDeleteWorkspace(workspace);
                }}
                onCancelDelete={() => setDeletingWorkspaceId(null)}
              >
                {group.sessions.length === 0 ? (
                  <button
                    className={styles.emptyGroup}
                    type="button"
                    onClick={() => onCreateSession(workspace.id)}
                  >
                    <span aria-hidden="true">＋</span> 在这里开第一个会话
                  </button>
                ) : (
                  folded.visible.map((session) => (
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
              </WorkspaceGroup>
            );
          })
        )}
      </div>

      <div className={styles.sidebarFoot}>
        <span className={styles.footText}>共 {totalSessions} 个会话</span>
        {/* 会话到底存在哪，必须能看见（数据根可被 STATVE_HOME 覆盖） */}
        <span className={styles.footPath} title={sessionsRoot}>
          数据根 {sessionsRoot}
        </span>
      </div>
    </aside>
  );
}
