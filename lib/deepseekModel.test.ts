// ============================================================
// deepseekModel.test.ts —— 真实模型适配器单测（B16）
// ============================================================
// 思路（对齐 pi ai 包测试）：不 mock 网络——stub 全局 fetch 返回固定
// Response（JSON 或 SSE 流），断言「进模型前转换」与「出模型后转换」。
//
// 覆盖：
//   协议转换（进模型前）：
//     - toolResult → role:"tool" 且 tool_call_id 与 assistant.tool_calls[].id 配对
//     - compactionSummary → 伪装成 user 指令（模型无感）
//   响应转换（出模型后，非流式）：
//     - finish_reason=tool_calls → stopReason=toolUse
//     - 空内容 → FALLBACK_TEXT；坏 arguments JSON → {_parseError}
//   流式（SSE）：
//     - 坏 JSON 行被跳过（断流/网络抖动不崩）
//     - tool_call 参数分片累积 → 完整对象
//     - include_usage 的 usage chunk → message.usage
//   错误策略（两条路径共用）：
//     - HTTP 错误 / fetch 抛错 → 受控 stopReason="error"（不抛异常）
//     - signal 已中止 → stopReason="aborted"
// ============================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekModel } from "./deepseekModel";
import {
  createAssistantMessage,
  createCompactionSummaryMessage,
  createUserMessage,
  messageText,
  text,
} from "./message";
import type { AgentMessage, ToolCallContent } from "./types";

// ---------- fetch stub 辅助 ----------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 替换全局 fetch：捕获请求（url + init），返回固定 Response */
function stubFetch(
  responder: (
    url: string,
    init: RequestInit,
  ) => Response | Promise<Response>,
): { url: string; init: RequestInit; called: number } {
  const capture = { url: "", init: {} as RequestInit, called: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      capture.called += 1;
      capture.url = url;
      capture.init = init;
      return responder(url, init);
    }),
  );
  return capture;
}

/** 非流式 JSON 响应 */
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** SSE 流式响应：chunks 按原样进流（测试自己控制 \n 边界） */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** 从捕获的请求体里取 messages（OpenAI 格式） */
function capturedBody(capture: { init: RequestInit }): {
  model: string;
  messages: Array<Record<string, unknown>>;
} {
  return JSON.parse(capture.init.body as string);
}

function makeModel(): DeepSeekModel {
  return new DeepSeekModel({ apiKey: "test-key" });
}

// ---------- 协议转换（进模型前） ----------

describe("toOpenAiMessages —— 进模型前转换", () => {
  it("toolResult 转 role:tool 且 tool_call_id 与 assistant 的 tool_calls 配对", async () => {
    const capture = stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
      }),
    );

    const messages: AgentMessage[] = [
      createUserMessage("帮我查文件"),
      createAssistantMessage(
        [{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "a.txt" } }],
        "toolUse",
      ),
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read_file",
        content: [text("hello")],
        details: {},
        isError: false,
        timestamp: 0,
      },
    ];

    await makeModel().complete({ systemPrompt: "sp", messages, tools: [] });

    const { messages: sent } = capturedBody(capture);
    // 配对：tool 消息的 tool_call_id === assistant tool_calls[0].id
    const assistantMsg = sent.find((m) => m.role === "assistant");
    const toolMsg = sent.find((m) => m.role === "tool");
    expect(assistantMsg).toBeDefined();
    expect(toolMsg).toBeDefined();
    expect(
      (assistantMsg!.tool_calls as Array<{ id: string }>)[0].id,
    ).toBe("call_1");
    expect(toolMsg!.tool_call_id).toBe("call_1");
    // 工具结果的文本也带上了
    expect(toolMsg!.content).toBe("hello");
  });

  it("compactionSummary 伪装成 user 指令（模型无感，前端仍能认出压缩卡片）", async () => {
    const capture = stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
      }),
    );

    const messages: AgentMessage[] = [
      createCompactionSummaryMessage("## Goal\n写排序算法", 500, Date.now()),
      createUserMessage("继续"),
    ];

    await makeModel().complete({ systemPrompt: "sp", messages, tools: [] });

    const { messages: sent } = capturedBody(capture);
    const summaryMsg = sent[1];
    expect(summaryMsg!.role).toBe("user");
    expect(String(summaryMsg!.content)).toContain("以下是旧上下文摘要");
    expect(String(summaryMsg!.content)).toContain("写排序算法");
  });

  it("请求头带 Bearer 与 Content-Type，body 带 model", async () => {
    const capture = stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
      }),
    );

    await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
    });

    expect(capture.init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(capturedBody(capture).model).toBeTruthy();
  });
});

