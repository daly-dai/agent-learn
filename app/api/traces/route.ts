// ============================================================
// API 路由 —— GET /api/traces?sessionId=X：列某个会话的全部 run（A3）
// ============================================================
// 给前端轨迹视图的"run 分隔线"提供数据：每个 run 一行元信息。
//
// 性能设计（A3 详案 §3.1 ①）：**列表必须便宜**
//   ① 定位用 listTraceFiles —— 会话目录内 readdir + 文件名过滤，**零内容读取**
//   ② 元信息用 readTraceMeta —— 每个文件只读首行 1KB + 尾行 2KB
//   （对比：readTrace 会把整个文件读进来，最大 1.15MB——那是"点进某个 run
//    看详情"时该付的成本，不是列表该付的。）
//
// ⚠️ 2026-11-11：轨迹从"一个全局 `.traces/` 目录 + 文件名带 sessionId"改成
// "住进会话目录"。所以先 `sessionManager.locate(sessionId)` 拿到目录 ——
// 会话不存在时返回空列表（不是 404：还没跑过 agent 的会话本来就没有轨迹）。
//
// 安全：sessionId 会参与定位，必须过 isValidSessionId 白名单（同 chat/export）。
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isValidSessionId,
  listTraceFiles,
  readTraceMeta,
  sessionManager,
} from "@/lib";
import type { TraceMeta } from "@/lib";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }

  const location = await sessionManager.locate(sessionId);
  if (!location) return NextResponse.json({ sessionId, runs: [] });

  const files = await listTraceFiles(location.dir);
  const metas = await Promise.all(files.map((file) => readTraceMeta(file)));

  // readTraceMeta 返回 undefined = "这个文件不是轨迹"（空文件/首行不是 trace_start），
  // 那是**分类**不是失败，所以直接不列。崩掉的 run 走的是另一条路：文件是轨迹、
  // 但 completed: false —— 那种一定要列出来（残轨迹恰恰最值得看）。
  const runs = metas.filter((meta): meta is TraceMeta => meta !== undefined);

  return NextResponse.json({ sessionId, runs });
}
