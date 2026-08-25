// ============================================================
// /api/sessions —— 会话本身的增删改查（Phase 2 多会话）
// ============================================================
//
// 与 /api/chat 的分工：
//   /api/sessions  管「会话本身」—— 列表 / 新建 / 重命名 / 删除
//   /api/chat      管「会话里的对话」—— 发消息 / 历史 / 清空当前会话消息
//
// 接口一览：
//   GET    → 会话列表 [{ id, title?, messageCount, updatedAt, preview }]
//   POST   → 新建空会话（body: { title? }）→ { id }
//   PATCH  → 重命名（body: { id, title }）→ { ok }
//   DELETE → 删除会话（?id=）→ { ok }
//
// 安全：所有 id 必须先过 isValidSessionId，否则 400——id 会拼进文件路径，
// 不校验就能 `../../x` 越界（见 lib/sessionManager.ts 的说明）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { SessionManager, isValidSessionId } from "@/lib/sessionManager";
import { config } from "@/lib/config";

export const runtime = "nodejs";

// SessionManager 无内存态（方法直接打文件系统），模块级单例安全
// 路径来自 lib/config.ts（唯一配置入口，环境变量可覆盖）
const manager = new SessionManager(config.paths.sessions, config.paths.workspace);

// --- GET /api/sessions：会话列表 ---
export async function GET() {
  const sessions = await manager.list();
  return NextResponse.json({ sessions });
}

// --- POST /api/sessions：新建空会话 ---
// body 可选 { title }；不传 title 则列表显示回退用 id
export async function POST(req: NextRequest) {
  let title: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim();
    }
  } catch {
    // 空 body 也算新建（无标题）
  }

  const id = await manager.create(title);
  return NextResponse.json({ id });
}

// --- PATCH /api/sessions：重命名（只改头里的 title） ---
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "非法会话 id" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  try {
    await manager.rename(id, title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 404 },
    );
  }
}

// --- DELETE /api/sessions：删除整个会话 ---
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";

  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "非法会话 id" }, { status: 400 });
  }

  try {
    await manager.delete(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 404 },
    );
  }
}
