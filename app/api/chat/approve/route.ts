// ============================================================
// POST /api/chat/approve —— 回传工具确认的用户决定（Phase 3 人工确认）
// ============================================================
//
// 流程：引擎想执行写/改/删工具 → route.ts 推 tool_permission_request 帧
// 给前端 → 前端弹框 → 用户点「允许/拒绝」→ 本接口把决定交给挂起的确认。
//
// body: { toolCallId: string, allow: boolean }
// 找不到挂起的确认（已超时/已处理）→ 404，前端提示「操作已超时」。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toolApprovals } from "@/lib/toolApproval";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const toolCallId = typeof body?.toolCallId === "string" ? body.toolCallId : "";
  const allow = body?.allow === true;

  if (!toolCallId) {
    return NextResponse.json({ error: "缺少 toolCallId" }, { status: 400 });
  }

  const pending = toolApprovals.get(toolCallId);
  if (!pending) {
    return NextResponse.json(
      { error: "没有挂起的确认请求（可能已超时或已处理）" },
      { status: 404 },
    );
  }

  pending.resolve(allow);
  return NextResponse.json({ ok: true, allow });
}
