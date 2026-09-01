// ============================================================
// agent.test.ts —— 引擎循环单测（B16：引擎核心零测试补齐）
// ============================================================
// 覆盖（对齐 pi 引擎测试思想，packages/agent/test/agent-loop.test.ts）：
//   - 纯文本回复 → 正常结束，事件序列精确断言（pi agent.test.ts:172 同款）
//   - 工具调用 → toolResult 进 context → 第二轮模型能看到（ReAct 记忆闭环）
//   - block → 不执行工具、伪造 isError 结果进 context（spy 布尔断言没执行）
//   - rewrite → 用新参数执行，tool_permission 事件带 originalArgs/args 成对
//   - 工具抛错 → isError toolResult 回给模型，循环不崩（agent.ts:119 catch 分支）
//   - maxTurns 护栏 → 超限停止，产出 guardrail 消息
//   - 模型返回 error → 受控收尾（不执行工具、agent_end 正常发出）
//   - 默认 allow 不发 tool_permission；不改动调用方 messages；onEvent 双通道
//
// 不测（我们没实现，pi 有）：
//   - terminate 机制 / 并行工具执行 / length 截断保护（PLAN 遗留待办）
//   - 模型层抛错兜底（我们的引擎信任模型层不抛，DeepSeekModel 已统一转受控消息）
// ============================================================

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./index";
import { ToolRegistry } from "../tools";
import { createAssistantMessage, createUserMessage, messageText, text } from "../message";
import { FakeModel } from "../testing/fake-model";
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  ToolCallContent,
  ToolResultMessage,
  ToolResult,
} from "../types";
import type { ToolExecutor } from "../tools/types";

/** 造一条带 toolCall 的 assistant 消息 */
function assistantWithToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): AssistantMessage {
  return createAssistantMessage(
    [{ type: "toolCall", id, name, arguments: args }],
    "toolUse",
  );
}

/** 往注册表里注册一个记录调用的假工具（spy 模式，对齐 pi） */
function registerSpyTool(
  registry: ToolRegistry,
  name: string,
  execute: ToolExecutor,
): void {
  registry.register({
    name,
    description: `test tool ${name}`,
    parameters: { type: "object", properties: {} },
    execute,
  });
}

/** 造一个返回固定文本结果的 echo 工具；executed 记录收到的参数 */
function makeEchoTool(executed: Record<string, unknown>[]): ToolExecutor {
  return async (args): Promise<ToolResult> => {
    executed.push(args);
    return { content: [text(`echoed: ${String(args.value ?? "")}`)] };
  };
}

/** 构造一次 runAgentLoop 的最小参数（其余选项各测试自定） */
function baseOptions(overrides: {
  model: FakeModel;
  registry?: ToolRegistry;
  tools?: ToolCallContent[];
}): Parameters<typeof runAgentLoop>[0] {
  return {
    systemPrompt: "test system prompt",
    messages: [createUserMessage("hi")],
    tools: [],
    model: overrides.model,
    toolRegistry: overrides.registry ?? new ToolRegistry(),
  };
}

