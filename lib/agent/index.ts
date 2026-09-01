import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  ToolCallContent,
  ToolDefinition,
  ToolResultMessage,
} from "../types";
import type { TeachingModel } from "../model";
import type { ToolRegistry } from "../tools";
import { createAssistantMessage, text } from "../message";

// ------------------------------------------------------------
// 审批决策：模型想调用工具时，由使用端决定「放行 / 拦截 / 改写参数」。
// 这是一个三选一的联合类型，靠 action 字段区分：
//   allow   放行（执行原参数）
//   block   拦截（不执行，生成一条 isError 的工具结果回给模型）
//   rewrite 改写（用新参数执行）
// ------------------------------------------------------------
export type ToolDecision =
  | { action: "allow"; reason?: string }
  | { action: "block"; reason: string }
  | { action: "rewrite"; args: Record<string, unknown>; reason?: string };

// beforeToolCall 是一个「钩子函数」：引擎在真正执行工具前先问一下使用端。
// 可以同步返回，也可以异步返回（所以是 Promise | 值）。
export type BeforeToolCall = (
  call: ToolCallContent,
) => Promise<ToolDecision> | ToolDecision;

// 运行 Agent 循环的选项。model / toolRegistry 都是「接口依赖」，
// 引擎不关心它们的具体实现，这叫依赖倒置：换模型、换工具都不用改引擎。
type RunAgentLoopOptions = {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  model: TeachingModel;
  toolRegistry: ToolRegistry;
  maxTurns?: number;
  beforeToolCall?: BeforeToolCall;
  // 事件回调：每产生一个事件就立刻调用一次（推送式通道）
  onEvent?: (event: AgentEvent) => void;
  // run 级取消：中止模型请求 + 传给工具（bash 用它杀命令）
  signal?: AbortSignal;
  // 工具执行中逐块输出（bash 的 stdout/stderr 流）。引擎不理解它，
  // 只原样透传给工具的 execute options.onChunk——这是"旁路"，不进事件流。
  onToolOutput?: (toolCallId: string, text: string) => void;
  // 注意：引擎不再有 onTodoWrite / onAskUser（业务字段）。
  // 业务 hooks 走「工厂参数 + 闭包烙」——route.ts 组装工具时直接烙进
  // todo/ask-user 的 execute 身体，引擎从头到尾不接触业务（贴 pi）。
};

function emitMessageLifecycle(
  message: AgentMessage,
  emit: (event: AgentEvent) => void,
): void {
  emit({ type: "message_start", message });

  // 只有 assistant 消息才拆成 text 块逐个发 update（模拟 token 流式）
  if (message.role === "assistant") {
    for (const block of message.content) {
      if (block.type === "text") {
        emit({ type: "message_update", message, delta: block.text });
      }
    }
  }

  emit({ type: "message_end", message });
}

// ------------------------------------------------------------
// 当审批结果为 block 时，不真正执行工具，而是「伪造」一条错误结果回给模型。
// 这样模型能继续往下走（看到"被拦截了"），而不是卡住。
// ------------------------------------------------------------
function createBlockedToolResult(
  toolCall: ToolCallContent,
  reason: string,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [text(`Tool call blocked: ${reason}`)],
    details: { blocked: true, reason },
    isError: true,
    timestamp: Date.now(),
  };
}

// ------------------------------------------------------------
// 真正执行工具，并把结果包装成 ToolResultMessage。
// 关键：无论成功还是抛错，都「不抛出异常」，
// 而是把错误也变成一个 isError=true 的 toolResult 返回给模型——
// 这样循环不会因为一个工具失败而整个崩掉。
// ------------------------------------------------------------
async function executeToolCall(
  toolCall: ToolCallContent,
  toolRegistry: ToolRegistry,
  toolOptions?: {
    signal?: AbortSignal;
    onChunk?: (text: string) => void;
  },
): Promise<ToolResultMessage> {
  try {
    const result = await toolRegistry.execute(
      toolCall.name,
      toolCall.arguments,
      toolOptions, // 原样透传：signal（取消）+ onChunk（bash 流式输出）
    );
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: result.content,
      details: result.details,
      isError: false,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [text(error instanceof Error ? error.message : String(error))],
      isError: true,
      timestamp: Date.now(),
    };
  }
}

