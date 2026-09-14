// ============================================================
// trace-steps/index.test.ts —— 轨迹折叠的纯函数（A3）
// ============================================================
// 测 seam：foldTrace(runs) → { records, outline }。纯函数、无 React，
// 直接喂 TraceEntry[] 断言记录与大纲（AGENTS.md 6.5 同目录 + 11.9 纯函数）。
// 造数据只用到 lib/trace 的 TraceEntry 壳（seq/ts/event），runId 不参与折叠。
// ============================================================

import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentMessage, AssistantMessage, ToolResult } from "@/lib/types";
import type { TraceEntry } from "@/lib/trace";
import { PROMPT_PREVIEW, RESPONSE_PREVIEW, foldTrace, type TraceRun } from "./index";

// ---- 测试助手：造条目 / 消息 / 工具结果 ----

function entry(seq: number, event: AgentEvent, ts = 1_000): TraceEntry {
  return { seq, runId: "run_test", ts, event };
}

function user(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistant(text: string, totalTokens = 0): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { input: 0, output: 0, totalTokens },
    timestamp: 2,
  };
}

function toolResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function run(runIndex: number, entries: TraceEntry[]): TraceRun {
  return { runIndex, entries };
}

// ---- 一轮的最小骨架：turn_start → 指令 → 流式输出 → 收尾 ----

function oneTurn(): TraceEntry[] {
  return [
    entry(1, { type: "agent_start" }),
    entry(2, { type: "turn_start", turn: 1 }),
    entry(3, { type: "message_start", message: user("你好") }),
    entry(4, { type: "message_update", message: assistant("你"), delta: "你" }),
    entry(5, { type: "message_update", message: assistant("你好"), delta: "好" }),
    entry(6, { type: "message_end", message: assistant("你好", 42) }),
    entry(7, { type: "turn_end", turn: 1, message: assistant("你好", 42), toolResults: [] }),
  ];
}

describe("foldTrace：用户与模型记录", () => {
  it("用户消息进记录、流式增量累加成一条、message_end 补 token", () => {
    const { records, outline } = foldTrace([run(0, oneTurn())]);

    expect(records).toHaveLength(2); // agent_start / turn_end 不占记录行
    expect(records[0]).toMatchObject({
      id: "0:3",
      kind: "user",
      runIndex: 0,
      turn: 1,
      label: "指令",
      text: "你好",
      chars: 2,
    });
    // 五条 message_update 会生成五个 id，但只有第一条开出记录（后续共用它）
    expect(records[1]).toMatchObject({
      id: "0:4",
      kind: "model",
      runIndex: 0,
      turn: 1,
      label: "输出",
      text: "你好",
      chars: 2,
      tokens: 42,
    });
    expect(outline).toEqual({
      turns: [{ turn: 1, runIndex: 0, id: "0:2", prompt: "你好", response: "你好" }],
      steps: 2,
      errors: [],
    });
  });

  it("非流式模型没有 message_update 时，由 message_end 补出整条记录", () => {
    const { records } = foldTrace([
      run(0, [
        entry(1, { type: "turn_start", turn: 1 }),
        entry(2, { type: "message_start", message: user("问") }),
        entry(3, { type: "message_end", message: assistant("一次给全", 7) }),
      ]),
    ]);

    expect(records[1]).toMatchObject({
      id: "0:3",
      kind: "model",
      text: "一次给全",
      chars: 4,
      tokens: 7,
    });
  });

  it("助手 message_start 不算指令（只有人类消息进记录）", () => {
    const { records } = foldTrace([
      run(0, [
        entry(1, { type: "turn_start", turn: 1 }),
        entry(2, { type: "message_start", message: assistant("我先说") }),
      ]),
    ]);

    expect(records).toEqual([]);
  });
});

