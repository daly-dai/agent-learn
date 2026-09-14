// ============================================================
// run-fold.test.ts —— 会话 run 桶的纯折叠函数（B22）
// ============================================================
// 测 seam：foldRunFrame / deriveRunPhase / freshRun / applyHistory /
// applyCommandResult / EMPTY_RUN。纯函数无 React，直接喂帧断言桶变化。
// 语义对照源：原 use-agent-run.ts 的 applyFrame/send/resetLocal（施工前版本）。
// ============================================================

import { describe, expect, it } from "vitest";
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  SessionStats,
  TodoItem,
} from "@/lib/types";
import type { StreamFrame } from "../sse";
import {
  EMPTY_RUN,
  applyCommandResult,
  applyHistory,
  deriveRunPhase,
  foldRunFrame,
  freshRun,
} from ".";

// ---- 测试助手：造消息 / 造帧 ----

function userMsg(text: string, timestamp = 1): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistantMsg(text: string, timestamp = 2): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp,
  };
}

const STATS: SessionStats = { turns: 3, tools: 2, tokens: 1000 };
const TODOS: TodoItem[] = [
  { content: "装 zustand", status: "completed" },
  { content: "写 run-store", status: "in_progress" },
];

// ---- EMPTY_RUN / freshRun ----

describe("EMPTY_RUN / freshRun", () => {
  it("EMPTY_RUN：全空默认（idle、无结局、无挂起）", () => {
    expect(EMPTY_RUN.messages).toEqual([]);
    expect(EMPTY_RUN.loading).toBe(false);
    expect(EMPTY_RUN.lastOutcome).toBe("none");
    expect(EMPTY_RUN.pendingApproval).toBeNull();
    expect(EMPTY_RUN.pendingAsk).toBeNull();
    expect(deriveRunPhase(EMPTY_RUN)).toBe("idle");
  });

  it("freshRun 保留会话内容（messages/stats/todos），清 run 瞬态", () => {
    const base: typeof EMPTY_RUN = {
      ...EMPTY_RUN,
      messages: [userMsg("上一轮")],
      stats: STATS,
      todos: TODOS,
      contextPressure: { contextWindow: 128_000 },
      loading: true,
      error: "旧的报错",
      runId: "old-run",
      observed: [{ seq: 1, at: 1, event: { type: "agent_start" } }],
      pendingApproval: {
        toolCallId: "t1",
        toolName: "write_file",
        args: {},
      },
      lastOutcome: "error" as const,
    };
    const next = freshRun(base);

    // 会话内容跨 run 延续
    expect(next.messages).toEqual([userMsg("上一轮")]);
    expect(next.stats).toEqual(STATS);
    expect(next.todos).toEqual(TODOS);
    // run 瞬态清零
    expect(next.loading).toBe(false);
    expect(next.error).toBe("");
    expect(next.runId).toBe("");
    expect(next.observed).toEqual([]);
    expect(next.pendingApproval).toBeNull();
    expect(next.pendingAsk).toBeNull();
    expect(next.toolOutputs).toEqual({});
    expect(next.compacting).toBe(false);
    expect(next.commandFeedback).toBe("");
    expect(next.lastOutcome).toBe("none"); // 新 run 起点：绿/红点等下次结局
  });

  it("freshRun 不共享 EMPTY_RUN 的容器引用（防隐性原地改）", () => {
    const next = freshRun();
    expect(next.observed).not.toBe(EMPTY_RUN.observed);
    expect(next.toolOutputs).not.toBe(EMPTY_RUN.toolOutputs);
    // messages/todos 从 base 带引用是有意的（跨 run 延续大数组，折叠不原地改）
    expect(next.messages).toEqual([]);
  });
});

// ---- foldRunFrame：逐帧推进 ----

