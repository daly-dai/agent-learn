// ============================================================
// POST /api/chat/stop —— 停止一次 run（Phase 4 停止按钮）
// ============================================================
// 前端点「停止」→ 本接口 abort 该 run 的 AbortController：
//   正在进行的模型请求被中止（stopReason: aborted）
//   正在执行的 bash 命令被杀死（SIGTERM → 5 秒后 SIGKILL）
// 引擎随后受控收尾（return 半截档案），done 帧照发。
//
// body: { runId: string }
// 找不到（run 已结束/已清理）→ 404。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runControllers } from "@/lib/runControl";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : "";

  if (!runId) {
    return NextResponse.json({ error: "缺少 runId" }, { status: 400 });
  }

  const controller = runControllers.get(runId);
  if (!controller) {
    return NextResponse.json(
      { error: "没有正在运行的 run（可能已结束）" },
      { status: 404 },
    );
  }

  controller.abort();
  return NextResponse.json({ ok: true, runId });
}
