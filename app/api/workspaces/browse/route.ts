// ============================================================
// /api/workspaces/browse —— 目录浏览器（C6）
// ============================================================
//   GET  ?path=<绝对路径>            → 列一层（不带 path = 家目录）
//   POST { path, name }             → 在 path 下新建一个子文件夹
//
// ⚠️ 这是**人的操作面**，模型没有这个工具。所以这里不限根（能一路点到 D:\ 去），
// 真正约束模型的是围栏 + 越界审批 —— 两件事别混在一起。
//
// 三道门的错误文案在 `_lib/browse` 里定，这里只负责翻成 HTTP：
//   非完全限定 / 不存在 / 不是目录 → 400（文案不同）
//   同名已存在                     → 409
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { homedir } from "node:os";
import { createDirectory, listDirectory } from "../_lib/browse";
import { workspaceErrorResponse } from "../_lib/errors";

export const runtime = "nodejs";

// --- GET /api/workspaces/browse?path= ---
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path")?.trim() || homedir();

  try {
    return NextResponse.json(listDirectory({ path }));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

// --- POST /api/workspaces/browse：新建一层文件夹 ---
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const path = typeof body?.path === "string" ? body.path : "";
  const name = typeof body?.name === "string" ? body.name : "";

  if (!path) {
    return NextResponse.json({ error: "缺少 path" }, { status: 400 });
  }

  try {
    const created = createDirectory({ path, name });
    return NextResponse.json({ path: created });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
