// ============================================================
// 事件折叠 —— 把原始 AgentEvent 流折叠成「走纸记录条」的行（纯函数）
// ============================================================
//
// 轨迹区不是日志列表，它做了三件聚合（都在 foldEvents 里）：
//   1. turn_start                  → 开一条轮次带 T1 / T2
//   2. 连续的 message_update        → 收成一笔墨迹（长度随字数增长）
//   3. tool_execution_start/end    → 配成一段跨度（条长 = 真实耗时）
//
// 实测一次「列出工作区文件」的真实 run：105 条 message_update + 12 条
// 其它事件。一行一条事件的画法会被 delta 淹没，所以按语义聚合，
// 105 条塌成 2 行。
// ============================================================

import type { AgentEvent, TextContent, ToolCallContent } from "@/lib/types";
import type { ObservedEvent } from "./sse";
import { textLength } from "./format";

export type TraceRow = {
  pen: "turn" | "user" | "model" | "tool" | "signal" | "error";
  kind: "band" | "stroke" | "span" | "signal";
  label: string;
  note?: string;
  size?: number; // stroke 用字数，span 用毫秒
  live?: boolean;
  ok?: boolean;
  callId?: string;
  startedAt?: number;
};

export function foldEvents(observed: ObservedEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const item of observed) foldOne(rows, item);
  return rows;
}

/** 底部统计：轮次数 / 工具调用数 / token 用量 */
export function traceStats(observed: ObservedEvent[]) {
  let turns = 0;
  let tools = 0;
  let tokens = 0;

  for (const { event } of observed) {
    if (event.type === "turn_start") turns = event.turn;
    if (event.type === "tool_execution_end") tools += 1;
    if (event.type === "message_end" && event.message.role === "assistant") {
      tokens += event.message.usage.totalTokens;
    }
  }

  return { turns, tools, tokens };
}

function foldOne(rows: TraceRow[], item: ObservedEvent): void {
  const event = item.event;

  switch (event.type) {
    case "agent_start":
      rows.push(signal("RUN 开始"));
      break;
    case "agent_end":
      rows.push(signal("RUN 结束", `${event.messages.length} 条消息`));
      break;
    case "turn_start":
      rows.push({ pen: "turn", kind: "band", label: `T${event.turn}` });
      break;
    case "message_start":
      foldMessageStart(rows, item);
      break;
    case "message_update":
      bumpStroke(rows, event.delta.length);
      break;
    case "message_end":
      sealStroke(rows, item);
      break;
    case "tool_execution_start":
      rows.push(openSpan(event.toolName, event.toolCallId, item.at));
      break;
    case "tool_execution_end":
      closeSpan(rows, event.toolCallId, event.isError, item.at);
      break;
    case "tool_permission":
      foldPermission(rows, event);
      break;
    case "compaction":
      rows.push(signal("上下文压缩", `${event.tokensBefore} tokens`));
      break;
    case "turn_end":
      break; // 轮次的收尾信息已由带内各行表达，不再单独记一行
  }
}

function signal(label: string, note?: string): TraceRow {
  return { pen: "signal", kind: "signal", label, note };
}

/** 用户消息进轨迹（模型消息交给墨迹行，工具结果交给跨度行） */
function foldMessageStart(rows: TraceRow[], item: ObservedEvent): void {
  if (item.event.type !== "message_start") return;
  const message = item.event.message;
  if (message.role !== "user") return;

  const chars = message.content.reduce((sum, block) => sum + block.text.length, 0);
  rows.push({ pen: "user", kind: "signal", label: "指令", note: `${chars} 字` });
}

/** 连续的流式增量只占一行，长度随字数增长 —— 一支笔画出的一条线 */
function bumpStroke(rows: TraceRow[], chars: number): void {
  const last = rows[rows.length - 1];
  if (last?.kind === "stroke" && last.live) {
    last.size = (last.size ?? 0) + chars;
    last.note = `${last.size} 字`;
    return;
  }
  rows.push({ pen: "model", kind: "stroke", label: "输出", size: chars, live: true, note: `${chars} 字` });
}

/** 模型消息收尾：给这一笔标上 token 用量；非流式模型在这里补出整笔 */
function sealStroke(rows: TraceRow[], item: ObservedEvent): void {
  if (item.event.type !== "message_end") return;
  const message = item.event.message;
  if (message.role !== "assistant") return;

  const last = rows[rows.length - 1];
  const tokens = `${message.usage.totalTokens} tok`;

  if (last?.kind === "stroke" && last.live) {
    last.live = false;
    last.note = `${last.size ?? 0} 字 · ${tokens}`;
    return;
  }

  const chars = textLength(message.content);
  rows.push({ pen: "model", kind: "stroke", label: "输出", size: chars, note: `${chars} 字 · ${tokens}` });
}

function openSpan(toolName: string, callId: string, at: number): TraceRow {
  return {
    pen: "tool",
    kind: "span",
    label: toolName,
    callId,
    startedAt: at,
    live: true,
  };
}

/** 用 toolCallId 把 end 配回它的 start，两条事件合成一段有长度的跨度 */
function closeSpan(rows: TraceRow[], callId: string, isError: boolean, at: number): void {
  const span = [...rows].reverse().find((row) => row.callId === callId && row.live);
  if (!span) return;

  span.live = false;
  span.ok = !isError;
  span.size = at - (span.startedAt ?? at);
}

/** 只记「有干预」的审批：放行是默认路径，记下来只会淹掉真正的信号 */
function foldPermission(
  rows: TraceRow[],
  event: Extract<AgentEvent, { type: "tool_permission" }>,
): void {
  if (event.action === "allow") return;

  const label = event.action === "block" ? "审批拦截" : "参数改写";
  const note = [event.toolName, event.reason].filter(Boolean).join(" · ");
  rows.push({
    pen: event.action === "block" ? "error" : "signal",
    kind: "signal",
    label,
    note,
  });
}
