// ============================================================
// approvalMode.ts —— 审批模式（运行时可变，B1-②）
// ============================================================
// 参考项目的"信任档位"普遍有运行时切换入口（pi /settings、
// DSH /permission、CodeWhale Shift+Tab）——模式不能靠改 env 重启，
// 必须能在运行中切换。
//
// 设计：
//   - 初始值来自 config.approval.mode（env APPROVAL_MODE 可配默认）
//   - 运行时通过 /api/chat/approval-mode 切换（globalThis 可变，
//     跨 worker 可见；重启恢复默认）
//   - 前端切换控件见 app/components/approval-mode-switch/
// ============================================================

import { config } from "./config";

export type ApprovalMode = "suggest" | "bypass" | "never";

const g = globalThis as { __approvalMode?: ApprovalMode };

function parseMode(value: string): ApprovalMode {
  return value === "bypass" || value === "never" ? value : "suggest";
}

/** 当前审批模式（运行时可变；未切换过时取 config 默认） */
export function getApprovalMode(): ApprovalMode {
  return g.__approvalMode ?? parseMode(config.approval.mode);
}

/** 切换审批模式（内存态，重启恢复默认） */
export function setApprovalMode(mode: ApprovalMode): void {
  g.__approvalMode = mode;
}
