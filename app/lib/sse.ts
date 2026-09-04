// ============================================================
// SSE 客户端 —— 读取服务端事件流（纯 IO，不涉及 React）
// ============================================================
//
// 为什么要给事件补 seq/at：AgentEvent 协议里没有时间戳（PLAN.md
// 第四节说 Phase 0 才补）。前端作为「观测者」自己盖到达时间戳，
// 不改协议就能画出耗时与用时 —— 这是产品层的观测，不是引擎的职责。
// ============================================================

import type {
  AgentEvent,
  AgentMessage,
  SessionStats,
  TodoItem,
  ToolDefinition,
} from "@/lib/types";
import type { AskQuestion } from "@/lib/tools/ask-user";
import type { ContextPressure } from "@/app/lib/context-occupancy";

// SSE 帧的联合类型（服务端 route.ts 推送同名帧）
export type StreamFrame =
  | { type: "run"; runId: string; model: string }
  | { type: "event"; event: AgentEvent }
  | {
      type: "done";
      messages: AgentMessage[];
      tools: ToolDefinition[];
      runId: string;
      // 会话级累计统计（读数盘）：服务端从会话文件算出
      stats: SessionStats;
      // 任务清单（Phase 5）：权威恢复值
      todos: TodoItem[];
      // 当前上下文占用（C13 ContextMeter 数据源）
      contextPressure: ContextPressure;
    }
  | { type: "error"; message: string }
  // 写/改/删工具需要人工确认：前端弹框，用户决定后回传 /api/chat/approve
  | {
      type: "tool_permission_request";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  // bash 命令的流式输出（旁路帧）：按 toolCallId 累积显示，像真终端
  | { type: "tool_output"; toolCallId: string; text: string }
  // todo_write 更新任务清单（旁路帧，Phase 5）：前端面板实时更新
  | { type: "tool_todo"; todos: TodoItem[] }
  // ask_user_question 提问（旁路帧，A4）：前端逐题作答等用户回答
  | { type: "ask_user_request"; toolCallId: string; questions: AskQuestion[] }
  // 上下文压缩开始（B2）：后端在调模型生成摘要前推此帧，前端显示"正在压缩上下文"
  | { type: "compacting"; tokensBefore: number };

/** 事件 + 前端观测到它的时刻（协议不动，时间戳加在这一层） */
export type ObservedEvent = { seq: number; at: number; event: AgentEvent };

/** 逐块读 SSE，按空行切帧。signal：主动中止（删会话/停止时断流，不等服务端） */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: StreamFrame) => void,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (opts?.signal?.aborted) {
      reader.cancel().catch(() => {});
      throw new DOMException("流已被中止", "AbortError");
    }
    const { done, value } = await reader.read();

    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });

    let sep: number;

    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep).trim();

      buffer = buffer.slice(sep + 2);
      
      if (!raw.startsWith("data:")) continue;
      
      onFrame(JSON.parse(raw.slice(5).trim()) as StreamFrame);
    }
  }
}
