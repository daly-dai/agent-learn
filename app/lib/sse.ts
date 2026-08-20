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
  ToolDefinition,
} from "@/lib/types";

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
    }
  | { type: "error"; message: string };

/** 事件 + 前端观测到它的时刻（协议不动，时间戳加在这一层） */
export type ObservedEvent = { seq: number; at: number; event: AgentEvent };

/** 逐块读 SSE，按空行切帧 */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
