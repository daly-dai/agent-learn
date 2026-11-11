// ============================================================
// /api/sessions —— 会话本身的增删改查（Phase 2 多会话）
// ============================================================
//
// 与 /api/chat 的分工：
//   /api/sessions  管「会话本身」—— 列表 / 新建 / 重命名 / 删除
//   /api/chat      管「会话里的对话」—— 发消息 / 历史 / 清空当前会话消息
//
// 接口一览：
//   GET    → 会话列表 [{ id, title?, updatedAt, preview?, cwd }]（全量、跨工作空间）
//   POST   → 新建空会话（body: { workspaceId, title? }）→ { id }
//   PATCH  → 重命名（body: { id, title }）→ { ok }
//   DELETE → 删除会话（?id=）→ { ok }
//
// ⚠️ 2026-11-11：**新建会话必须指定工作空间**（`workspaceId` 必填、没有默认值）。
// 为什么：会话的落盘位置由「工作空间路径」推出（`<根>/<工作空间键>/<会话目录>`），
// 没有工作空间就没有地方可写；而"不属于任何工作空间的会话"这个状态也不该存在。
//
// 安全：所有 id 必须先过 isValidSessionId，否则 400。
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { realpath, stat } from "node:fs/promises";
import { isValidSessionId, sessionManager } from "@/lib/session";
import { loadWorkspaces } from "@/lib/workspace";
import { config } from "@/lib/config";

export const runtime = "nodejs";

// --- GET /api/sessions：会话列表（扫全部工作空间分组） ---
export async function GET() {
  const sessions = await sessionManager.list();
  return NextResponse.json({ sessions });
}

// --- POST /api/sessions：在指定工作空间里新建空会话 ---
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const workspaceId =
    typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const title =
    typeof body?.title === "string" && body.title.trim()
      ? body.title.trim()
      : undefined;

  if (!workspaceId) {
    return NextResponse.json({ error: "缺少 workspaceId" }, { status: 400 });
  }

  let records;
  try {
    records = await loadWorkspaces(config.paths.home);
  } catch (error) {
    // 注册表坏了就当 500 明说，不要"当空表继续"——那会把用户的登记悄悄丢掉
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }

  const record = records.find((item) => item.id === workspaceId);
  if (!record) {
    return NextResponse.json({ error: "工作空间不存在" }, { status: 404 });
  }

  // 复核目录还在：登记之后用户可能把文件夹删了/改名了。
  // 不自动重建、不改登记 —— 让界面明确告诉人"这个工作空间的文件夹不在了"。
  const canonical = await realpath(record.path).catch(() => undefined);
  if (
    !canonical ||
    !(await stat(canonical)
      .then((s) => s.isDirectory())
      .catch(() => false))
  ) {
    return NextResponse.json(
      { error: "这个工作空间的文件夹不在了" },
      { status: 409 },
    );
  }

  const id = await sessionManager.create({ cwd: canonical, title });
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
    await sessionManager.rename(id, title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 404 },
    );
  }
}

// --- DELETE /api/sessions：删除整个会话（含它的全部轨迹） ---
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";

  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "非法会话 id" }, { status: 400 });
  }

  try {
    await sessionManager.delete(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 404 },
    );
  }
}
