// ============================================================
// 工具系统的共享类型（lib/tools/ 内部使用）
// ============================================================

import type { TodoItem, ToolDefinition, ToolResult } from "../types";
import type { AskQuestion } from "./ask-user";

/**
 * 业务回调袋（贴 pi：引擎不认识里面是什么）。
 * 走「工厂参数」闭包烙进需要它的工具（todo/ask-user），不经过引擎。
 * 引擎的 executeToolCall 只碰 ToolExecutorOptions，永远见不到 ToolHooks。
 */
export type ToolHooks = {
  /**
   * todo_write 专用：把整表替换后的任务清单交回使用端（route.ts 落盘会话 + 推 SSE 帧）。
   * 返回 Promise 是因为落盘要等（保证工具结果返回时 todo 已入库）。
   */
  onTodoWrite?: (todos: TodoItem[]) => Promise<void> | void;
  /**
   * ask_user_question 专用：向使用端提出 1-4 个问题并等待回答（请求-响应）。
   * 使用端负责推 SSE 帧 → 前端逐题作答 → 回传 answers[] → resolve。
   */
  onAskUser?: (questions: AskQuestion[]) => Promise<string[]> | string[];
};

/**
 * 运行时执行上下文：每次工具调用都不同，引擎每次执行时传。
 * 只剩「运行时参数」（signal 取消 / onChunk bash 流式），业务已搬进 ToolHooks。
 */
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
  /**
   * 这把工具**专属的规矩**（由调用方收集后渲染进系统提示词）。
   *
   * ⚠️ **文本必须住在这里，不能住在提示词文件里** —— 这是 2026-09-16 定的归属规则，
   * 判据只有一条：**住这里 = 强关联，住提示词 = 弱关联**。
   *   - 住工具文件：改这个工具就看得见；这个工具删了，它的话跟着消失（不会留下
   *     "提示词提到一个不存在的工具"的悬空引用）。
   *   - 住提示词文件：**谁都不欠它一次同步**。我们为此真栽过一次 —— 手写的工具清单
   *     从 8 个工具活到 14 个工具，中途搬了三次家，**第 14 个（`skill`）就漏了**。
   * 本项目另一处同源证据：`AGENTS.md` 第 10 条写流程规则时特意说明"写在这里是因为
   * 它每次会话自动加载，**不依赖'记得去读 PLAN'**"——同一个判断。
   *
   * 分工（贴 DSH 的归属规则，见详案 C34）：
   *   - "这把工具**是什么、怎么调**" → `description`（随请求的 `tools` 字段，模型选工具的依据）
   *   - "**何时用它**、它和别的工具怎么配合" → 这里
   *   - 跨工具的（输出格式、成本策略…）→ 系统提示词里那些**不点名工具**的规矩
   *
   * 提到别的工具或参数时**用反引号包起来**（如 `` `web_fetch` ``）：`lib/tools/index.test.ts`
   * 会扫这些 token 并断言它们真的存在 —— 这是"下游改名/删除后上游失联"的唯一防线。
   */
  guidelines?: string[];
};
