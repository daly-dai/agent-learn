// ============================================================
// API 路由 —— GET /api/traces?sessionId=X：列某个会话的全部 run（A3）
// ============================================================
// 给前端轨迹视图的"run 分隔线"提供数据：每个 run 一行元信息。
//
// 性能设计（A3 详案 §3.1 ①）：**列表必须便宜**
//   ① 定位用 listTraceFiles —— readdir + 文件名前缀过滤，**零内容读取**
//   ② 元信息用 readTraceMeta —— 每个文件只读首行 1KB + 尾行 2KB
//   （对比：readTrace 会把整个文件读进来，最大 1.15MB——那是"点进某个 run
//    看详情"时该付的成本，不是列表该付的。）
//
// 安全：sessionId 拼进文件名前缀，必须过 isValidSessionId 白名单（同 chat/export）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { config, isValidSessionId, listTraceFiles, readTraceMeta } from "@/lib";
import type { TraceMeta } from "@/lib";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }

  const files = await listTraceFiles(config.paths.traces, sessionId);
  const metas = await Promise.all(files.map((file) => readTraceMeta(file.path)));

  // readTraceMeta 返回 undefined = "这个文件不是轨迹"（空文件/首行不是 trace_start），
  // 那是**分类**不是失败，所以直接不列。崩掉的 run 走的是另一条路：文件是轨迹、
  // 但 completed: false —— 那种一定要列出来（残轨迹恰恰最值得看）。
  const runs = metas.filter((meta): meta is TraceMeta => meta !== undefined);

  return NextResponse.json({ sessionId, runs });
}
