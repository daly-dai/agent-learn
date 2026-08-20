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

// --- 会话存储条目（JSONL 会话文件的一行） ---
// 会话树：id 唯一，parentId 指向前一条（叶子 leafId = 当前最新）。
// 为什么有 parentId：Phase 2 要做分支切换（一条对话可以岔出多条线），
// 没有它就只能线性追加，无法回溯到任意历史节点重新分支。
// compaction 条目记录「旧消息摘要」：上下文超窗口时用它替代被压缩的旧消息。
export type SessionEntry =
  | {
      type: "session";
      version: 1;
      id: string;
      timestamp: string;
      cwd: string;
    }
  | {
      type: "message";
      id: string;
      parentId: string | null;
      timestamp: string;
      message: AgentMessage;
    }
  | {
      type: "compaction";
      id: string;
      parentId: string | null;
      timestamp: string;
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
    };

// --- API 响应 ---

export type SessionResponse = {
  sessionId: string;
  messages: AgentMessage[];
  events: AgentEvent[];
  tools: ToolDefinition[];
};
