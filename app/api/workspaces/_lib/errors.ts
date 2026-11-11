// ============================================================
// /api/workspaces 的错误 → HTTP 状态码（一处映射，三处路由共用）
// ============================================================
// 为什么只有**一个** WorkspaceError 类 + code（而不是 7 个子类）：路由里只需
// 一个 switch 就能把 code 翻成状态码；7 个子类会变成 7 个 `instanceof`。
// 状态码的取值见详案 4.13 B 那张表 —— 界面弹什么全看它。
// ============================================================

import { NextResponse } from "next/server";
import { WorkspaceError } from "@/lib/workspace";
import type { WorkspaceErrorCode } from "@/lib/workspace";

const STATUS: Record<WorkspaceErrorCode, number> = {
  "invalid-path": 400,
  "not-a-directory": 400,
  "invalid-title": 400,
  duplicate: 409,
  "not-found": 404,
  // 注册表坏了是**服务端**的问题，不能假装"还没有工作空间"（那会让人以为记录丢了）
  corrupt: 500,
};

/** 把领域错误翻成响应；不是 WorkspaceError 的异常按 500 交出去（交给上层记日志） */
export function workspaceErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: STATUS[error.code] },
    );
  }
  throw error;
}
