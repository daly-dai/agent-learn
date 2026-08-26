// ============================================================
// POST /api/chat/approval-mode —— 审批模式运行时切换（B1-②）
// ============================================================
// 参考项目都有运行时切换入口（pi /settings、DSH /permission、
// CodeWhale Shift+Tab）——模式不能靠改 env 重启。
//
// GET  → 当前模式（页面挂载时读，显示当前档位）
// POST { mode } → 切换（内存态，重启恢复 config 默认）
//   mode: "suggest" | "bypass" | "never"
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getApprovalMode,
  setApprovalMode,
  type ApprovalMode,
} from "@/lib/approvalMode";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ mode: getApprovalMode() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const mode = body?.mode as ApprovalMode;
  if (mode !== "suggest" && mode !== "bypass" && mode !== "never") {
    return NextResponse.json(
      { error: 'mode 必须是 "suggest" | "bypass" | "never"' },
      { status: 400 },
    );
  }
  setApprovalMode(mode);
  return NextResponse.json({ ok: true, mode });
}
