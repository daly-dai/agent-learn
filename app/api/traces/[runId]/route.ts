// ============================================================
// API 路由 —— GET /api/traces/<runId>?sessionId=X：读一个 run 的全部条目（A3）
// ============================================================
// 返回 { meta, entries }：视图一次拿齐（meta 画头部，entries 交给 foldTrace 折成记录表）。
//
// 安全（重要）：**runId 绝不拼进文件路径**。做法是先列出该会话目录里的轨迹文件、
// 再按**内容里的 runId** 匹配 —— 路径来自 readdir 的结果，不来自 URL。于是
// `../../../etc/passwd` 这类输入连"匹配上"这一步都走不到，**路径穿越在结构上
// 不可能**，不必依赖对 runId 做正则白名单。（对比 chat/export 的 sessionId：
// 那个必须参与定位，所以只能靠 isValidSessionId 白名单。
// **能用结构挡住的，就别靠校验**。）
//
// 性能：这里是"详情"，**全量读是对的**（readTrace）。只有列表必须便宜（见 route.ts）。
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isValidSessionId,
  listTraceFiles,
  readTrace,
  readTraceMeta,
  sessionManager,
} from "@/lib";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  // Next 16：路由参数是 Promise，必须 await（见 next/dist/server/lib/router-utils/typegen.js）
  const { runId } = await ctx.params;
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }

  const location = await sessionManager.locate(sessionId);
  if (!location) {
    return NextResponse.json(
      { error: `轨迹不存在：${runId}` },
      { status: 404 },
    );
  }

  // 文件名里只有 runId 的编码形式（不可逆），身份在首行的 trace_start 里 ——
  // 所以"按 runId 找人"就是逐个读首末两行，比 meta.runId。
  // 一个会话的轨迹是"每次 run 一个文件"的量级（几十个），这一步很便宜。
  const candidates = await Promise.all(
    (await listTraceFiles(location.dir)).map(async (file) => ({
      file,
      meta: await readTraceMeta(file),
    })),
  );
  const hit = candidates.find((candidate) => candidate.meta?.runId === runId);
  if (!hit?.meta) {
    return NextResponse.json(
      { error: `轨迹不存在：${runId}` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    sessionId,
    runId,
    meta: hit.meta,
    entries: await readTrace(hit.file),
  });
}
