// ============================================================
// run-fold —— 一桶会话 run 状态的纯折叠函数（B22，2026-09-02）
// ============================================================
// 多会话并行（session-owner）：run 状态归会话，UI 只投影。
// 本文件是"帧 → 桶状态"的纯折叠（无 React、无 IO、可单测），
// 对齐 DSH session-projection "领域是纯折叠单元，框架只驱动"：
//   - foldRunFrame(state, frame)：一帧推进一桶（原 use-agent-run applyFrame 的 switch）
//   - applyHistory / applyCommandResult：历史恢复 / 命令回填
//   - deriveRunPhase(state)：状态点/UI 用的派生阶段（不落库，每次渲染重算）
// 消费循环（谁发起 SSE、何时发）在 run-store.ts；本文件只管"状态怎么变"。
// ============================================================

import type {
  AgentMessage,
  SessionStats,
  TodoItem,
} from "@/lib/types";
import type { AskQuestion } from "@/lib/tools/ask-user";
import type { ContextPressure } from "@/app/lib/context-occupancy";
import type { ObservedEvent, StreamFrame } from "./sse";
import { appendDelta, replaceLast } from "./messages";

// ---- 桶状态类型 ----

/** 一次挂起的工具确认（前端弹框内容） */
export type ToolApprovalRequest = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

/** 一次挂起的模型提问（A4）：前端逐题作答，全部答完后回传 /api/chat/ask-user */
export type PendingAsk = {
  toolCallId: string;
  questions: AskQuestion[];
};

/** 上次 run 怎么结束的（绿点/状态点依据）。none = 从未跑过（或已被新 run 重置） */
export type RunOutcome = "none" | "done" | "error";

/** 一桶会话的完整 run 状态（= 原 useAgentRun 的全部 useState 集合） */
export type RunState = {
  messages: AgentMessage[];
  observed: ObservedEvent[];
  loading: boolean;
  error: string;
  runId: string;
  model: string;
  stats: SessionStats;
  pendingApproval: ToolApprovalRequest | null;
  pendingAsk: PendingAsk | null;
  toolOutputs: Record<string, string>;
  todos: TodoItem[];
  compacting: boolean;
  contextPressure: ContextPressure | undefined;
  commandFeedback: string;
  commandRunning: boolean;
  /** 上次 run 结局（startRun 时重置为 none；done/error 帧写入） */
  lastOutcome: RunOutcome;
};

/** 空会话的统计（读接口失败/清空后的兜底） */
const ZERO_STATS: SessionStats = { turns: 0, tools: 0, tokens: 0 };

export const EMPTY_RUN: RunState = {
  messages: [],
  observed: [],
  loading: false,
  error: "",
  runId: "",
  model: "",
  stats: ZERO_STATS,
  pendingApproval: null,
  pendingAsk: null,
  toolOutputs: {},
  todos: [],
  compacting: false,
  contextPressure: undefined,
  commandFeedback: "",
  commandRunning: false,
  lastOutcome: "none",
};

/** 从一份旧桶（或 EMPTY_RUN）复制出干净桶——切会话/新 run 起点 */
export function freshRun(base: RunState = EMPTY_RUN): RunState {
  return {
    ...base,
    // 新 run 起点：保留会话内容（messages/todos/stats/contextPressure——
    // 多轮对话跨 run 延续，原 send 不清 messages 同理），只清本次 run 的瞬态。
    // 各容器字段给新引用，避免与 EMPTY_RUN 共享数组（折叠从不原地改，
    // 但桶可能被调用方持有，共享引用是隐性雷）。
    observed: [],
    loading: false,
    error: "",
    runId: "",
    model: "",
    pendingApproval: null,
    pendingAsk: null,
    toolOutputs: {},
    compacting: false,
    commandFeedback: "",
    lastOutcome: "none",
  };
}

// ---- 派生（不落库，每次渲染重算；对齐 task-panel show 派生先例）----

export type RunPhase =
  | "idle" // 没在跑、没跑过（或正在历史恢复）
  | "running" // 正在执行
  | "waiting-approval" // 等用户批工具
  | "waiting-ask" // 等用户答模型提问
  | "done" // 上次 run 正常结束（绿点依据；保持到下次 startRun）
  | "error"; // 上次 run 出错

