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
};

export interface TeachingModel {
  complete(input: CompleteInput): Promise<AssistantMessage>;
}
