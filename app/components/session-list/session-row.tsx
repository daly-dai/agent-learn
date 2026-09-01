"use client";

// ============================================================
// SessionRow —— 会话列表的"一行"（2026-08-28 从 SessionList 拆出）
// ============================================================
// 拆出理由（code-review 气味：嵌套三目 + 多职责）：
//   SessionList 只回答"列表长什么样"，本组件只回答"一行有几种形态"。
//   一行 4 态：正常 / 重命名编辑 / 删除确认 / ⋯操作菜单。
//
// 状态保持提在父级（SessionList 持有 editingId/pendingDelete/draft 单值）：
//   ——这是有意的互斥设计（同一时刻只有一行在编辑/删除）。
//   本组件只收 props 做展示 + 转发回调，不自己持有行内状态。
//   唯一例外：删除确认条的取消按钮 ref + 聚焦（纯行内视觉行为，与父级无关）。
//
// 交互约定（抄自 SessionList 时代，未变）：
//   点击行      → 切换会话（编辑/确认态中禁用）
//   ⋯→重命名  → 行内输入：Enter 保存 / Esc 或失焦取消
//   ⋯→删除    → 行内确认条：Esc 或取消退出，红字「删除」真删
// ============================================================

import { useEffect, useRef } from "react";
import type { SessionSummary } from "../../lib/use-sessions";
import { formatClock } from "../../lib/format";
import { Menu } from "../ui/menu";
import styles from "./session-list.module.css";

type SessionRowProps = {
  session: SessionSummary;
  /** 是否当前会话（高亮态） */
  current: boolean;
  /** 该行是否在重命名编辑态 */
  editing: boolean;
  /** 该行是否在删除确认态 */
  confirmingDelete: boolean;
  /** 重命名草稿（受控值，父级持有） */
  draft: string;
  onSelect: () => void;
  /** ⋯菜单「重命名」：进入编辑态 */
  onStartRename: () => void;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  /** ⋯菜单「删除」：进入确认态（不真删） */
  onRequestDelete: () => void;
  /** 确认条「删除」：真删 */
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export function SessionRow({
  session,
  current,
  editing,
  confirmingDelete,
  draft,
  onSelect,
  onStartRename,
  onRenameDraft,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: SessionRowProps) {
  // 确认条取消按钮：出现时聚焦（安全侧——回车=取消，不误删；
  // 与退役的 ConfirmDialog 默认聚焦取消同款；同时让 Esc 有落点）。
  // 行内视觉行为，不占父级状态。
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingDelete) cancelRef.current?.focus();
  }, [confirmingDelete]);

  return (
    <div
      className={`${styles.sessionItem}${current ? " is-current" : ""}`}
      // 编辑/确认态中禁点：避免"正在改这一行时误切会话"
      onClick={() => !editing && !confirmingDelete && onSelect()}
    >
      {confirmingDelete ? (
        /* 行内删除确认（2026-08-28，替代居中 ConfirmDialog 弹框）：
           复用行内重命名的"状态替换行内容"模式——点 ⋯→删除后，
           该行原地变成确认条，不遮罩、不打断阅读、操作就近。
           全站从此零模态弹框（审批/提问本就钉底部，删除就地确认）。 */
        <div
          className={styles.sessionConfirm}
          role="alert"
          onClick={(e) => e.stopPropagation()}
          /* Esc 取消：与重命名模式对齐（重命名有 Esc/失焦取消）。
             焦点在确认条内（默认在取消按钮），Esc 冒泡到容器 */
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancelDelete();
          }}
        >
          <span className={styles.confirmText}>删除后不可恢复</span>
          <div className={styles.confirmActions}>
            <button
              ref={cancelRef}
              type="button"
              className={styles.confirmCancel}
              onClick={onCancelDelete}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.confirmDelete}
              onClick={onConfirmDelete}
            >
              删除
            </button>
          </div>
        </div>
      ) : editing ? (
        <input
          className={styles.sessionRenameInput}
          value={draft}
          placeholder="会话名称"
          autoFocus
          onChange={(e) => onRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={onCancelRename}
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
            <div className={styles.sessionPreview}>{session.preview}</div>
          )}
          <div className={styles.sessionMeta}>
            {/* 2026-09-01：条数已删（占空间 + /clear 后要刷新才更新，
                用户拍板"不要展示多少条了"）——只留时间 */}
            <span>{formatClock(session.updatedAt)}</span>
          </div>
        </>
      )}

      {!editing && !confirmingDelete && (
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
              onSelect: onStartRename,
            },
            {
              label: "删除",
              hint: "不可恢复",
              danger: true,
              onSelect: onRequestDelete,
            },
          ]}
        />
      )}
    </div>
  );
}
