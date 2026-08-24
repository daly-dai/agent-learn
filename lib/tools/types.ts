// ============================================================
// 工具系统的共享类型（lib/tools/ 内部使用）
// ============================================================

import type { TodoItem, ToolDefinition, ToolResult } from "../types";
import type { AskQuestion } from "./ask-user";

export type ToolExecutorOptions = {
  /** 取消信号：中止模型请求 / 杀死正在执行的命令（run 级取消，Phase 4） */
  signal?: AbortSignal;
  /** 工具执行中逐块吐数据（bash 的 stdout/stderr 用）；其他工具忽略 */
  onChunk?: (text: string) => void;
  /**
   * todo_write 专用：把整表替换后的任务清单交回使用端（route.ts 落盘会话 + 推 SSE 帧）。
   * 仿 onChunk 旁路模式——工具不碰 store，引擎只透传，其他工具零改动。
   * 返回 Promise 是因为落盘要等（保证工具结果返回时 todo 已入库）。
   */
  onTodoWrite?: (todos: TodoItem[]) => Promise<void> | void;
  /**
   * ask_user_question 专用：向使用端提出 1-4 个问题并等待回答（请求-响应）。
   * 与 onTodoWrite 同模式（引擎只透传），但它是「要等答案」——route.ts 推
   * SSE 帧 → 前端逐题作答 → 回传 answers[] → resolve；超时兜底在使用端。
   */
  onAskUser?: (questions: AskQuestion[]) => Promise<string[]> | string[];
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  options?: ToolExecutorOptions,
) => Promise<ToolResult>;

/** 注册表里的完整工具：说明书（给模型看）+ 执行函数（给引擎用） */
export type RegisteredTool = ToolDefinition & {
  execute: ToolExecutor;
};
