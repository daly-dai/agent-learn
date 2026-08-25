"use client";

// ============================================================
// 审批弹框 —— 写/改/删工具的人工确认（Phase 3）
// ============================================================
// 引擎想执行 write_note/write_file/edit_file/delete_file 时，
// 服务端推 tool_permission_request 帧，这里弹框展示「谁 + 参数」，
// 由用户当场决定放行还是拦截。服务端有超时兜底（5 小时），
// 但前端不展示时间——用户不该有被催促的感觉。
// ============================================================

import type { ToolApprovalRequest } from "../../lib/use-agent-run";
import styles from "./approval-dialog.module.css";

type ApprovalDialogProps = {
  request: ToolApprovalRequest | null;
  onApprove: (allow: boolean) => void;
};

export function ApprovalDialog({ request, onApprove }: ApprovalDialogProps) {
  if (!request) return null;

  return (
    <div className={styles.approvalMask} role="alertdialog" aria-modal="true">
      <div className={styles.approvalPanel}>
        <div className={styles.approvalTitle}>工具调用需要确认</div>
        <div className={styles.approvalTool}>{request.toolName}</div>
        <pre className={styles.approvalArgs}>
          {JSON.stringify(request.args, null, 2)}
        </pre>
        <div className={styles.approvalActions}>
          <button
            className={`${styles.approvalBtn} ${styles.approvalAllow}`}
            type="button"
            onClick={() => onApprove(true)}
          >
            允许
          </button>
          <button
            className={`${styles.approvalBtn} ${styles.approvalBlock}`}
            type="button"
            onClick={() => onApprove(false)}
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
