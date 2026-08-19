// ============================================================
// DeepSeekModel —— 真实模型适配器（provider 差异关在这里）
// ============================================================
//
// 实现 TeachingModel 接口，用 fetch 调 DeepSeek 的 OpenAI 兼容接口：
//   https://api.deepseek.com/chat/completions
//
// 关键原则（对应 pi 的 pi-ai 层思想）：
//   provider 的字段只在"本文件"里出现；runAgentLoop 永远只看统一的
//   AssistantMessage / ToolCallContent。换模型、换供应商，只改这里。
//
// 两条转换边界：
//   进模型前：AgentMessage[]        → OpenAI messages
//   出模型后：OpenAI response       → AssistantMessage
//
// 两种模式：
//   - 非流式（input.onDelta 为空）：一次请求拿完整响应
//   - 真·流式（input.onDelta 提供）：stream:true，逐 token 读 SSE，
//     文本 delta 立刻回调 onDelta，工具调用参数按 index 累积，
//     finish 后统一 parse。
// ============================================================

import type {
  AgentMessage,
  AssistantMessage,
  ToolCallContent,
  ToolDefinition,
  Usage,
} from "./types";
import type { CompleteInput, TeachingModel } from "./model";
import { messageText, text } from "./message";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat"; // 支持工具调用；deepseek-reasoner 是思考模式，历史上不支持 function calling

export type DeepSeekModelOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

export class DeepSeekModel implements TeachingModel {

  constructor(private readonly options: DeepSeekModelOptions) {}

  async complete(input: CompleteInput): Promise<AssistantMessage> {
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const url = `${baseUrl}/chat/completions`;

    // ① 统一协议 → OpenAI 格式
    const messages = toOpenAiMessages(input.systemPrompt, input.messages);
    const tools = input.tools.length > 0 ? toOpenAiTools(input.tools) : undefined;

    // 临时调试日志：DEBUG_DEEPSEEK=true 时，打印这次请求的完整 messages + tools
    debugLog(this.options.model ?? DEFAULT_MODEL, url, messages, tools);

    // 有 onDelta 回调就走真·流式，否则走非流式
    return input.onDelta
      ? this.completeStreaming(url, input, messages, tools)
      : this.completeNonStreaming(url, input, messages, tools);
  }

  // ----------------------------------------------------------
  // 非流式：一次请求拿完整响应
  // ----------------------------------------------------------
  private async completeNonStreaming(
    url: string,
    input: CompleteInput,
    messages: OpenAiMessage[],
    tools: OpenAiTool[] | undefined,
  ): Promise<AssistantMessage> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_MODEL,
          messages,
          ...(tools ? { tools } : {}),
          stream: false,
        }),
        signal: input.signal,
      });
    } catch (error) {
      // 网络错误 / 用户中止：不抛异常，转成受控的 AssistantMessage
      if (input.signal?.aborted) return abortedMessage();
      return errorAssistant(
        "network",
        `网络请求失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      return errorAssistant("http", await httpErrorText(response));
    }

    const data = (await response.json()) as OpenAiResponse;
    return toTeachingAssistantMessage(data);
  }

  // ----------------------------------------------------------
  // 真·流式：逐 token 读 SSE，文本 delta 立即 onDelta 回调
  // ----------------------------------------------------------
  private async completeStreaming(
    url: string,
    input: CompleteInput,
    messages: OpenAiMessage[],
    tools: OpenAiTool[] | undefined,
  ): Promise<AssistantMessage> {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_MODEL,
          messages,
          ...(tools ? { tools } : {}),
          stream: true,
        }),
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) return abortedMessage();
      return errorAssistant(
        "network",
        `网络请求失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      return errorAssistant("http", await httpErrorText(response));
    }
    if (!response.body) {
      return errorAssistant("http", "响应体为空，无法流式读取。");
    }

    // 累积状态：文本直接累积成串；工具调用按 index 累积（OpenAI 流式
    // 里同一个 tool_call 的 arguments 会分成多个 chunk 到达）
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let textBuffer = "";
    let finishReason: string | undefined;
    
    const toolCallsAcc = new Map<number, { id?: string; name?: string; args: string }>();

    // 处理一个 SSE data chunk
    const consume = (chunk: OpenAiChunk) => {
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const delta = choice?.delta;
      if (!delta) return;

      // 文本增量 → 立刻推给 onDelta（这是"真·流式"的核心）
      if (typeof delta.content === "string" && delta.content.length > 0) {
        textBuffer += delta.content;
        input.onDelta?.(delta.content);
      }

      // 工具调用增量 → 按 index 累积，finish 后再 parse
      for (const tc of delta.tool_calls ?? []) {
        const acc = toolCallsAcc.get(tc.index) ?? { args: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        toolCallsAcc.set(tc.index, acc);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 按行解析；一行可能是半截，留到下一轮
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue; // 结束标记

          let chunk: OpenAiChunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // 忽略无法解析的行
          }
          consume(chunk);
        }
      }
    } catch (error) {
      // 中止 / 断流：把已累积文本作为 partial 返回，不崩
      if (input.signal?.aborted) {
        return {
          role: "assistant",
          content: textBuffer.length > 0 ? [text(textBuffer)] : [text("（请求已中止）")],
          stopReason: "aborted",
          usage: { input: 0, output: 0, totalTokens: 0 },
          timestamp: Date.now(),
        };
      }
      return errorAssistant(
        "stream",
        `流式读取中断：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return buildStreamMessage(textBuffer, toolCallsAcc, finishReason);
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.options.apiKey}`,
    };
  }
}

