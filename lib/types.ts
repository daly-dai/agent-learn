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
// **会话是线性日志，不是树**（C18 砍树，2026-09-14）：条目按写入顺序排列，
// 顺序就是对话顺序，读的时候从头读到尾即可，不需要任何指针。
// 为什么砍掉原来的 parentId + switchLeaf：那套分支结构**生产代码零调用**、
// 落盘从不记 leafId、而 loadOrCreate 又假设「最后一行就是叶子」——结构支持分支、
// 加载不支持，是个自相矛盾的"预挖空壳"（违反不变量 3）。实测 39/39 个会话文件
// 完全线性、0 悬空 parentId → 砍掉对现存数据是**可证明的 no-op**。
// 将来真要做「改一条历史消息、重跑」，追加 `{type:"leaf", leafId}` 条目即可
// （`todo` 就是同款先例：状态变更靠追加条目表达，不靠改历史行）。
// compaction 条目记录「旧消息摘要」：上下文超窗口时用它替代被压缩的旧消息。
// todo 条目记录「任务清单快照」：模型每次整表替换，取最后一条。
export type SessionEntry =
  | {
      type: "session";
      /** 落盘格式版本。读取端只接受已知版本（见 `lib/session/store` 的版本校验）。
       *  为什么是 number 而不是字面量 `1`：字面量等于在**类型层**宣称"世上只有 v1"，
       *  读取端的校验就退化成同义反复——而版本号的意义恰恰是"文件可能来自别的版本"。 */
      version: number;
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
      timestamp: string;
      message: AgentMessage;
    }
  | {
      type: "compaction";
      id: string;
      timestamp: string;
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
    }
  | {
      type: "todo";
      id: string;
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
