// ============================================================
// summarize.ts —— 上下文压缩的摘要生成（B2 ③，对齐 pi compaction）
// ============================================================
//
// 解决的问题：compactIfNeeded 原先把旧消息"拼贴"成摘要（user:/assistant:
// 原文连起来），token 几乎不省。本模块把拼贴升级为【调模型生成结构化摘要】——
// 一次独立的 complete 请求，产出 pi 同款的 EXACT 结构（Goal/Progress/…），
// 并混入 DSH 的 Files and Code / Errors and Fixes 两段（coding agent 刚需）。
//
// 四家对照结论（详见 doc/02，源码已精读）：
//   - pi：独立请求 + 显式增量（previousSummary + UPDATE prompt）——选它（D1/D3）
//   - codex：服务端压缩（DeepSeek 无端点，不学）
//   - Reasonix：缓存对齐 + 经济性检查——缓存对齐"复杂度换钱"现在不划算（D1），
//     经济性检查在 route.ts 做（D6）
//   - DSH：缓存对齐 + 检查点格式——格式的 Files/Errors 段被吸收（D2）
//
// 职责边界：本模块只负责"把消息变成提示词 + 调模型 + 拿回摘要文本"。
// 不碰存储（sessionStore 管切点/落盘）、不碰路由（route.ts 管组合/降级）。
// ============================================================

import type { AgentMessage, ToolCallContent } from "./types";
import type { TeachingModel } from "./model";
import { createUserMessage, messageText } from "./message";

// toolResult 超长截断（pi：TOOL_RESULT_MAX_CHARS=2000，防止工具输出撑爆摘要请求）
const TOOL_RESULT_MAX_CHARS = 2000;

// ------------------------------------------------------------
// 提示词 ×3（抄 pi compaction.ts:424-498，格式吸收 DSH 的 Files/Errors 两段）
// ------------------------------------------------------------

/** 系统提示：只输出结构化摘要，不继续对话（pi 原文思想） */
export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

/** 第一次压缩：从零生成结构化摘要（pi EXACT 结构 + DSH 的 Files/Errors 段） */
export const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Files and Code
- [Files read or modified, with the specific facts that matter: exact paths, function names, key changes]

## Errors and Fixes
- [Problems hit and how they were resolved, so the same dead ends are not repeated]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** 增量更新（有 previousSummary 时用）：保留旧摘要全部信息 + 合并新消息（pi UPDATE） */
export const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Files and Code
- [Preserve previously touched files, add newly touched ones]

## Errors and Fixes
- [Preserve previous errors, add new ones]

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

// ------------------------------------------------------------
// 序列化：AgentMessage[] → 纯文本（pi utils.ts serializeConversation）
// ------------------------------------------------------------

/** 把消息序列化成摘要模型读的纯文本（[User]/[Assistant]/[Tool result]…） */
export function serializeConversation(messages: AgentMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const content = messageText(message);
      if (content) parts.push(`[User]: ${content}`);
    } else if (message.role === "assistant") {
      const texts: string[] = [];
      const toolCalls: string[] = [];

      // 分离文本块和工具调用
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          texts.push(block.text);
        } else if (block.type === "toolCall") {
          toolCalls.push(formatToolCall(block));
        }
      }

      if (texts.length > 0) parts.push(`[Assistant]: ${texts.join("\n")}`);

      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
      }
    } else if (message.role === "toolResult") {
      const content = messageText(message);

      if (content) {
        parts.push(
          `[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`,
        );
      }
    } else if (message.role === "compactionSummary") {
      // 旧摘要（多次压缩时可能出现）：原样带过去，供增量合并
      parts.push(`[Compaction summary]: ${message.summary}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * 工具调用序列化：参数只摘要成 key 列表（Reasonix D7）。
 * 为什么不全量 JSON：① 参数可能极长（bash 命令/子代理 prompt）——原样进
 * 摘要会撑爆请求；② 参数可能有敏感信息——不该泄漏进后续上下文。
 */
function formatToolCall(call: ToolCallContent): string {
  const keys = Object.keys(call.arguments);
  return `${call.name}({${keys.join(", ")}} (${keys.length} keys))`;
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

// ------------------------------------------------------------
// 生成：组装提示词 → 调模型 → 拿回摘要文本
// ------------------------------------------------------------

/**
 * 调模型生成（或增量更新）上下文摘要。
 * 失败/中止/空输出 → 返回 null（降级信号：调用方回退拼贴，保信息不崩）。
 * MOCK 模式根本不会调到这里（route.ts 判断 mockMode 直接拼贴）。
 */
export async function generateSummary(
  model: TeachingModel,
  messagesToSummarize: AgentMessage[],
  options: { previousSummary?: string; signal?: AbortSignal } = {},
): Promise<string | null> {
  // 有旧摘要 → 增量更新（UPDATE prompt）；否则从零生成
  const basePrompt = options.previousSummary
    ? UPDATE_SUMMARIZATION_PROMPT
    : SUMMARIZATION_PROMPT;

  const conversationText = serializeConversation(messagesToSummarize);

  // 组装提示词
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;

  // 添加旧摘要（有）
  if (options.previousSummary) {
    promptText += `<previous-summary>\n${options.previousSummary}\n</previous-summary>\n\n`;
  }

  // 添加基础提示词
  promptText += basePrompt;

  const result = await model.complete({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [createUserMessage(promptText)],
    // 摘要请求不带工具：不是让模型干活，是让模型写"工作总结"
    tools: [],
    signal: options.signal,
  });

  // 错误/中止 → 降级信号（不把假摘要当真的用）
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    return null;
  }

  const summary = messageText(result).trim();
  // 空输出 = 半截/失败（DSH D9：fail-closed，不落半截摘要）
  return summary.length > 0 ? summary : null;
}
