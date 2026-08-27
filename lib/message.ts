// ============================================================
// 消息辅助函数
// 对应 teaching-agent/src/server/agent/message.ts
// ============================================================

import type {
  AgentMessage,
  AssistantMessage,
  CompactionSummaryMessage,
  TextContent,
  ToolCallContent,
  UserMessage,
} from "./types";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  totalTokens: 0,
};

export function text(text: string): TextContent {
  return { type: "text", text };
}

export function createUserMessage(input: string): UserMessage {
  return {
    role: "user",
    content: [text(input)],
    timestamp: Date.now(),
  };
}

export function createAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason,
    usage: EMPTY_USAGE,
    timestamp: Date.now(),
  };
}

/** 旧上下文压缩摘要消息（B2）：buildContext 压缩后用它替代被压缩的旧消息 */
export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: number,
): CompactionSummaryMessage {
  return { role: "compactionSummary", summary, tokensBefore, timestamp };
}

/** 从消息中提取纯文本（用于 MockModel 关键词匹配、摘要、会话预览等） */
export function messageText(message: AgentMessage): string {
  // compactionSummary 没有 content 数组（只有 summary 文本）——单独处理
  if (message.role === "compactionSummary") {
    return `（旧上下文压缩摘要）${message.summary}`;
  }
  // 注意：不用 filter(isTextContent)——message.content 在 AgentMessage
  // 联合类型下是「两种数组的联合」，类型守卫在联合数组上收窄不稳；
  // flatMap + 内联窄化（block.type === "text"）对两种数组都成立。
  // （2026-08-27：从 manager.ts 私有版收敛至此，统一分隔符与摘要处理）
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

export function isTextContent(
  block: TextContent | ToolCallContent,
): block is TextContent {
  return block.type === "text";
}
