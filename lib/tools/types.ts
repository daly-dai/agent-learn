// ============================================================
// 工具系统的共享类型（lib/tools/ 内部使用）
// ============================================================

import type { ToolDefinition, ToolResult } from "../types";

export type ToolExecutorOptions = {
  /** 取消信号：中止模型请求 / 杀死正在执行的命令（run 级取消，Phase 4） */
  signal?: AbortSignal;
  /** 工具执行中逐块吐数据（bash 的 stdout/stderr 用）；其他工具忽略 */
  onChunk?: (text: string) => void;
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  options?: ToolExecutorOptions,
) => Promise<ToolResult>;

/** 注册表里的完整工具：说明书（给模型看）+ 执行函数（给引擎用） */
export type RegisteredTool = ToolDefinition & {
  execute: ToolExecutor;
};
