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
// 本版本是「非流式」：一次请求拿完整响应。引擎（agent.ts）内部会把它
// 拆成 message_start / message_update / message_end 生命周期事件，
// 所以前端看起来仍是"流式"的。
// 下一步升级「真·流式」：加 onDelta 回调，边收 token 边发 message_update。
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

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_MODEL,
          messages,
          ...(tools ? { tools } : {}),
          stream: false,
        }),
        signal: input.signal,
      });
    } catch (error) {
      // 用户中止：stopReason="aborted"，让引擎以"被中止"收尾
      if (input.signal?.aborted) {
        return {
          role: "assistant",
          content: [text("（请求已中止）")],
          stopReason: "aborted",
          usage: { input: 0, output: 0, totalTokens: 0 },
          timestamp: Date.now(),
        };
      }
      // 网络错误：转成受控的 AssistantMessage，而不是让进程崩掉
      return errorAssistant(
        "network",
        `网络请求失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // ② HTTP 错误（401 key 错 / 429 限流 / 500 服务端）
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return errorAssistant(
        "http",
        `DeepSeek API ${response.status} ${response.statusText}${
          bodyText ? `：${truncate(bodyText, 300)}` : ""
        }`,
      );
    }

    // ③ OpenAI response → 统一 AssistantMessage
    const data = (await response.json()) as OpenAiResponse;
    return toTeachingAssistantMessage(data);
  }
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
// 出模型后：OpenAI response → AssistantMessage
//
// 转换规则（对应 build-08-real-model.md）：
//   content        → { type:"text", text }
//   tool_calls[]   → ToolCallContent[]（arguments 要 JSON.parse）
//   finish_reason  → stopReason（tool_calls 或存在 tool call → toolUse）
// ------------------------------------------------------------
function toTeachingAssistantMessage(data: OpenAiResponse): AssistantMessage {
  const choice = data.choices?.[0];
  const message = choice?.message;
  const finishReason = choice?.finish_reason;

  const toolCalls: ToolCallContent[] = (message?.tool_calls ?? []).map((call) => ({
    type: "toolCall",
    id: call.id,
    name: call.function.name,
    // arguments 是 JSON 字符串；解析失败时包成 { _parseError }，
    // 让工具执行阶段自然报错（而不是在这里 throw 崩掉整个循环）
    arguments: safeJsonParse(call.function.arguments),
  }));

  const content: AssistantMessage["content"] = [];
  if (message?.content) {
    content.push(text(message.content));
  }
  content.push(...toolCalls);

  // 极端情况：既没有文本也没有工具调用 → 给个占位，避免空气泡
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
// 受控错误消息：stopReason="error" + errorMessage，让引擎安全收尾
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