describe("foldTrace：工具配对", () => {
  it("用 toolCallId 把 end 配回 start，填出参与耗时", () => {
    const { records } = foldTrace([
      run(0, [
        entry(
          1,
          { type: "tool_execution_start", toolCallId: "t1", toolName: "read_file", args: { path: "a.ts" } },
          1_000,
        ),
        entry(
          2,
          { type: "tool_execution_end", toolCallId: "t1", toolName: "read_file", result: toolResult("内容"), isError: false },
          1_250,
        ),
      ]),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "0:1",
      kind: "tool",
      label: "read_file",
      argsText: '{"path":"a.ts"}',
      resultText: "内容",
      durationMs: 250,
    });
  });

  it("两个工具交错时各配各的耗时（按 start 顺序留在列表里）", () => {
    const start = (seq: number, id: string, ts: number): TraceEntry =>
      entry(seq, { type: "tool_execution_start", toolCallId: id, toolName: id, args: {} }, ts);
    const end = (seq: number, id: string, ts: number): TraceEntry =>
      entry(
        seq,
        { type: "tool_execution_end", toolCallId: id, toolName: id, result: toolResult(id), isError: false },
        ts,
      );

    const { records } = foldTrace([
      run(0, [start(1, "a", 100), start(2, "b", 150), end(3, "b", 400), end(4, "a", 500)]),
    ]);

    expect(records.map((r) => r.label)).toEqual(["a", "b"]);
    expect(records[0].durationMs).toBe(400);
    expect(records[1].durationMs).toBe(250);
  });

  it("孤儿 tool_execution_end 被忽略，不造半条记录", () => {
    const { records, outline } = foldTrace([
      run(0, [
        entry(1, {
          type: "tool_execution_end",
          toolCallId: "ghost",
          toolName: "read_file",
          result: toolResult("谁在叫我"),
          isError: false,
        }),
      ]),
    ]);

    expect(records).toEqual([]);
    expect(outline.errors).toEqual([]);
  });

  it("isError 把工具记录改成 error，并把坐标按顺序记进 errors", () => {
    const { records, outline } = foldTrace([
      run(0, [
        entry(1, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} }),
        entry(2, {
          type: "tool_execution_end",
          toolCallId: "t1",
          toolName: "bash",
          result: toolResult("boom"),
          isError: true,
        }),
        entry(3, { type: "tool_execution_start", toolCallId: "t2", toolName: "bash", args: {} }),
        entry(4, {
          type: "tool_execution_end",
          toolCallId: "t2",
          toolName: "bash",
          result: toolResult("boom again"),
          isError: true,
        }),
      ]),
    ]);

    expect(records.map((r) => r.kind)).toEqual(["error", "error"]);
    expect(records[0].resultText).toBe("boom");
    expect(outline.errors).toEqual(["0:1", "0:3"]);
  });
});

describe("foldTrace：跨 run 的会话级坐标", () => {
  it("run 内 seq 会重号，坐标加 runIndex 前缀后跨 run 唯一", () => {
    const { records } = foldTrace([
      run(0, [entry(1, { type: "message_start", message: user("第一跑") })]),
      run(1, [entry(1, { type: "message_start", message: user("第二跑") })]),
    ]);

    expect(records.map((r) => r.id)).toEqual(["0:1", "1:1"]);
    expect(records.map((r) => r.runIndex)).toEqual([0, 1]);
  });

  it("传入顺序不影响结果（按 runIndex 排序），轮次在每个 run 内重新计数", () => {
    const second = run(1, [
      entry(1, { type: "turn_start", turn: 1 }),
      entry(2, { type: "message_start", message: user("第二跑") }),
    ]);
    const first = run(0, [
      entry(1, { type: "turn_start", turn: 1 }),
      entry(2, { type: "message_start", message: user("第一跑") }),
    ]);

    const { records, outline } = foldTrace([second, first]);

    expect(records.map((r) => r.text)).toEqual(["第一跑", "第二跑"]);
    expect(outline.turns.map((t) => t.id)).toEqual(["0:1", "1:1"]);
  });
});

