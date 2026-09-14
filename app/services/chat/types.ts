// ============================================================
// /api/chat 系列接口的参数与返回类型
// 服务端 route 见 app/api/chat/route.ts（POST 发消息 / GET 历史 /
// DELETE 清空）、app/api/chat/approve/route.ts、app/api/chat/stop/route.ts
// ============================================================

import type { AgentMessage, SessionStats, TodoItem } from "@/lib/types";
// type-only：context-occupancy 类型面无依赖，前端 bundle 安全
import type { ContextPressure } from "@/app/lib/context-occupancy";

/** GET /api/chat?sessionId= → 会话历史（叶子路径全部消息）+ 会话级统计 + 任务清单 */
export type ChatHistoryResult = {
  sessionId: string;
  leafId: string;
  messages: AgentMessage[];
  stats: SessionStats;
  /** 任务清单（Phase 5）：叶子回溯取最新 todo 条目；没有则为空数组 */
  todos: TodoItem[];
  /** 当前上下文占用（C13 ContextMeter 数据源） */
  contextPressure: ContextPressure;
};

/** POST /api/chat/approve 参数：回传用户对挂起确认的决定（B1-④ 三档信任） */
export type ApproveParams = {
  toolCallId: string;
  allow: boolean;
  /** 本会话允许：该工具本会话内不再询问（内存记忆） */
  session?: boolean;
  /** 一直允许：该工具跨会话不再询问（持久化规则） */
  persist?: boolean;
  /** 写"本会话允许"记忆时按哪个会话记 */
  sessionId?: string;
};

/** POST /api/chat/approve → 成功返回 */
export type ApproveResult = { ok: true; allow: boolean };

/** 审批模式（B1-②）：suggest 默认（只读放行+弹框）/ bypass 全放 / never 全拒 */
export type ApprovalMode = "suggest" | "bypass" | "never";

/** GET /api/chat/approval-mode → 当前审批模式 */
export type ApprovalModeInfo = { mode: ApprovalMode };

/** POST /api/chat/approval-mode → 切换成功 */
export type ApprovalModeResult = { ok: true; mode: ApprovalMode };

/** POST /api/chat/stop 参数 */
export type StopRunParams = { runId: string };

/** POST /api/chat/stop → 成功返回 */
export type StopRunResult = { ok: true; runId: string };

/** DELETE /api/chat?sessionId= → 成功返回 */
export type ClearHistoryResult = { ok: true; sessionId: string };

/** POST /api/chat 参数（SSE 流式接口，返回形状特殊，见 index.ts） */
export type SendMessageParams = { text: string; sessionId: string };

// ---- C13 斜杠命令（POST /api/chat/command + GET /api/chat/commands）----
// type-only import：lib/commands 的类型面无 node 依赖，前端 bundle 安全。
import type { CommandDescriptor, CommandResult } from "@/lib/commands";

/** GET /api/chat/commands → 命令列表（slashCatalog 快照数据源） */
export type CommandsResult = { commands: CommandDescriptor[] };

/** POST /api/chat/command 参数：完整命令行 */
export type ExecuteCommandParams = { line: string; sessionId: string };

/** POST /api/chat/command → 命令执行结果（不走模型） */
export type ExecuteCommandResult = { result: CommandResult };

export type { CommandDescriptor, CommandResult };

// ---- A3 轨迹（GET /api/traces + GET /api/traces/<runId>）----
// type-only import：`import type` 编译期整体擦除，所以哪怕 lib/trace 依赖 node:fs
// 也不会被拖进客户端 bundle。**别改成值导入**——那会把 node:fs 带进浏览器。
import type { TraceEntry, TraceMeta } from "@/lib/trace";

/** GET /api/traces?sessionId= → 该会话的全部 run（按时间升序，下标即 runIndex） */
export type TraceRunsResult = { sessionId: string; runs: TraceMeta[] };

/** GET /api/traces/<runId>?sessionId= → 一个 run 的元信息 + 全部条目 */
export type TraceRunResult = {
  sessionId: string;
  runId: string;
  meta: TraceMeta;
  entries: TraceEntry[];
};