describe("foldRunFrame —— 帧折叠", () => {
  it("run 帧：写入 runId/model", () => {
    const next = foldRunFrame(EMPTY_RUN, {
      type: "run",
      runId: "run-1",
      model: "deepseek",
    });
    expect(next.runId).toBe("run-1");
    expect(next.model).toBe("deepseek");
  });

  it("event(message_start)：消息进转录稿 + observed 记录（seq 递增、at 注入）", () => {
    const msg = userMsg("你好");
    const next = foldRunFrame(EMPTY_RUN, {
      type: "event",
      event: { type: "message_start", message: msg },
    }, 42);
    expect(next.messages).toEqual([msg]);
    expect(next.observed).toEqual([
      { seq: 1, at: 42, event: { type: "message_start", message: msg } },
    ]);
  });

  it("event(message_update)：delta 追加到末尾 assistant 文本块", () => {
    const started = foldRunFrame(EMPTY_RUN, {
      type: "event",
      event: {
        type: "message_start",
        message: assistantMsg("第一段"),
      },
    });
    const updated = foldRunFrame(started, {
      type: "event",
      event: {
        type: "message_update",
        message: assistantMsg("第一段"),
        delta: "，续写",
      },
    });
    expect(updated.messages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "第一段，续写" }],
    });
  });

  it("event(message_end)：末尾消息整体替换为最终版", () => {
    const started = foldRunFrame(EMPTY_RUN, {
      type: "event",
      event: { type: "message_start", message: assistantMsg("草稿") },
    });
    const final = assistantMsg("最终版（含工具调用）");
    const ended = foldRunFrame(started, {
      type: "event",
      event: { type: "message_end", message: final },
    });
    expect(ended.messages).toEqual([final]);
  });

  it("非消息事件（agent_start）：只进时间线，不碰转录稿", () => {
    const base = foldRunFrame(EMPTY_RUN, {
      type: "event",
      event: { type: "message_start", message: userMsg("保留我") },
    });
    const next = foldRunFrame(base, {
      type: "event",
      event: { type: "agent_start" },
    });
    expect(next.messages).toEqual([userMsg("保留我")]); // 未被改动
    expect(next.observed).toHaveLength(2); // 两个事件都记录了
  });

  it("done 帧：权威替换 + 清挂起 + 复位 compacting + lastOutcome=done", () => {
    const busy = {
      ...EMPTY_RUN,
      loading: true,
      compacting: true,
      pendingApproval: { toolCallId: "t1", toolName: "write_file", args: {} },
      pendingAsk: { toolCallId: "t2", questions: [{ question: "继续吗？" }] },
    };
    const doneFrame: StreamFrame = {
      type: "done",
      messages: [userMsg("结果")],
      tools: [],
      runId: "run-9",
      stats: STATS,
      todos: TODOS,
      contextPressure: { contextWindow: 128_000, pressureTokens: 5000 },
    };
    const next = foldRunFrame(busy, doneFrame, 7);
    expect(next.messages).toEqual([userMsg("结果")]);
    expect(next.runId).toBe("run-9");
    expect(next.stats).toEqual(STATS);
    expect(next.todos).toEqual(TODOS);
    expect(next.contextPressure).toEqual({ contextWindow: 128_000, pressureTokens: 5000 });
    expect(next.pendingApproval).toBeNull();
    expect(next.pendingAsk).toBeNull();
    expect(next.compacting).toBe(false);
    expect(next.lastOutcome).toBe("done");
  });

  it("error 帧：写 error + 复位 compacting + lastOutcome=error（不动转录稿）", () => {
    const base = foldRunFrame(EMPTY_RUN, {
      type: "event",
      event: { type: "message_start", message: userMsg("已说了一半") },
    });
    const next = foldRunFrame({ ...base, compacting: true }, {
      type: "error",
      message: "网络断了",
    });
    expect(next.error).toBe("网络断了");
    expect(next.compacting).toBe(false);
    expect(next.lastOutcome).toBe("error");
    expect(next.messages).toEqual([userMsg("已说了一半")]); // 保留已收到的
  });

  it("tool_permission_request：pendingApproval 记录弹框内容", () => {
    const next = foldRunFrame(EMPTY_RUN, {
      type: "tool_permission_request",
      toolCallId: "t-77",
      toolName: "write_file",
      args: { path: "a.ts" },
    });
    expect(next.pendingApproval).toEqual({
      toolCallId: "t-77",
      toolName: "write_file",
      args: { path: "a.ts" },
    });
  });

  it("tool_output：按 toolCallId 累积流式输出", () => {
    const first = foldRunFrame(EMPTY_RUN, {
      type: "tool_output",
      toolCallId: "bash-1",
      text: "编译中",
    });
    const second = foldRunFrame(first, {
      type: "tool_output",
      toolCallId: "bash-1",
      text: "…完成",
    });
    const other = foldRunFrame(second, {
      type: "tool_output",
      toolCallId: "bash-2",
      text: "另一条",
    });
    expect(other.toolOutputs["bash-1"]).toBe("编译中…完成");
    expect(other.toolOutputs["bash-2"]).toBe("另一条");
  });

  it("tool_todo：整表替换任务清单", () => {
    const next = foldRunFrame(EMPTY_RUN, { type: "tool_todo", todos: TODOS });
    expect(next.todos).toEqual(TODOS);
  });

  it("ask_user_request：pendingAsk 记录提问卡片", () => {
    const next = foldRunFrame(EMPTY_RUN, {
      type: "ask_user_request",
      toolCallId: "ask-1",
      questions: [{ question: "继续吗？", options: [{ label: "继续" }] }],
    });
    expect(next.pendingAsk).toEqual({
      toolCallId: "ask-1",
      questions: [{ question: "继续吗？", options: [{ label: "继续" }] }],
    });
  });

  it("compacting：置位压缩中", () => {
    const next = foldRunFrame(EMPTY_RUN, { type: "compacting", tokensBefore: 90_000 });
    expect(next.compacting).toBe(true);
  });
});