describe("runAgentLoop —— 正常路径", () => {
  it("纯文本回复 → 正常结束，事件序列精确（pi 同款 toEqual 断言）", async () => {
    const model = new FakeModel([createAssistantMessage([text("你好")])]);

    const { newMessages, events } = await runAgentLoop(baseOptions({ model }));

    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].role).toBe("assistant");
    expect(messageText(newMessages[0] as AssistantMessage)).toBe("你好");

    // 事件序列：pi agent.test.ts:172 同款精确断言（不是散点 toContain）
    expect(events.map((e) => e.type)).toEqual([
      "agent_start",
      "turn_start",
      "message_start",
      "message_end",
      "turn_end",
      "agent_end",
    ]);
  });

  it("工具调用 → toolResult 进 context，第二轮模型能看到（ReAct 记忆闭环）", async () => {
    const executed: Record<string, unknown>[] = [];
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "echo", { value: "hello" }),
      createAssistantMessage([text("完成")]),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "echo", makeEchoTool(executed));

    const { newMessages, events } = await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
    });

    // 工具被执行了一次，收到模型传的参数
    expect(executed).toEqual([{ value: "hello" }]);

    // 新消息 = assistant(toolCall) + toolResult + assistant(最终回答)
    expect(newMessages).toHaveLength(3);
    const toolResult = newMessages.find(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );
    expect(toolResult?.toolCallId).toBe("tool-1");
    expect(toolResult?.isError).toBe(false);
    expect(messageText(toolResult!)).toBe("echoed: hello");

    // 事件含工具执行起止
    const toolStart = events.find((e) => e.type === "tool_execution_start");
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolStart?.type === "tool_execution_start" && toolStart.toolName).toBe("echo");
    expect(toolEnd?.type === "tool_execution_end" && toolEnd.isError).toBe(false);

    // ReAct 记忆闭环：第二轮模型请求的 messages 里必须包含第一条 toolResult
    expect(model.calls).toHaveLength(2);
    const secondCallMessages = model.calls[1].messages;
    const seenResults = secondCallMessages.filter((m) => m.role === "toolResult");
    expect(seenResults).toHaveLength(1);
    expect((seenResults[0] as ToolResultMessage).toolCallId).toBe("tool-1");
  });

  it("onEvent 回调与 events 数组一致（双通道：拉取 + 推送）", async () => {
    const model = new FakeModel([createAssistantMessage([text("ok")])]);
    const seen: AgentEvent[] = [];

    const { events } = await runAgentLoop({
      ...baseOptions({ model }),
      onEvent: (event) => seen.push(event),
    });

    expect(seen).toEqual(events);
  });

  it("不改动调用方传入的 messages 数组（副作用隔离）", async () => {
    const model = new FakeModel([createAssistantMessage([text("ok")])]);
    const input: AgentMessage[] = [createUserMessage("hi")];
    const snapshot = [...input];

    await runAgentLoop({ ...baseOptions({ model }), messages: input });

    expect(input).toEqual(snapshot);
  });
});

describe("runAgentLoop —— 审批（beforeToolCall）", () => {
  it("block：不执行工具，伪造 isError 结果进 context，循环继续", async () => {
    let executed = false;
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "echo", { value: "x" }),
      createAssistantMessage([text("收到，已拦截")]),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "echo", async () => {
      executed = true;
      return { content: [text("不应执行")] };
    });

    const { newMessages, events } = await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
      beforeToolCall: async () => ({ action: "block", reason: "政策不允许" }),
    });

    // 工具绝不能被调用（pi agent-loop.test.ts:1306 同款 spy 断言）
    expect(executed).toBe(false);

    // 伪造的 isError 工具结果：内容 + details 标记
    const blockedResult = newMessages.find(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );
    expect(blockedResult?.isError).toBe(true);
    expect(messageText(blockedResult!)).toContain("Tool call blocked: 政策不允许");
    expect(blockedResult?.details).toEqual({
      blocked: true,
      reason: "政策不允许",
    });

    // 审计事件：action=block 且带原始参数
    const permission = events.find((e) => e.type === "tool_permission");
    expect(permission?.type === "tool_permission" && permission.action).toBe("block");
    expect(
      permission?.type === "tool_permission" && permission.originalArgs,
    ).toEqual({ value: "x" });

    // 关键：模型第二轮必须看到这条 isError 结果（block 不是丢弃，是"告知"）
    expect(model.calls).toHaveLength(2);
    const secondCallResults = model.calls[1].messages.filter(
      (m) => m.role === "toolResult",
    );
    expect(secondCallResults).toHaveLength(1);
    expect((secondCallResults[0] as ToolResultMessage).isError).toBe(true);
  });

  it("rewrite：用新参数执行，事件带 originalArgs/args 成对", async () => {
    const executed: Record<string, unknown>[] = [];
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "echo", { value: "old" }),
      createAssistantMessage([text("完成")]),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "echo", makeEchoTool(executed));

    const { events } = await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
      beforeToolCall: async () => ({
        action: "rewrite",
        args: { value: "new" },
        reason: "参数净化",
      }),
    });

    // 工具收到的是改写后的参数
    expect(executed).toEqual([{ value: "new" }]);

    // 审计事件：originalArgs = 模型原始参数，args = 改写后参数
    const permission = events.find((e) => e.type === "tool_permission");
    expect(
      permission?.type === "tool_permission" && permission.originalArgs,
    ).toEqual({ value: "old" });
    expect(permission?.type === "tool_permission" && permission.args).toEqual({
      value: "new",
    });
    expect(
      permission?.type === "tool_permission" && permission.action,
    ).toBe("rewrite");
  });

  it("不传 beforeToolCall → 默认全部放行，不发 tool_permission 事件", async () => {
    const executed: Record<string, unknown>[] = [];
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "echo", { value: "x" }),
      createAssistantMessage([text("完成")]),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "echo", makeEchoTool(executed));

    const { events } = await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
      // 不传 beforeToolCall
    });

    expect(executed).toHaveLength(1);
    // allow 太普通不发，避免刷屏（agent.ts 注释：只有非放行才发审计事件）
    expect(events.some((e) => e.type === "tool_permission")).toBe(false);
  });
});

