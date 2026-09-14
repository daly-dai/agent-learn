// ============================================================
// trace-steps —— 把轨迹条目折叠成「记录 + 轮次大纲」（纯函数）
// ============================================================
//
// 输入：一个会话的多次 run（每个 run 一份 .traces/*.jsonl 的 entries）
// 输出：
//   records —— 按时间顺序的记录行（轨迹视图的主列表）
//   outline —— 轮次大纲（跳转锚点 + 封顶预览），用于导航"跳到某一轮"
//
// 为什么是纯函数而不是 hook：不含 React 状态/副作用（AGENTS.md 11.9）——
// node 环境直接单测，不用 jsdom。
//
// 三个聚合（对齐旧 trace-fold.ts 的三件事，但输出形态从"笔触/跨度"换成"记录"）：
//   1. turn_start                → 轮次分组 + 大纲锚点
//   2. 连续 message_update        → 收成一条 model 记录（字数累加，end 时补 token）
//   3. tool_execution_start/end  → 用 toolCallId 配成一条 tool 记录（带耗时）
//
// 会话级坐标（本模块存在的理由之一）：每个 run 的 seq 都从 1 开始，直接拼接
// 会重复。坐标 = `${runIndex}:${seq}`，跳转 / 选中 / 定位错误都用它。
// ============================================================

import type { AgentEvent, ToolResult } from "@/lib/types";
import type { TraceEntry } from "@/lib/trace";
import { messageText } from "@/lib/message";

/** 大纲预览的封顶长度（对齐 DSH session-turn-outline：prompt 50 / response 120） */
export const PROMPT_PREVIEW = 50;
export const RESPONSE_PREVIEW = 120;

/** 一次 run 的全部条目 + 它在会话里的序号（从 0 开始） */
export type TraceRun = {
  runIndex: number;
  entries: TraceEntry[];
};

export type TraceRecordKind = "user" | "model" | "tool" | "error" | "signal";

export type TraceRecord = {
  /** 会话级坐标 `${runIndex}:${seq}` —— 跨 run 唯一 */
  id: string;
  kind: TraceRecordKind;
  runIndex: number;
  /** 该 run 内的轮次号（来自 turn_start；每个 run 从 1 重新开始） */
  turn: number;
  /** 显示名：user/model → 「指令」「输出」；tool/error → 工具名 */
  label: string;
  /** 正文（user / model） */
  text?: string;
  /** 工具入参（压成一行 JSON 的字符串） */
  argsText?: string;
  /** 工具出参（正文文本；完整，由视图决定折叠多少） */
  resultText?: string;
  /** 数据列 */
  chars?: number;
  tokens?: number;
  durationMs?: number;
};

export type TraceTurn = {
  turn: number;
  /** 该轮属于哪一次 run —— 轮次号在每个 run 内从 1 重新开始，所以「第几轮」不唯一 */
  runIndex: number;
  /** 该轮 turn_start 的会话级坐标 —— 跳转锚点 */
  id: string;
  /** 首条人类指令的封顶预览 */
  prompt: string;
  /** 该轮最后一条助手回复的封顶预览 */
  response: string;
};

export type TraceOutline = {
  turns: TraceTurn[];
  /** 记录总数（工具栏读数） */
  steps: number;
  /** 出错记录的坐标，按出现顺序 —— 「下一个错误」按它跳 */
  errors: string[];
};

export type TraceFold = {
  records: TraceRecord[];
  outline: TraceOutline;
};

export function foldTrace(runs: TraceRun[]): TraceFold {
  const state: FoldState = {
    records: [],
    turns: [],
    errors: [],
    openTools: new Map(),
    runIndex: -1,
    turn: 0,
  };

  for (const run of [...runs].sort((a, b) => a.runIndex - b.runIndex)) {
    state.runIndex = run.runIndex;
    // 轮次与流式缓冲都是 run 内状态——每个 run 重置
    state.turn = 0;
    state.turnItem = undefined;
    state.model = undefined;
    state.openTools.clear();

    for (const entry of run.entries) {
      foldEvent(state, entry, `${run.runIndex}:${entry.seq}`);
    }
  }

  return {
    records: state.records,
    outline: { turns: state.turns, steps: state.records.length, errors: state.errors },
  };
}

// ------------------------------------------------------------
// 折叠状态（一次跑的中间态；用对象而不是一堆闭包变量，便于阅读）
// ------------------------------------------------------------

type OpenTool = { record: TraceRecord; startedAt: number };

type FoldState = {
  records: TraceRecord[];
  turns: TraceTurn[];
  errors: string[];
  openTools: Map<string, OpenTool>;
  runIndex: number;
  turn: number;
  /** 当前轮的纲要项（prompt/response 往它上面填） */
  turnItem?: TraceTurn;
  /** 正在累加的流式输出记录；message_end 封口 */
  model?: TraceRecord;
};

