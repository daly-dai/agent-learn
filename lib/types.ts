// ============================================================
// 共享协议 —— Agent 的"语言"
// 前后端、loop、工具、存储全部基于这些类型通信
//
// 对应 teaching-agent/src/shared/protocol.ts
// ============================================================

// --- 内容块 ---

export type TextContent = {
  type: "text";
  text: string;
};

export type ToolCallContent = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

// --- 消息类型（联合类型） ---

export type UserMessage = {
  role: "user";
  content: TextContent[];
  timestamp: number;
};

export type AssistantMessage = {
  role: "assistant";
  content: Array<TextContent | ToolCallContent>;
  stopReason: "stop" | "toolUse" | "error" | "aborted";
  usage: Usage;
  timestamp: number;
  errorMessage?: string;
};

export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
};

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

// --- 用量 ---

export type Usage = {
  input: number;
  output: number;
  totalTokens: number;
};

// --- 工具定义 ---

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolResult = {
  content: TextContent[];
  details?: unknown;
  terminate?: boolean;
};

// --- Agent 事件（12 种事件类型，前端逐条展示） ---

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start"; turn: number }
  | {
      type: "turn_end";
      turn: number;
      message: AssistantMessage;
      toolResults: ToolResultMessage[];
    }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AssistantMessage; delta: string }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: ToolResult;
      isError: boolean;
    }
  | {
      type: "tool_permission";
      toolCallId: string;
      toolName: string;
      action: "allow" | "block" | "rewrite";
      reason?: string;
      originalArgs: Record<string, unknown>;
      args: Record<string, unknown>;
    }
  | { type: "compaction"; summary: string; tokensBefore: number; firstKeptEntryId: string };

// --- API 响应 ---

export type SessionResponse = {
  sessionId: string;
  messages: AgentMessage[];
  events: AgentEvent[];
  tools: ToolDefinition[];
};