describe("runAgentLoop —— 容错与护栏", () => {
  it("工具抛错 → isError toolResult 回给模型，循环不崩", async () => {
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "boom", {}),
      createAssistantMessage([text("我看到了错误")]),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "boom", async () => {
      throw new Error("磁盘炸了");
    });

    const { newMessages, events } = await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
    });

    // 抛错被转成 isError 工具结果，而不是把异常抛给调用方
    const errResult = newMessages.find(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );
    expect(errResult?.isError).toBe(true);
    expect(messageText(errResult!)).toContain("磁盘炸了");

    // 工具结束事件也标记 isError
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd?.type === "tool_execution_end" && toolEnd.isError).toBe(true);

    // 循环继续：模型第二轮仍被调用，且能看到错误结果
    expect(model.calls).toHaveLength(2);
    expect(
      model.calls[1].messages.some(
        (m) => m.role === "toolResult" && (m as ToolResultMessage).isError,
      ),
    ).toBe(true);
  });

  it("maxTurns 护栏：每轮都 toolCall 时超限停止，产出 guardrail 消息", async () => {
    // 每次 complete 都返回 toolCall（重复最后一条的序列即可，FakeModel 友好行为）
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "echo", { value: "1" }),
      assistantWithToolCall("tool-2", "echo", { value: "2" }),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "echo", makeEchoTool([]));

    const { newMessages, events } = await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
      maxTurns: 2,
    });

    // 收尾消息：guardrail（stopReason=error + errorMessage 标记）
    const last = newMessages[newMessages.length - 1] as AssistantMessage;
    expect(last.role).toBe("assistant");
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toBe("max_turns_exceeded");
    expect(messageText(last)).toContain("最大轮次 2");

    // 只跑了 2 轮（turn_start 出现 2 次），agent_end 正常发出
    expect(events.filter((e) => e.type === "turn_start")).toHaveLength(2);
    expect(events[events.length - 1].type).toBe("agent_end");
  });

  it("模型返回 stopReason=error → 受控收尾（不执行工具、agent_end 正常发出）", async () => {
    const model = new FakeModel([
      {
        role: "assistant",
        content: [text("[模型错误] 服务不可用")],
        stopReason: "error",
        usage: { input: 0, output: 0, totalTokens: 0 },
        timestamp: Date.now(),
        errorMessage: "http: 500",
      },
    ]);
    const registry = new ToolRegistry();
    let executed = false;
    registerSpyTool(registry, "echo", async () => {
      executed = true;
      return { content: [text("不该执行")] };
    });

    const { newMessages, events } = await runAgentLoop(baseOptions({ model, registry }));

    // 错误消息原样交付，工具不被调用
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].role).toBe("assistant");
    expect(executed).toBe(false);

    // 受控收尾：agent_end 正常发出（不是 throw，前端不会白屏）
    expect(events[events.length - 1].type).toBe("agent_end");
  });

  it("onToolOutput 旁路：工具 onChunk 原样透传给使用端", async () => {
    const model = new FakeModel([
      assistantWithToolCall("tool-1", "stream", {}),
      createAssistantMessage([text("完成")]),
    ]);
    const registry = new ToolRegistry();
    registerSpyTool(registry, "stream", async (_args, options) => {
      options?.onChunk?.("第一块");
      options?.onChunk?.("第二块");
      return { content: [text("done")] };
    });

    const outputs: Array<[string, string]> = [];
    await runAgentLoop({
      ...baseOptions({ model, registry }),
      tools: registry.definitions(),
      onToolOutput: (toolCallId, chunk) => outputs.push([toolCallId, chunk]),
    });

    expect(outputs).toEqual([
      ["tool-1", "第一块"],
      ["tool-1", "第二块"],
    ]);
  });
});