// ---- deriveRunPhase：派生阶段（不落库） ----

describe("deriveRunPhase —— 状态点阶段（优先级：审批>提问>执行中>结局>空闲）", () => {
  it("空闲桶 → idle", () => {
    expect(deriveRunPhase(EMPTY_RUN)).toBe("idle");
  });

  it("loading → running", () => {
    expect(deriveRunPhase({ ...EMPTY_RUN, loading: true })).toBe("running");
  });

  it("挂起工具确认 → waiting-approval（即使 loading 也优先：run 等用户批）", () => {
    const busy = {
      ...EMPTY_RUN,
      loading: true,
      pendingApproval: { toolCallId: "t1", toolName: "write_file", args: {} },
    };
    expect(deriveRunPhase(busy)).toBe("waiting-approval");
  });

  it("挂起模型提问 → waiting-ask（同样压过 loading）", () => {
    const busy = {
      ...EMPTY_RUN,
      loading: true,
      pendingAsk: { toolCallId: "t2", questions: [{ question: "选一个" }] },
    };
    expect(deriveRunPhase(busy)).toBe("waiting-ask");
  });

  it("上次正常结束 → done（绿点依据；保持到下次 startRun）", () => {
    expect(deriveRunPhase({ ...EMPTY_RUN, lastOutcome: "done" })).toBe("done");
  });

  it("上次出错 → error", () => {
    expect(deriveRunPhase({ ...EMPTY_RUN, lastOutcome: "error" })).toBe("error");
  });

  it("审批与提问并存时审批优先", () => {
    const state = {
      ...EMPTY_RUN,
      pendingApproval: { toolCallId: "t1", toolName: "write_file", args: {} },
      pendingAsk: { toolCallId: "t2", questions: [{ question: "x" }] },
    };
    expect(deriveRunPhase(state)).toBe("waiting-approval");
  });
});

// ---- applyHistory / applyCommandResult ----

describe("applyHistory / applyCommandResult —— 冷会话恢复与命令回填", () => {
  it("applyHistory：历史消息/统计/todos/占用落桶", () => {
    const next = applyHistory(EMPTY_RUN, {
      messages: [userMsg("历史一")],
      stats: STATS,
      todos: TODOS,
      contextPressure: { contextWindow: 128_000, pressureTokens: 3000 },
    });
    expect(next.messages).toEqual([userMsg("历史一")]);
    expect(next.stats).toEqual(STATS);
    expect(next.todos).toEqual(TODOS);
    expect(next.contextPressure).toEqual({ contextWindow: 128_000, pressureTokens: 3000 });
    // 历史恢复不是 run：不动 loading/结局
    expect(next.loading).toBe(false);
    expect(next.lastOutcome).toBe("none");
  });

  it("applyHistory：todos/占用缺省时保留原桶值（不为空覆盖已有恢复值）", () => {
    const withTodos = applyHistory(EMPTY_RUN, {
      messages: [],
      stats: STATS,
      todos: TODOS,
    });
    const next = applyHistory(withTodos, { messages: [userMsg("更多")], stats: STATS });
    expect(next.todos).toEqual(TODOS); // 保留
    expect(next.contextPressure).toBeUndefined(); // 原来就没有
  });

  it("applyCommandResult：命令执行后整组回填 + 反馈文案", () => {
    const next = applyCommandResult(EMPTY_RUN, {
      messages: [userMsg("压缩后有卡片")],
      stats: STATS,
      todos: TODOS,
      contextPressure: { contextWindow: 128_000, pressureTokens: 1000 },
      feedback: "",
    });
    expect(next.messages).toEqual([userMsg("压缩后有卡片")]);
    expect(next.stats).toEqual(STATS);
    expect(next.todos).toEqual(TODOS);
    expect(next.contextPressure).toEqual({ contextWindow: 128_000, pressureTokens: 1000 });
    expect(next.commandFeedback).toBe("");
  });

  it("applyCommandResult：消息流没变时反馈文案兜底显示", () => {
    const next = applyCommandResult(EMPTY_RUN, {
      messages: [],
      stats: STATS,
      todos: [],
      contextPressure: undefined,
      feedback: "没有可压缩的历史",
    });
    expect(next.commandFeedback).toBe("没有可压缩的历史");
  });
});