/**
 * 会话 run 阶段（列表状态点 / 决策区显示用）。
 * 优先级：审批 > 提问 > 执行中 > 上次结局 > 空闲。
 * 注意：loading 由消费循环（startRun）管理，不在帧折叠里——帧只管内容。
 */
export function deriveRunPhase(run: RunState): RunPhase {
  if (run.pendingApproval) return "waiting-approval";
  if (run.pendingAsk) return "waiting-ask";
  if (run.loading) return "running";
  if (run.lastOutcome === "error") return "error";
  if (run.lastOutcome === "done") return "done";
  return "idle";
}

// ---- 帧折叠 ----

/**
 * 一帧推进一桶：纯函数，返回新 RunState（不变则返回原引用）。
 * at 是观测时刻，由调用方注入（消费循环里 Date.now()；测试传固定值），
 * 保持本函数无副作用、可单测。
 */
export function foldRunFrame(
  state: RunState,
  frame: StreamFrame,
  at: number = Date.now(),
): RunState {
  switch (frame.type) {
    case "run":
      return { ...state, runId: frame.runId, model: frame.model };

    case "event": {
      const ev = frame.event;
      const observed: ObservedEvent[] = [
        ...state.observed,
        { seq: state.observed.length + 1, at, event: ev },
      ];
      // 事件内部再按消息事件折叠；其他事件类型只进时间线，不碰转录稿
      let messages = state.messages;
      switch (ev.type) {
        case "message_start":
          messages = [...messages, ev.message];
          break;
        case "message_update":
          messages = appendDelta(messages, ev.delta);
          break;
        case "message_end":
          messages = replaceLast(messages, ev.message);
          break;
        default:
          break;
      }
      return { ...state, observed, messages };
    }

    case "done":
      return {
        ...state,
        messages: frame.messages,
        runId: frame.runId,
        stats: frame.stats,
        contextPressure: frame.contextPressure,
        pendingApproval: null, // run 结束：服务端不再有挂起确认/提问，清掉
        pendingAsk: null,
        todos: frame.todos, // done 是任务清单权威值（tool_todo 只是过程）
        compacting: false,
        lastOutcome: "done",
      };

    case "error":
      return {
        ...state,
        error: frame.message,
        compacting: false,
        lastOutcome: "error",
      };

    case "tool_permission_request":
      return {
        ...state,
        pendingApproval: {
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          args: frame.args,
        },
      };

    case "tool_output":
      // bash 流式输出：按 toolCallId 累积（同一次调用多次到达）
      return {
        ...state,
        toolOutputs: {
          ...state.toolOutputs,
          [frame.toolCallId]: (state.toolOutputs[frame.toolCallId] ?? "") + frame.text,
        },
      };

    case "tool_todo":
      return { ...state, todos: frame.todos };

    case "ask_user_request":
      return {
        ...state,
        pendingAsk: {
          toolCallId: frame.toolCallId,
          questions: frame.questions,
        },
      };

    case "compacting":
      return { ...state, compacting: true };

    default:
      // StreamFrame 新增类型时，TS 在这里报漏了分支（穷尽性检查）
      return state;
  }
}

// ---- 历史恢复 / 命令回填（fetchHistory / runCommand 的结果落桶）----

/** 切到冷会话/刷新后：GET 历史 → 桶（不启动 run，只恢复现状） */
export function applyHistory(
  state: RunState,
  history: {
    messages: AgentMessage[];
    stats: SessionStats;
    todos?: TodoItem[];
    contextPressure?: ContextPressure;
  },
): RunState {
  return {
    ...state,
    messages: history.messages,
    stats: history.stats,
    todos: history.todos ?? state.todos,
    contextPressure: history.contextPressure ?? state.contextPressure,
  };
}

/** 命令执行后回填：消息流/统计/todos/上下文占用 + 反馈文案 */
export function applyCommandResult(
  state: RunState,
  result: {
    messages: AgentMessage[];
    stats: SessionStats;
    todos: TodoItem[];
    contextPressure: ContextPressure | undefined;
    feedback: string;
  },
): RunState {
  return {
    ...state,
    messages: result.messages,
    stats: result.stats,
    todos: result.todos,
    contextPressure: result.contextPressure,
    commandFeedback: result.feedback,
  };
}