// ---------- 非流式响应转换 ----------

describe("非流式响应 → AssistantMessage", () => {
  it("finish_reason=tool_calls → stopReason=toolUse，工具调用参数解析", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "echo", arguments: '{"value":"x"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
    });

    expect(msg.stopReason).toBe("toolUse");
    const toolCall = msg.content.find(
      (b): b is ToolCallContent => b.type === "toolCall",
    );
    expect(toolCall?.name).toBe("echo");
    expect(toolCall?.arguments).toEqual({ value: "x" });
  });

  it("响应无内容 → 回退占位文本（不发出空消息）", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: null }, finish_reason: "stop" },
        ],
      }),
    );

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
    });

    expect(messageText(msg)).toBe("（模型未返回内容）");
  });

  it("工具参数坏 JSON → arguments 含 _parseError（保留原文供轨迹排查）", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "echo", arguments: "not-json" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
    });

    const toolCall = msg.content.find(
      (b): b is ToolCallContent => b.type === "toolCall",
    );
    expect(toolCall?.arguments).toEqual({ _parseError: "not-json" });
  });
});

// ---------- 流式（SSE） ----------

describe("流式 —— 逐 token 读取", () => {
  it("坏 JSON 行被跳过，正常 chunk 不受影响（断流不崩）", async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {bad json\n\n', // 坏 JSON：整行 parse 失败 → 跳过
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const deltas: string[] = [];
    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
      onDelta: (delta) => deltas.push(delta),
    });

    // 好 chunk 正常消费，坏行没影响
    expect(deltas).toEqual(["你", "好"]);
    expect(messageText(msg)).toBe("你好");
    expect(msg.stopReason).toBe("stop");
  });

  it("tool_call 参数分片累积 → 拼成完整对象（index 排序）", async () => {
    stubFetch(() =>
      sseResponse([
        // 第一个 chunk：id + name + arguments 前半段
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"value\\":"}}]}}]}\n\n',
        // 第二个 chunk：arguments 后半段
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
      // 关键：传 onDelta 才走流式路径（complete 用它的存在性分流）
      onDelta: () => {},
    });

    const toolCall = msg.content.find(
      (b): b is ToolCallContent => b.type === "toolCall",
    );
    expect(toolCall?.id).toBe("call_1");
    expect(toolCall?.name).toBe("echo");
    expect(toolCall?.arguments).toEqual({ value: "x" });
    expect(msg.stopReason).toBe("toolUse");
  });

  it("include_usage：流尾 usage chunk → message.usage", async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"结果"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
      // 关键：传 onDelta 才走流式路径（否则 response.json() 解析 SSE 文本会崩）
      onDelta: () => {},
    });

    expect(msg.usage).toEqual({ input: 10, output: 5, totalTokens: 15 });
  });
});

// ---------- 错误策略（两条路径共用） ----------

describe("错误策略 —— 不抛异常，转受控消息", () => {
  it("HTTP 500 → stopReason=error，errorMessage 含状态码", async () => {
    stubFetch(() => new Response("boom", { status: 500, statusText: "Internal Server Error" }));

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
    });

    expect(msg.stopReason).toBe("error");
    expect(msg.errorMessage).toContain("500");
    expect(messageText(msg)).toContain("[模型错误]");
  });

  it("fetch 抛错（网络失败）→ stopReason=error，不抛异常", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
    });

    expect(msg.stopReason).toBe("error");
    expect(msg.errorMessage).toContain("network down");
  });

  it("signal 已中止 → stopReason=aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(() => {
      throw new Error("This operation was aborted");
    });

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
      signal: controller.signal,
    });

    expect(msg.stopReason).toBe("aborted");
  });

  it("流式读中断（非中止）→ stopReason=error（stream 错误码）", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"半截"}}]}\n\n'));
        controller.error(new Error("stream broken"));
      },
    });
    stubFetch(() => new Response(body, { status: 200 }));

    const msg = await makeModel().complete({
      systemPrompt: "sp",
      messages: [createUserMessage("hi")],
      tools: [],
      // 关键：传 onDelta 才走流式路径（断流发生在流式读取中）
      onDelta: () => {},
    });

    expect(msg.stopReason).toBe("error");
    expect(msg.errorMessage).toContain("stream broken");
  });
});
