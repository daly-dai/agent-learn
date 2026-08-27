// ============================================================
// _pipeline/index.ts —— runPipeline 编排（E2 步骤 4）
// ============================================================
// 一次 POST 请求的"编排层"：按序调用各阶段文件。
//   - 1b 落盘用户消息 + 读上下文
//   - 1c 组装工具注册表
//   - 2  跑 Agent Loop（引擎）
//   - 2b 落盘本轮新消息
//   - 2c 可能压缩
//   - 3  推 done 权威结果
//
// 边界（为什么这些留 route 壳、不进这里）：
//   - send（SSE 帧推送）、abort、req.signal、finalizeRun → route 壳
//     （Next.js 特有的请求生命周期，不该进编排层）
//   - 本文件只"编排"，不碰 SSE 管道细节。
//   - 未来新阶段（C13 斜杠命令 → commands.ts、C14 @注入 → mentions.ts）
//     在这里按序插入，route 壳不动——这是"膨胀被结构挡住"的落点。
// ============================================================

import type { AgentMessage, ToolCallContent } from "@/lib/types";
import type { TeachingModel } from "@/lib/model";
import type { JsonlSessionStore } from "@/lib/session";
import type { TraceRecorder } from "@/lib/trace";
import { runAgentLoop, type ToolDecision } from "@/lib/agent";
import { config } from "@/lib/config";
import type { StreamFrame } from "./frames";
import { createPipelineTools } from "./tools";
import { maybeCompact } from "./compact";
import { askUserAnswer } from "./ask-user";

export type RunPipelineParams = {
  systemPrompt: string;
  model: TeachingModel;
  userMessage: AgentMessage;
  store: JsonlSessionStore;
  // 轨迹记录器
  recorder: TraceRecorder;
  send: (frame: StreamFrame) => void;
  signal: AbortSignal;
  workspaceRoot: string;
  /** 审批钩子（route 组装，含副作用：日志+弹框） */
  beforeToolCall: (call: ToolCallContent) => Promise<ToolDecision>;
};

// 运行整个 pipeline：用户消息 + 落盘 + Agent Loop + 压缩 + 推 done
export async function runPipeline(params: RunPipelineParams) {
  const {
    systemPrompt, model, userMessage, store, recorder,
    send, signal, workspaceRoot,
  } = params;

  // 1) 用户消息生命周期事件：既进 SSE（前端画气泡），也进轨迹（黑匣子）
  const userStart = { type: "message_start" as const, message: userMessage };
  const userEnd = { type: "message_end" as const, message: userMessage };
  
  // 轨迹记录器，记录用户消息开始事件
  recorder.record(userStart);
  // 发送用户消息开始事件
  send({ type: "event", event: userStart });
  // 轨迹记录器，记录用户消息结束事件
  recorder.record(userEnd);
  // 发送用户消息结束事件
  send({ type: "event", event: userEnd });

  // 1b) 多轮记忆的核心：先把用户消息落盘，再从叶子回溯出完整上下文。
  await store.appendMessage(userMessage);
  // 从叶子节点回溯出完整上下文
  const context = store.buildContext();

  // 1c) 每请求组装工具注册表（_pipeline/tools.ts）：
  //     todo/askUser 两个 hooks 闭包都在 tools.ts 内部统一绑定（传 recorder 拿 runId）。
  const toolRegistry = createPipelineTools({
    workspaceRoot,
    store,
    recorder,
    send,
  });

  // 2) 运行 Agent Loop。onEvent 同时落盘轨迹 + 推浏览器。
  const result = await runAgentLoop({
    // 系统提示词
    systemPrompt,
    // 上下文
    messages: context,
    // ·工具注册表
    tools: toolRegistry.definitions(),
    // 模型
    model,
    // 工具注册表
    toolRegistry,
    // 最大轮数
    maxTurns: config.agent.maxTurns,
    // 工具调用前审批钩子
    beforeToolCall: params.beforeToolCall,
    // 取消信号
    signal,
    // 工具调用输出
    onToolOutput: (toolCallId, text) => {
      send({ type: "tool_output", toolCallId, text });
    },
    // 轨迹记录器 + 推浏览器
    onEvent: (event) => {
      recorder.record(event);
      // 事件监听
      send({ type: "event", event });
    },
  });

  // 2b) 本轮新增的 assistant/toolResult 逐条落盘，成为下一轮的"记忆"
  for (const message of result.newMessages) {
    await store.appendMessage(message);
  }

  // 2c) 上下文超窗口时压缩（_pipeline/compact.ts，含 MOCK 降级）
  await maybeCompact({
    store,
    model,
    signal,
    onCompacting: (tokensBefore) => send({ type: "compacting", tokensBefore }),
  });

  // 3) 推送最终权威结果（全量历史 + 统计 + 任务清单）
  send({
    type: "done",
    messages: store.buildContext(),
    tools: toolRegistry.definitions(),
    runId: recorder.runId,
    stats: store.stats(),
    todos: store.getLatestTodos() ?? [],
  });
}