function foldEvent(state: FoldState, entry: TraceEntry, id: string): void {
  const event = entry.event;

  switch (event.type) {
    case "turn_start":
      openTurn(state, event, id);
      return;
    case "message_start":
      foldUserMessage(state, event, id);
      return;
    case "message_update":
      foldDelta(state, event.delta, id);
      return;
    case "message_end":
      foldMessageEnd(state, event, id);
      return;
    case "tool_execution_start":
      openTool(state, event, id, entry.ts);
      return;
    case "tool_execution_end":
      closeTool(state, event, entry.ts);
      return;
    case "tool_permission":
      foldPermission(state, event, id);
      return;
    case "compaction":
      state.records.push({
        id,
        kind: "signal",
        runIndex: state.runIndex,
        turn: state.turn,
        label: "上下文压缩",
        text: `${event.tokensBefore} tokens`,
      });
      return;
    default:
      // turn_end / agent_start / agent_end：轮次边界与 run 边界由视图表达，不占记录行
      return;
  }
}

function openTurn(
  state: FoldState,
  event: Extract<AgentEvent, { type: "turn_start" }>,
  id: string,
): void {
  state.turn = event.turn;
  state.model = undefined;
  state.turnItem = { turn: event.turn, runIndex: state.runIndex, id, prompt: "", response: "" };
  state.turns.push(state.turnItem);
}

/** 只有人类消息进记录（助手输出交给流式记录，工具结果交给工具记录） */
function foldUserMessage(
  state: FoldState,
  event: Extract<AgentEvent, { type: "message_start" }>,
  id: string,
): void {
  if (event.message.role !== "user") return;

  const body = messageText(event.message);
  state.records.push({
    id,
    kind: "user",
    runIndex: state.runIndex,
    turn: state.turn,
    label: "指令",
    text: body,
    chars: body.length,
  });

  // 大纲只认首条人类指令（同轮后续的 steering 不改预览）
  if (state.turnItem && !state.turnItem.prompt) {
    state.turnItem.prompt = clip(body, PROMPT_PREVIEW);
  }
}

/** 连续增量收成一条记录，长度随字数增长 */
function foldDelta(state: FoldState, delta: string, id: string): void {
  if (!state.model) {
    state.model = {
      id,
      kind: "model",
      runIndex: state.runIndex,
      turn: state.turn,
      label: "输出",
      text: "",
      chars: 0,
    };
    state.records.push(state.model);
  }
  state.model.text = `${state.model.text ?? ""}${delta}`;
  state.model.chars = (state.model.chars ?? 0) + delta.length;
}

/** 助手消息收尾：补 token；非流式模型（无 message_update）在这里补出整条 */
function foldMessageEnd(
  state: FoldState,
  event: Extract<AgentEvent, { type: "message_end" }>,
  id: string,
): void {
  if (event.message.role !== "assistant") return;
  const body = messageText(event.message);

  if (!state.model) {
    state.model = {
      id,
      kind: "model",
      runIndex: state.runIndex,
      turn: state.turn,
      label: "输出",
      text: body,
      chars: body.length,
    };
    state.records.push(state.model);
  }

  state.model.tokens = event.message.usage.totalTokens;
  if (state.turnItem) {
    state.turnItem.response = clip(body, RESPONSE_PREVIEW);
  }
  state.model = undefined;
}

function openTool(
  state: FoldState,
  event: Extract<AgentEvent, { type: "tool_execution_start" }>,
  id: string,
  startedAt: number,
): void {
  const record: TraceRecord = {
    id,
    kind: "tool",
    runIndex: state.runIndex,
    turn: state.turn,
    label: event.toolName,
    argsText: compactJson(event.args),
  };
  state.records.push(record);
  state.openTools.set(`${state.runIndex}:${event.toolCallId}`, { record, startedAt });
}

/** 用 toolCallId 把 end 配回它的 start，填出参 + 耗时 */
function closeTool(
  state: FoldState,
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
  at: number,
): void {
  const open = state.openTools.get(`${state.runIndex}:${event.toolCallId}`);
  // 孤儿 end（轨迹被截断 / 手工构造）：忽略，不造半条记录
  if (!open) return;

  open.record.resultText = toolResultText(event.result);
  open.record.durationMs = Math.max(0, at - open.startedAt);

  if (event.isError) {
    open.record.kind = "error";
    state.errors.push(open.record.id);
  }

  state.openTools.delete(`${state.runIndex}:${event.toolCallId}`);
}

/** 只记「有干预」的审批：放行是默认路径，记下来只会淹掉真正的信号 */
function foldPermission(
  state: FoldState,
  event: Extract<AgentEvent, { type: "tool_permission" }>,
  id: string,
): void {
  if (event.action === "allow") return;

  state.records.push({
    id,
    kind: "signal",
    runIndex: state.runIndex,
    turn: state.turn,
    label: event.action === "block" ? "审批拦截" : "参数改写",
    text: [event.toolName, event.reason].filter(Boolean).join(" · "),
  });
}

// ------------------------------------------------------------
// 纯辅助
// ------------------------------------------------------------

/** 压成单行 + 封顶——大纲预览与列表摘要共用 */
function clip(input: string, cap: number): string {
  const flat = input.replace(/\s+/g, " ").trim();
  return flat.length <= cap ? flat : `${flat.slice(0, cap)}…`;
}

/** 工具入参压成一行 JSON（失败时退化为 String，不抛） */
function compactJson(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function toolResultText(result: ToolResult): string {
  return result.content.map((block) => block.text).join("\n");
}
