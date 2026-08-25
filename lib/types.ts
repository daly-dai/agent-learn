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

/**
 * 旧上下文压缩摘要（B2，2026-08-25 新增）。
 * 为什么独立类型而不是伪装成 user：摘要既给模型（作为指令参考）
 * 又给前端（要展示成"压缩卡片"）。伪装成 user 会让前端把它当用户
 * 气泡渲染（多轮后页面出现一大坨 user:/assistant: 前缀文本）。
 * 独立类型让两端各自处理：模型侧转换时伪装 user（模型无感），
 * 前端侧渲染成折叠卡片（用户看清"旧内容已压缩"）。
 */
export type CompactionSummaryMessage = {
  role: "compactionSummary";
  /** 被压缩的旧对话摘要（文本） */
  summary: string;
  /** 压缩前的估算 token 数 */
  tokensBefore: number;
  timestamp: number;
};

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CompactionSummaryMessage;

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

// --- 任务（Phase 5 task 面板） ---
// todo 是会话事件不是独立存储（DSH 走读 07）：模型通过 todo_write 工具
// 整表替换维护，前端只读展示。三态对应 DSH/Reasonix 的 TodoItem。

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

// --- 会话存储条目（JSONL 会话文件的一行） ---
// 会话树：id 唯一，parentId 指向前一条（叶子 leafId = 当前最新）。
// 为什么有 parentId：Phase 2 要做分支切换（一条对话可以岔出多条线），
// 没有它就只能线性追加，无法回溯到任意历史节点重新分支。
// compaction 条目记录「旧消息摘要」：上下文超窗口时用它替代被压缩的旧消息。
// todo 条目记录「任务清单快照」：模型每次整表替换，叶子回溯取最新一条。
export type SessionEntry =
  | {
      type: "session";
      version: 1;
      id: string;
      timestamp: string;
      cwd: string;
      // 显示名（Phase 2 多会话）：可选；没有就回退用 id 显示。
      // 重命名只改这里，不改文件名——id 是身份，title 是给人看的名字。
      title?: string;
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
    }
  | {
      type: "todo";
      id: string;
      parentId: string | null;
      timestamp: string;
      todos: TodoItem[];
    };

// --- 会话统计（读数盘：会话级累计，由服务端从会话文件算出） ---
export type SessionStats = {
  /** 轮次 = assistant 消息数（每次模型调用产出一条 assistant 消息） */
  turns: number;
  /** 工具调用 = toolResult 消息数（每次工具执行产出一条 toolResult） */
  tools: number;
  /** token = 所有 assistant 消息 usage.totalTokens 之和 */
  tokens: number;
};

// --- API 响应 ---

export type SessionResponse = {
  sessionId: string;
  messages: AgentMessage[];
  events: AgentEvent[];
  tools: ToolDefinition[];
};