// ------------------------------------------------------------
// 流式累积 → 最终 AssistantMessage
// ------------------------------------------------------------
function buildStreamMessage(
  textBuffer: string,
  toolCallsAcc: Map<number, { id?: string; name?: string; args: string }>,
  finishReason: string | undefined,
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (textBuffer.length > 0) {
    content.push(text(textBuffer));
  }

  const toolCalls: ToolCallContent[] = [...toolCallsAcc.entries()]
    .sort((a, b) => a[0] - b[0]) // 按 index 排序，保证工具调用顺序
    .map(([, acc]) => ({
      type: "toolCall" as const,
      id: acc.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: acc.name ?? "",
      arguments: safeJsonParse(acc.args || "{}"),
    }));
  content.push(...toolCalls);

  if (content.length === 0) {
    content.push(text("（模型未返回内容）"));
  }

  return {
    role: "assistant",
    content,
    stopReason: finishReason === "tool_calls" || toolCalls.length > 0 ? "toolUse" : "stop",
    // 流式下精确 token 用量需 stream_options.include_usage（后续可补）
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp: Date.now(),
  };
}

// ------------------------------------------------------------
// 进模型前：AgentMessage[] → OpenAI messages
//
// 关键点：ToolResultMessage 必须转成 role:"tool" 且带 tool_call_id，
// 与上面 assistant 的 tool_calls[].id 对齐。丢了 id，模型就不知道
// 这个工具结果对应哪一次调用。
// ------------------------------------------------------------
function toOpenAiMessages(
  systemPrompt: string,
  messages: AgentMessage[],
): OpenAiMessage[] {
  const result: OpenAiMessage[] = [{ role: "system", content: systemPrompt }];

  for (const message of messages) {
    if (message.role === "user") {
      result.push({ role: "user", content: messageText(message) });
      continue;
    }

    if (message.role === "assistant") {
      const plainText = messageText(message);
      const toolCalls = message.content.filter(
        (block): block is ToolCallContent => block.type === "toolCall",
      );

      result.push({
        role: "assistant",
        // OpenAI 要求 content 为 string 或 null；纯工具调用消息给 null
        content: plainText.length > 0 ? plainText : null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  // arguments 在 OpenAI 协议里是 JSON 字符串
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            }
          : {}),
      });
      continue;
    }

    // toolResult → tool 消息
    result.push({
      role: "tool",
      tool_call_id: message.toolCallId,
      content: messageText(message),
    });
  }

  return result;
}

// ------------------------------------------------------------
// 工具定义 → OpenAI tools schema（function calling 格式）
// ------------------------------------------------------------
function toOpenAiTools(tools: ToolDefinition[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// ------------------------------------------------------------
// 出模型后：OpenAI response → AssistantMessage（非流式用）
// ------------------------------------------------------------
function toTeachingAssistantMessage(data: OpenAiResponse): AssistantMessage {
  const choice = data.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason;

  const toolCalls: ToolCallContent[] = (message?.tool_calls ?? []).map((call) => ({
    type: "toolCall",
    id: call.id,
    name: call.function.name,
    arguments: safeJsonParse(call.function.arguments),
  }));

  const content: AssistantMessage["content"] = [];
  if (message?.content) {
    content.push(text(message.content));
  }
  content.push(...toolCalls);

  if (content.length === 0) {
    content.push(text("（模型未返回内容）"));
  }

  const usage: Usage = {
    input: data.usage?.prompt_tokens ?? 0,
    output: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };

  return {
    role: "assistant",
    content,
    stopReason: finishReason === "tool_calls" || toolCalls.length > 0 ? "toolUse" : "stop",
    usage,
    timestamp: Date.now(),
  };
}

// ------------------------------------------------------------
// 受控错误 / 中止消息
// ------------------------------------------------------------
function errorAssistant(code: string, message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [text(`[模型错误] ${message}`)],
    stopReason: "error",
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp: Date.now(),
    errorMessage: `${code}: ${message}`,
  };
}

function abortedMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [text("（请求已中止）")],
    stopReason: "aborted",
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp: Date.now(),
  };
}

async function httpErrorText(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => "");
  return `DeepSeek API ${response.status} ${response.statusText}${
    bodyText ? `：${truncate(bodyText, 300)}` : ""
  }`;
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    // 保留原始串，方便在轨迹快照里看到"模型吐了什么坏 JSON"
    return { _parseError: raw };
  }
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}… [截断]`;
}

// ------------------------------------------------------------
// 临时调试日志：DEBUG_DEEPSEEK=true 时打印请求概览
// （默认关闭，不影响正常使用；不打印 Authorization 头，安全）
// ------------------------------------------------------------
function debugLog(
  model: string,
  url: string,
  messages: OpenAiMessage[],
  tools: OpenAiTool[] | undefined,
): void {
  if (process.env.DEBUG_DEEPSEEK !== "true") return;

  console.log("\n[DeepSeek] ============ 请求 ============");
  console.log("[DeepSeek] url:", url);
  console.log("[DeepSeek] model:", model);
  console.log("[DeepSeek] messages:");
  for (const m of messages) {
    const content = typeof m.content === "string" ? truncate(m.content, 200) : "(null)";
    console.log(`  - ${m.role}: ${content}`);
  }
  console.log("[DeepSeek] tools:", JSON.stringify(tools ?? [], null, 2));
  console.log("[DeepSeek] ============ end ============\n");
}

// ------------------------------------------------------------
// provider 侧类型（只在本文件可见，不污染 lib/types.ts）
// ------------------------------------------------------------
type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "tool"; content: string; tool_call_id: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OpenAiResponse = {
  choices?: Array<{
    message?: {
      role: "assistant";
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type OpenAiChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
};
