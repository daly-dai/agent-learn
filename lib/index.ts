// ============================================================
// lib/index.ts —— agent 内核公共门面（facing）
// ============================================================
// 定位：lib/ 是 agent 内核（纯逻辑、无 UI、不反向依赖 app）。
// 本文件是**统一入口**：外部（app/）组装内核时从这里 import，
// 不要深路径直连 lib 内部文件（内部怎么拆，外面不关心）。
//
// 设计（2026-08-31 定）：
//   - agent 内核能力 = 引擎（runAgentLoop）+ 模型适配 + 会话 + 工具 + 类型
//   - 子模块门面：session/ 与 tools/ 各自有 index.ts（目录 = 模块边界），
//     这里再汇总一层"内核总入口"，方便 app 一次拿齐核心 API
//   - 红线不变：lib/agent.ts 改动仍需人工确认（AGENTS.md）
//   - 业务模块**不**进 lib（见 AGENTS.md 11.7：业务逻辑放 app/api/<模块>/_lib/）
// ============================================================

// 引擎核心（红线文件，改动需人工确认）
export { runAgentLoop } from "./agent";
export type { ToolDecision, BeforeToolCall } from "./agent";

// 类型（跨层共享的数据结构）
export type {
  AgentMessage,
  AgentEvent,
  TextContent,
  ToolCallContent,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CompactionSummaryMessage,
  ToolDefinition,
  ToolResult,
  Usage,
  TodoItem,
  SessionEntry,
  SessionStats,
  SessionResponse,
} from "./types";

// 消息构造
export { createUserMessage, messageText } from "./message";

// 模型适配（provider 差异关在这里）
export { selectModel } from "./selectModel";
export type { TeachingModel } from "./model";

// 会话（子模块门面：lib/session/index.ts）
export {
  JsonlSessionStore,
  SessionManager,
  isValidSessionId,
  summarizeEntries,
} from "./session";
export type { SessionSummary } from "./session";

// 工具系统（子模块门面：lib/tools/index.ts）
export { ToolRegistry, createToolRegistry } from "./tools";

// 压缩总结（B2：真摘要生成）
export { generateSummary } from "./summarize";

// 运行控制 / 轨迹 / 审批 / 提问（内核侧状态与能力）
export { runControllers } from "./runControl";
// 轨迹（A3）：TraceRecorder 写；readTrace / readTraceMeta 读单个文件；
// listTraceFiles 把"某个会话的轨迹文件"定位出来（唯一与布局耦合的模块）
export { TraceRecorder, readTrace, readTraceMeta } from "./trace";
export type { TraceEntry, TraceMeta } from "./trace";
export { listTraceFiles } from "./trace-files";
export type { TraceFile } from "./trace-files";
export { getApprovalMode, setApprovalMode } from "./approvalMode";
export { toolApprovals } from "./toolApproval";
export { userAnswers, makeAskKey, clearRun } from "./userAnswers";

// 命令面板（C13：lib/commands 子模块，命令=工具家族第二成员）
export { createCommandRegistry, toDescriptor, sortByName } from "./commands";
export type {
  CommandApi,
  CommandDescriptor,
  CommandInvocation,
  CommandRegistry,
  CommandResult,
  CommandSource,
  SlashCommand,
} from "./commands";
export { createCompactCommand } from "./commands/compact";
export { createClearCommand } from "./commands/clear";
export { createExportCommand } from "./commands/export";

// 配置（唯一配置入口）
export { config } from "./config";
