// ============================================================
// POST /api/workspaces/open —— 在资源管理器里打开工作空间文件夹（C51）
// ============================================================
// **只收已登记的 id**，不接受任意路径：这是"人点组头菜单"的动作，模型没有这个
// 工具，也就不存在被模型拿去打开任意目录的口子。
//
// 为什么服务端起 `explorer.exe` 而不是让浏览器开 `file://`：现代浏览器从
// http 页面点 file:// 会被直接拦掉（安全策略），前端做不到这件事。
//
// 两条失败必须**说得出来**：
//   - 目录已经不在了 → 409（不静默成功：用户会以为"打开了但窗口没弹出来"）
//   - 非 Windows → 501（这是能力边界，不是错误）
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { config } from "@/lib/config";
import { loadWorkspaces } from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  let records;
  try {
    records = await loadWorkspaces(config.paths.home);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }

  const workspace = records.find((record) => record.id === id);
  if (!workspace) {
    return NextResponse.json({ error: "工作空间不存在" }, { status: 404 });
  }

  const exists = await stat(workspace.path)
    .then((info) => info.isDirectory())
    .catch(() => false);
  if (!exists) {
    return NextResponse.json(
      { error: "这个工作空间的文件夹不在了" },
      { status: 409 },
    );
  }

  if (process.platform !== "win32") {
    return NextResponse.json(
      { error: "打开文件夹目前只支持 Windows" },
      { status: 501 },
    );
  }

  try {
    // detached + ignore + unref：不阻塞这次请求，也不拖着 dev server 进程一起退出
    const child = spawn("explorer.exe", [workspace.path], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error) {
    return NextResponse.json(
      { error: `打不开资源管理器：${(error as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
