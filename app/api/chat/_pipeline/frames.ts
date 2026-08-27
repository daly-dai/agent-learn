// ============================================================
// _pipeline/frames.ts —— SSE 帧协议（E2 从 route.ts 拆出）
// ============================================================
// 前端 sse.ts 用同名类型来消费这些帧。协议独立成文件：
// 路由壳只负责"推帧"，帧长什么样归这里管。
// ============================================================

import type {
  AgentEvent,
  AgentMessage,
  SessionStats,
  TodoItem,
  ToolDefinition,
} from "@/lib/types";
import type { AskQuestion } from "@/lib/tools/ask-user";

// SSE 帧的联合类型（前端 sse.ts 用同名类型来消费）
export type StreamFrame =
  | { type: "run"; runId: string; model: string }
  | { type: "event"; event: AgentEvent }
  | {
      type: "done";
      messages: AgentMessage[];
      tools: ToolDefinition[];
      runId: string;
      // 会话级累计统计（读数盘）：done 时点由 store 从会话文件算出
      stats: SessionStats;
      // 任务清单（Phase 5）：叶子回溯取最新 todo 条目，前端面板权威恢复值
      todos: TodoItem[];
    }
  | { type: "error"; message: string }
  // 写/改/删工具需要人工确认：推给前端弹框，用户决定后回传 /api/chat/approve
  | {
      type: "tool_permission_request";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  // bash 命令的流式输出（旁路帧，不是 AgentEvent）：工具 → 这里 → SSE → 前端
  | { type: "tool_output"; toolCallId: string; text: string }
  // todo_write 更新任务清单（旁路帧，Phase 5）：工具 → 落盘会话 → 这里 → 前端面板
  | { type: "tool_todo"; todos: TodoItem[] }
  // ask_user_question 提问（旁路帧，A4）：模型 → 这里 → 前端逐题作答等用户回答
  | { type: "ask_user_request"; toolCallId: string; questions: AskQuestion[] }
  // 上下文压缩开始（B2）：调模型生成摘要期间推此帧，前端显示"正在压缩上下文"，
  // 避免用户以为卡住（压缩是耗时的后台动作，可观测性边界）
  | { type: "compacting"; tokensBefore: number };
