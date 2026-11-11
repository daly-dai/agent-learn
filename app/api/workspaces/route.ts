// ============================================================
// /api/workspaces —— 工作空间注册表的增删改查（C51）
// ============================================================
//
//   GET    → { workspaces }（按 updatedAt 倒序）
//   POST   → { path, title? } → { workspace }（409 = 这个文件夹已登记）
//   PATCH  → { id, title }   → { workspace }（**只改显示名**）
//   DELETE → ?id=            → { ok: true, unregisteredSessions: n }
//
// 关键语义（决策 13）：**删记录 ≠ 删会话**。删掉的只是 workspaces.json 里那一条，
// 会话目录一个字节都不动；下一次列表刷新，它们出现在「未登记的工作空间」组里。
//
// ⚠️ 顺带做 bootstrap（"启动时补登记"的落地方式）：每次 GET 先扫一遍会话头，
// 把磁盘上有会话、表里没有的 cwd 补成记录。为什么放在 GET 而不是进程启动钩子：
// Next 的 instrumentation 钩子在 dev 下会重入，而这里**天然幂等**、且"打开列表"
// 正是需要这份数据的那一刻。
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { sessionManager } from "@/lib/session";
import {
  bootstrapWorkspaces,
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
} from "@/lib/workspace";
import { config } from "@/lib/config";
import { workspaceErrorResponse } from "./_lib/errors";

export const runtime = "nodejs";

/** 盘上所有会话的 cwd（bootstrap 与删除统计都要） */
async function sessionCwds(): Promise<string[]> {
  const sessions = await sessionManager.list();
  return sessions.map((session) => session.cwd);
}

// --- GET /api/workspaces：全部记录（顺便补登记） ---
export async function GET() {
  try {
    const workspaces = await bootstrapWorkspaces(
      config.paths.home,
      await sessionCwds(),
    );
    const ordered = [...workspaces].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    return NextResponse.json({ workspaces: ordered });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

// --- POST /api/workspaces：登记一个文件夹 ---
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const path = typeof body?.path === "string" ? body.path : "";
  const title = typeof body?.title === "string" ? body.title : undefined;

  if (!path) {
    return NextResponse.json({ error: "缺少 path" }, { status: 400 });
  }

  try {
    const workspace = await createWorkspace(config.paths.home, { path, title });
    return NextResponse.json({ workspace });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

// --- PATCH /api/workspaces：只改显示名 ---
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const title = typeof body?.title === "string" ? body.title : "";

  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  try {
    const workspace = await renameWorkspace(config.paths.home, { id, title });
    return NextResponse.json({ workspace });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

// --- DELETE /api/workspaces?id=：只删记录，会话一个字节不动 ---
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  try {
    const { unregisteredSessions } = await deleteWorkspace(config.paths.home, {
      id,
      sessionCwds: await sessionCwds(),
    });
    return NextResponse.json({ ok: true, unregisteredSessions });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
