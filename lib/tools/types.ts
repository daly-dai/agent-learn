// ============================================================
// 工具系统的共享类型（lib/tools/ 内部使用）
// ============================================================

import type { ToolDefinition, ToolResult } from "../types";

export type ToolExecutor = (
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ToolResult>;

/** 注册表里的完整工具：说明书（给模型看）+ 执行函数（给引擎用） */
export type RegisteredTool = ToolDefinition & {
  execute: ToolExecutor;
};
