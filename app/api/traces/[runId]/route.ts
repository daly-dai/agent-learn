// ============================================================
// API 路由 —— GET /api/traces/<runId>?sessionId=X：读一个 run 的全部条目（A3）
// ============================================================
// 返回 { meta, entries }：视图一次拿齐（meta 画头部，entries 交给 foldTrace 折成记录表）。
//
// 安全（重要）：**runId 绝不拼进文件路径**。做法是先用 listTraceFiles 列出该会话的
// 文件、再按 runId 匹配 —— 路径来自 readdir 的结果，不来自 URL。于是
// `../../../etc/passwd` 这类输入连"匹配上"这一步都走不到，**路径穿越在结构上不可能**，
// 不必依赖对 runId 做正则白名单。（对比 chat/export 的 sessionId：那个必须拼进路径，
// 所以只能靠 isValidSessionId 白名单。**能用结构挡住的，就别靠校验**。）
//
// 性能：这里是"详情"，**全量读是对的**（readTrace）。只有列表必须便宜（见 route.ts）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { config, isValidSessionId, listTraceFiles, readTrace, readTraceMeta } from "@/lib";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  // Next 16：路由参数是 Promise，必须 await（见 next/dist/server/lib/router-utils/typegen.js）
  const { runId } = await ctx.params;
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }

  const files = await listTraceFiles(config.paths.traces, sessionId);
  const file = files.find((candidate) => candidate.runId === runId);
  if (!file) {
    return NextResponse.json({ error: `轨迹不存在：${runId}` }, { status: 404 });
  }

  // 先读 meta 再读 entries：文件名像轨迹、内容却不是（空文件/被清空）时，
  // 在读 1MB 之前就掉头，而不是读完再发现没东西可用。
  const meta = await readTraceMeta(file.path);
  if (!meta) {
    return NextResponse.json({ error: `轨迹文件不可读：${runId}` }, { status: 404 });
  }

  return NextResponse.json({ sessionId, runId, meta, entries: await readTrace(file.path) });
}