describe("foldTrace：轮次大纲", () => {
  it("prompt 只认该轮首条人类指令，response 取最后一条助手回复", () => {
    const { records, outline } = foldTrace([
      run(0, [
        entry(1, { type: "turn_start", turn: 1 }),
        entry(2, { type: "message_start", message: user("原始指令") }),
        entry(3, { type: "message_start", message: user("中途插话") }),
        entry(4, { type: "message_end", message: assistant("第一次回答", 1) }),
        entry(5, { type: "message_end", message: assistant("最终回答", 2) }),
      ]),
    ]);

    expect(outline.turns).toEqual([
      { turn: 1, runIndex: 0, id: "0:1", prompt: "原始指令", response: "最终回答" },
    ]);
    // 记录行 = 2 条人类消息 + 2 条助手输出：message_end 是「助手消息」边界，
    // 不是「轮次」边界——没有待封口的流式记录时，每条 message_end 各开一条。
    expect(records.map((r) => r.kind)).toEqual(["user", "user", "model", "model"]);
    expect(outline.steps).toBe(4);
  });

  it("prompt 封顶 50、response 封顶 120，且换行被压成单行", () => {
    const longPrompt = `第一行\n\n${"甲".repeat(PROMPT_PREVIEW + 30)}`;
    const longResponse = "乙".repeat(RESPONSE_PREVIEW + 30);

    const { outline } = foldTrace([
      run(0, [
        entry(1, { type: "turn_start", turn: 1 }),
        entry(2, { type: "message_start", message: user(longPrompt) }),
        entry(3, { type: "message_end", message: assistant(longResponse, 1) }),
      ]),
    ]);

    const turn = outline.turns[0];
    expect(turn.prompt).toBe(`第一行 ${"甲".repeat(PROMPT_PREVIEW - 4)}…`);
    expect(turn.prompt).toHaveLength(PROMPT_PREVIEW + 1);
    expect(turn.response).toBe(`${"乙".repeat(RESPONSE_PREVIEW)}…`);
    expect(turn.response).toHaveLength(RESPONSE_PREVIEW + 1);
    // 记录行里是完整正文，封顶只发生在大纲（视图再决定折叠多少）
    expect(turn.response).not.toContain("乙".repeat(RESPONSE_PREVIEW + 1));
  });
});

describe("foldTrace：信号类记录", () => {
  it("审批 allow 不记（默认路径），block 与 rewrite 各记一条", () => {
    const permission = (seq: number, action: "allow" | "block" | "rewrite"): TraceEntry =>
      entry(seq, {
        type: "tool_permission",
        toolCallId: `t${seq}`,
        toolName: "bash",
        action,
        reason: action === "allow" ? undefined : "命令越界",
        originalArgs: {},
        args: {},
      });

    const { records } = foldTrace([
      run(0, [permission(1, "allow"), permission(2, "block"), permission(3, "rewrite")]),
    ]);

    expect(records.map((r) => r.label)).toEqual(["审批拦截", "参数改写"]);
    expect(records.map((r) => r.kind)).toEqual(["signal", "signal"]);
    expect(records[0].text).toBe("bash · 命令越界");
  });

  it("compaction 记成 signal 并带上压缩前的 token 数", () => {
    const { records } = foldTrace([
      run(0, [
        entry(1, {
          type: "compaction",
          summary: "旧消息摘要",
          tokensBefore: 12_345,
          firstKeptEntryId: "e9",
        }),
      ]),
    ]);

    expect(records[0]).toMatchObject({ kind: "signal", label: "上下文压缩", text: "12345 tokens" });
  });
});

describe("foldTrace：空输入", () => {
  it("没有任何 run 时返回空记录与空大纲", () => {
    expect(foldTrace([])).toEqual({
      records: [],
      outline: { turns: [], steps: 0, errors: [] },
    });
  });
});
