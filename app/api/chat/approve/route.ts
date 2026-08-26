// ============================================================
// POST /api/chat/approve —— 回传工具确认的用户决定（Phase 3 人工确认）
// ============================================================
//
// 流程：引擎想执行写/改/删工具 → route.ts 推 tool_permission_request 帧
// 给前端 → 前端弹框 → 用户点「允许一次/本会话允许/一直允许/拒绝」→
// 本接口把决定交给挂起的确认，并按选项写记忆（B1-④）。
//
// body: { toolCallId: string, allow: boolean, session?: boolean,
//         persist?: boolean, sessionId?: string }
//   allow=true + session=true  → 本会话内该工具不再询问（内存记忆）
//   allow=true + persist=true  → 该工具一直允许（持久化规则文件）
// 找不到挂起的确认（已超时/已处理）→ 404，前端提示「操作已超时」。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toolApprovals } from "@/lib/toolApproval";
import { config } from "@/lib/config";
import {
  rememberSession,
  rememberPersist,
} from "@/lib/permission/approval-memory";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const toolCallId = typeof body?.toolCallId === "string" ? body.toolCallId : "";
  const allow = body?.allow === true;
  const sessionOpt = body?.session === true;
  const persist = body?.persist === true;
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "default";

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

  if (!allow) {
    pending.resolve("denied");
    return NextResponse.json({ ok: true, allow: false });
  }

  // B1-④ 记忆：按用户选的档位写记忆，再 resolve 对应 outcome
  if (persist) {
    await rememberPersist(config.paths.sessions, pending.toolName);
    pending.resolve("approved-persist");
  } else if (sessionOpt) {
    rememberSession(sessionId, pending.toolName);
    pending.resolve("approved-session");
  } else {
    pending.resolve("approved");
  }

  return NextResponse.json({ ok: true, allow: true });
}
