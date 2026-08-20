// ============================================================
// 格式化工具 —— 纯函数，只负责把数字/文本变成可读的展示
// ============================================================

import type { TextContent, ToolCallContent } from "@/lib/types";
import type { ObservedEvent } from "./sse";

/** 消息内容的总字数（只数文本块，工具调用块不算） */
export function textLength(
  content: Array<TextContent | ToolCallContent>,
): number {
  return content.reduce(
    (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
    0,
  );
}

/** 墨迹宽度：随字数增长，封顶 96px */
export function inkWidth(chars = 0): string {
  return `${Math.min(96, 8 + chars / 6)}px`;
}

/** 跨度条宽：随耗时增长，封顶 92px */
export function barWidth(ms = 0): string {
  return `${Math.min(92, 12 + ms / 20)}px`;
}

export function formatMs(ms = 0): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

export function formatElapsed(observed: ObservedEvent[]): string {
  if (observed.length < 2) return "—";
  return formatMs(observed[observed.length - 1].at - observed[0].at);
}

export function formatClock(timestamp?: number): string {
  if (!timestamp) return "";
  const time = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

export function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
