// ============================================================
// /api/repos/logs —— 更新历史（C15）
// ============================================================
// 接口一览：
//   GET /api/repos/logs           → 全部更新日志列表（元信息，倒序）
//   GET /api/repos/logs?name=pi   → 该项目全部日志（倒序，含全文）
//
// 背景：更新总结落盘在 workspace/更新日志/，但页面 state 刷新即丢。
// 本接口把落盘文件读回来——刷新页面后仍能看到最近更新内容；
// ?name= 返回该项目全部日志（时间线），不是只有最新一条。
// 文件来自 saveUpdateLog 的固定命名，读的是自己写的东西（白名单内）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { listUpdateLogs, readAllLogs } from "../_lib/history";

export const runtime = "nodejs";

// --- GET /api/repos/logs：日志列表；?name= 读该项目全部日志 ---
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";

  // 带 name → 该项目全部日志（倒序，含全文）
  if (name) {
    const logs = await readAllLogs(name);
    return NextResponse.json({ logs });
  }

  // 不带 name → 全部日志元信息列表
  const logs = await listUpdateLogs();
  return NextResponse.json({ logs });
}