// ------------------------------------------------------------
// 超过最大轮次时的「兜底消息」。stopReason="error" + errorMessage 标记，
// 让使用端知道这不是模型的正常回答，而是被循环上限截断的。
// ------------------------------------------------------------
function createLoopGuardrailMessage(maxTurns: number): AssistantMessage {
  return {
    role: "assistant",
    content: [
      text(`教学版 Agent 已达到最大轮次 ${maxTurns}，为避免无限循环已停止。`),
    ],
    stopReason: "error",
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp: Date.now(),
    errorMessage: "max_turns_exceeded",
  };
}

// ------------------------------------------------------------
// 审批的「默认值补齐」：如果使用端没传 beforeToolCall，就默认全部放行。
// 这一步很重要——它保证 decision 永远有值，后面代码就能放心用 decision.action，
// 而不需要处处写 `decision?.action`（可选链）。
// ------------------------------------------------------------
async function decideToolCall(
  toolCall: ToolCallContent,
  beforeToolCall: BeforeToolCall | undefined,
): Promise<ToolDecision> {
  return beforeToolCall ? await beforeToolCall(toolCall) : { action: "allow" };
}

// ============================================================
// runAgentLoop —— 引擎主体
// 入参：options；出参：{ newMessages, events }
// ============================================================
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<{
  newMessages: AgentMessage[];
  events: AgentEvent[];
}> {
  // --- 1. 初始化 ---

  // events 数组：事件的内置存储（拉取式通道）
  const events: AgentEvent[] = [];

  // emit 辅助函数：每个事件同时做两件事——
  //   ① push 进 events 数组（供最终 return）
  //   ② 立刻调用 onEvent（供流式消费者）
  const emit = (event: AgentEvent): void => {
    events.push(event);
    options.onEvent?.(event);
  };

  // 复制一份消息列表，避免 push 时改到调用方传入的原数组（副作用隔离）
  const context = [...options.messages];
  // 本轮新增的消息（最终 return 给调用方）
  const newMessages: AgentMessage[] = [];
  // 最大轮数，默认 16（与 config.agent.maxTurns 一致；防无限循环）
  const maxTurns = options.maxTurns ?? 16;

  emit({ type: "agent_start" });

  // --- 2. 主循环：最多 maxTurns 轮 ---
  for (let turn = 1; turn <= maxTurns; turn++) {
    emit({ type: "turn_start", turn });

    // 2a. 让模型"想"一次：给定系统提示词 + 当前上下文 + 工具列表
    //
    // 流式三连（真正逐 token）：
    //   message_start  先发一个空占位消息（前端据此建气泡）
    //   message_update 模型每吐一段文本就发一条 delta（前端累加）
    //   message_end    用完整最终消息收尾（含工具调用块）
    // 非流式模型（MockModel）不调 onDelta，最终消息仍由 message_end 送达，
    // 所以这条路径对两者都成立。
    const streamingMessage = createAssistantMessage([text("")]);

    emit({ type: "message_start", message: streamingMessage });

    const assistant = await options.model.complete({
      systemPrompt: options.systemPrompt,
      messages: context,
      tools: options.tools,
      signal: options.signal, // run 级取消：中止正在进行的模型请求
      onDelta: (delta) => {
        emit({ type: "message_update", message: streamingMessage, delta });
      },
    });

    // 2b. 模型的回复同时进入「上下文」和「本轮新增记录」
    context.push(assistant);
    newMessages.push(assistant);

    emit({ type: "message_end", message: assistant });

    // 2c. 模型层异常 / 被中止 → 受控收尾
    //    这里 return 不是"报错"，而是"安全停下并交出到目前为止的完整档案"：
    //    调用方需要 newMessages（已产生的半截对话）和 events（过程）来渲染，
    //    而不是 throw 一个异常导致前端只能白屏。
    if (
      assistant.stopReason === "error" ||
      assistant.stopReason === "aborted"
    ) {
      emit({ type: "turn_end", turn, message: assistant, toolResults: [] });
      emit({ type: "agent_end", messages: newMessages });
      return { newMessages, events };
    }

    // 2d. 提取工具调用块。
    //    `(block): block is ToolCallContent` 是「类型守卫 / 类型谓词」：
    //    告诉 TS "只要返回 true，这个 block 就一定是 ToolCallContent"，
    //    于是 filter 之后数组被窄化成 ToolCallContent[]，后面才能安全访问 .name/.id。
    const toolCalls = assistant.content.filter(
      (block): block is ToolCallContent => block.type === "toolCall",
    );

    // 没有工具调用 → 说明模型已经给出最终答案，正常结束
    if (toolCalls.length === 0) {
      emit({ type: "turn_end", turn, message: assistant, toolResults: [] });
      emit({ type: "agent_end", messages: newMessages });
      return { newMessages, events };
    }

    // 2e. 逐个执行工具
    const toolResults: ToolResultMessage[] = [];

    for (const toolCall of toolCalls) {
      // --- 审批（allow / block / rewrite）---
      const decision = await decideToolCall(toolCall, options.beforeToolCall);

      // 只有"非放行"（block / rewrite）才发审计事件；
      // allow 太普通，不发，避免刷屏。
      if (decision.action !== "allow") {
        emit({
          type: "tool_permission",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          action: decision.action,
          reason: decision.reason,
          originalArgs: toolCall.arguments,
          args:
            decision.action === "rewrite" ? decision.args : toolCall.arguments,
        });
      }

      // block：不执行，伪造一条 isError 结果回给模型，然后跳到下一个工具
      if (decision.action === "block") {
        const blockedResult = createBlockedToolResult(
          toolCall,
          decision.reason,
        );

        toolResults.push(blockedResult);
        context.push(blockedResult);
        newMessages.push(blockedResult);

        emitMessageLifecycle(blockedResult, emit);
        continue;
      }

      // allow / rewrite：确定最终要用的工具调用。
      // rewrite 时用新参数覆盖原参数，其余字段（id/name）不变。
      const executableToolCall =
        decision.action === "rewrite"
          ? { ...toolCall, arguments: decision.args }
          : toolCall;

      // 发射"工具开始执行"事件（args 只传参数，不是整个 toolCall 对象）
      emit({
        type: "tool_execution_start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: executableToolCall.arguments,
      });

      // 真正执行工具。toolOptions：signal（取消）+ onChunk（bash 流式
      // 输出 → 引擎不懂它，只是把它转给使用端的 onToolOutput）。
      // 业务 hooks 不在这里——它们已由 route.ts 组装时闭包烙进工具的 execute。
      const toolResult = await executeToolCall(
        executableToolCall,
        options.toolRegistry,
        {
          signal: options.signal,
          onChunk: (text) => options.onToolOutput?.(toolCall.id, text),
        },
      );

      // 关键：工具结果必须 push 进 context，模型下一轮才能"看到"它，
      // 这就是 ReAct 的短期记忆机制。
      toolResults.push(toolResult);
      context.push(toolResult);
      newMessages.push(toolResult);

      // 先发"工具执行结束"，再发这条 toolResult 的消息生命周期事件
      emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: {
          content: toolResult.content,
          details: toolResult.details,
        },
        isError: toolResult.isError,
      });

      emitMessageLifecycle(toolResult, emit);
    }

    // 2f. 本轮结束，进入下一轮（模型会基于 context 里的新 toolResult 继续）
    emit({ type: "turn_end", turn, message: assistant, toolResults });
  }

  // --- 3. 超出最大轮次 → guardrail ---
  const guardrail = createLoopGuardrailMessage(maxTurns);

  newMessages.push(guardrail);
  emitMessageLifecycle(guardrail, emit);
  emit({ type: "agent_end", messages: newMessages });

  return { newMessages, events };
}
