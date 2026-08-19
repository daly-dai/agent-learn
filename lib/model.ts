// ============================================================
// 模型接口 —— Agent 的"大脑"
// 对应 teaching-agent/src/server/agent/model.ts
// ============================================================

import type { AgentMessage, AssistantMessage, ToolDefinition } from "./types";

export type CompleteInput = {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
  /** 逐段文本增量回调：流式模型每吐一段文本就调一次；非流式模型可忽略 */
  onDelta?: (delta: string) => void;
};

export interface TeachingModel {
  complete(input: CompleteInput): Promise<AssistantMessage>;
}
