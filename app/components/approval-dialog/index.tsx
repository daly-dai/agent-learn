"use client";

// ============================================================
// 审批卡片 —— 写/改/删工具的人工确认（Phase 3，B1-④ 三档信任）
// ============================================================
// 布局抄 Reasonix 的确认卡片（internal/serve/index.html）：
//   嵌在消息流里（不打断，像一条待办卡片），不是居中弹框——
//   header（警告图标 + 标题）→ subject（工具 + 参数代码块）→
//   actions（按钮带快捷键徽标，键盘可操作）。
//
// 四个动作（B1-④）：
//   允许(Y)         放行这一次
//   本会话允许(A)   本会话内该工具不再问（内存记忆）
//   一直允许(P)     跨会话不再问（持久化规则）
//   拒绝(N)         拦截这次调用
//
// 快捷键：Y/A/P/N（或 1/2/3/4），Esc 拒绝。输入框聚焦时不响应
// （Reasonix isPlainKey 的简化版：不抢用户的输入）。
// ============================================================

import { useEffect } from "react";
import type { ToolApprovalRequest } from "../../lib/use-agent-run";
import styles from "./approval-dialog.module.css";

/** 用户对一次确认的决定（B1-④：session/persist 是"允许"的两种记忆档） */
export type ApprovalDecision = {
  allow: boolean;
  session?: boolean;
  persist?: boolean;
};

type ApprovalDialogProps = {
  request: ToolApprovalRequest | null;
  onApprove: (decision: ApprovalDecision) => void;
};

export function ApprovalDialog({ request, onApprove }: ApprovalDialogProps) {
  // 键盘快捷键（抄 Reasonix：卡片出现期间 Y/A/P/N 可操作；
  // 输入框/文本域聚焦时不抢键——用户可能在打字）
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "y" || k === "1") {
        e.preventDefault();
        onApprove({ allow: true });
      } else if (k === "a" || k === "2") {
        e.preventDefault();
        onApprove({ allow: true, session: true });
      } else if (k === "p" || k === "3") {
        e.preventDefault();
        onApprove({ allow: true, persist: true });
      } else if (k === "n" || k === "escape" || k === "4") {
        e.preventDefault();
        onApprove({ allow: false });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, onApprove]);

  if (!request) return null;

  // bash 工具：把命令从 JSON 壳里提取出来单独渲染（大字、代码样式），
  // 其他工具才渲染完整 JSON——命令是"要执行的动作"，值得单独看
  const isBash = request.toolName === "bash";
  const bashCommand =
    isBash && typeof request.args.command === "string"
      ? request.args.command
      : "";

  return (
    <div className={styles.approvalCard} role="alertdialog" aria-modal="false">
      <div className={styles.approvalHeader}>
        <svg
          className={styles.approvalIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className={styles.approvalTitle}>需要人工确认</span>
      </div>

      <div className={styles.approvalSubject}>
        <span className={styles.approvalTool}>{request.toolName}</span>
        {bashCommand ? (
          <pre className={styles.approvalCommand}>{bashCommand}</pre>
        ) : (
          <pre className={styles.approvalArgs}>
            {JSON.stringify(request.args, null, 2)}
          </pre>
        )}
      </div>

      <div className={styles.approvalActions}>
        <button
          className={`${styles.approvalBtn} ${styles.approvalAllow}`}
          type="button"
          onClick={() => onApprove({ allow: true })}
        >
          <span className={styles.approvalKey}>Y</span>
          允许
        </button>
        <button
          className={`${styles.approvalBtn} ${styles.approvalAllow}`}
          type="button"
          onClick={() => onApprove({ allow: true, session: true })}
        >
          <span className={styles.approvalKey}>A</span>
          本会话允许
        </button>
        <button
          className={`${styles.approvalBtn} ${styles.approvalAllow}`}
          type="button"
          onClick={() => onApprove({ allow: true, persist: true })}
        >
          <span className={styles.approvalKey}>P</span>
          一直允许
        </button>
        <button
          className={`${styles.approvalBtn} ${styles.approvalDeny}`}
          type="button"
          onClick={() => onApprove({ allow: false })}
        >
          <span className={styles.approvalKey}>N</span>
          拒绝
        </button>
      </div>
    </div>
  );
}
