// ============================================================
// GET /api/workspaces/browse —— 目录浏览器（C6）
// ============================================================
// 列**一层**目录，给人挑工作空间用（不带 path = 家目录）。
//
// ⚠️ 2026-11-11：**这个对话框只读**。曾经设计过"在这里新建文件夹"，
// 用户拍板砍掉 —— 那是鸡肋功能，而且给一个只读浏览加写权限就是白送一份风险。
// 要建文件夹，去系统的资源管理器建，这里只负责"看见并选中"。
//
// ⚠️ 这是**人的操作面**，模型没有这个工具。所以这里不限根（能一路点到 D:\ 去），
// 真正约束模型的是围栏 + 越界审批 —— 两件事别混在一起。
//
// 三道门的错误文案在 `_lib/browse` 里定，这里只负责翻成 HTTP：
//   非完全限定 / 不存在 / 不是目录 → 400（文案不同）
// ============================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { homedir } from "node:os";
import { listDirectory } from "../_lib/browse";
import { workspaceErrorResponse } from "../_lib/errors";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path")?.trim() || homedir();

  try {
    return NextResponse.json(listDirectory({ path }));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
