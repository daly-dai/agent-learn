// ============================================================
// POST /api/chat/ask-user —— 用户回答模型提问（A4，多问题版）
// ============================================================
// 前端逐题作答 → 全部答完 → 这里把 answers[] resolve 给挂起中的
// onAskUser（lib/userAnswers.ts），工具结果回模型继续。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { userAnswers } from "@/lib/userAnswers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { toolCallId?: unknown; answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const toolCallId = body?.toolCallId;
  if (typeof toolCallId !== "string" || !toolCallId) {
    return NextResponse.json({ error: "缺少 toolCallId" }, { status: 400 });
  }

  const pending = userAnswers.get(toolCallId);
  if (!pending) {
    // 没有挂起的提问（已超时/已处理/路由未加载）——404，前端提示可排查
    return NextResponse.json(
      { error: "没有挂起的提问（可能已超时或已处理）" },
      { status: 404 },
    );
  }

  // 前端回传的是每题答案的数组；非数组则降级为空（全跳过）
  const answers = Array.isArray(body?.answers)
    ? body.answers.map((a) => (typeof a === "string" ? a : ""))
    : [];
  pending.resolve(answers);
  return NextResponse.json({ ok: true });
}
