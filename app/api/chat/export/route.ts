// ============================================================
// API 路由 —— GET /api/chat/export：下载会话 JSONL 文件（C13 /export）
// ============================================================
// DSH /export 门面模式的下载侧（handler 只校验，文件走 HTTP 层）：
//   - 命令 POST /api/chat/command 返回 success 后，前端调本路由
//   - 读会话的 session.jsonl，以附件形式返回（Content-Disposition）
//   - 会话文件本身就是 JSONL 历史（每行一个 entry），无需转换——
//     导出 = 原样给文件，可被 JsonlSessionStore 重新加载（可移植）
//
// ⚠️ 2026-11-11：路径不再自己拼（以前是 `join(config.paths.sessions, id + ".jsonl")`，
// 与 manager / pipeline / 轨迹各拼一次 —— 漏改一处就静默 404）。现在会话目录只由
// `SessionManager.locate(id)` 给。
//
// 安全：sessionId 会参与定位，必须过 isValidSessionId 白名单（同 route.ts）。
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { isValidSessionId, sessionManager } from "@/lib";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }

  const location = await sessionManager.locate(sessionId);
  const filePath = location?.logPath;
  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json(
      { error: `会话 ${sessionId} 不存在` },
      { status: 404 },
    );
  }

  const content = readFileSync(filePath, "utf8");
  // Content-Disposition: attachment 强制下载；文件名 = 会话 id（可移植回导入）
  return new NextResponse(content, {
    headers: {
      "Content-Type": "application/jsonl; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sessionId}.jsonl"`,
    },
  });
}
