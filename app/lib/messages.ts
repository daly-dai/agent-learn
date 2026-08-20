// ============================================================
// 消息操作 —— 转录稿状态更新的两个纯函数
// ============================================================

import type { AgentMessage } from "@/lib/types";

/** 流式增量：把 delta 追加到末尾 assistant 消息的最后一个文本块 */
export function appendDelta(
  messages: AgentMessage[],
  delta: string,
): AgentMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (!last || last.role !== "assistant") return next;

  const content = [...last.content];
  const lastBlock = content[content.length - 1];
  if (lastBlock && lastBlock.type === "text") {
    content[content.length - 1] = { ...lastBlock, text: lastBlock.text + delta };
  } else {
    content.push({ type: "text", text: delta });
  }

  next[next.length - 1] = { ...last, content };
  return next;
}

/** message_end 时：把末尾消息整体替换成最终版（含工具调用块） */
export function replaceLast(
  messages: AgentMessage[],
  message: AgentMessage,
): AgentMessage[] {
  if (messages.length === 0) return messages;
  const next = [...messages];
  next[next.length - 1] = message;
  return next;
}
