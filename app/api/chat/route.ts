// ============================================================
// API 路由 —— SSE 流式消费者（使用端）
// ============================================================
//
// 这里演示了「使用端如何实时接收 Agent 事件」的第二种方式（推送式）：
//   之前：runAgentLoop 跑完 → 把 events 一次性打包成 JSON 返回（拉取式）
//   现在：runAgentLoop 边跑 → onEvent 回调里立刻把事件写进 SSE 流（推送式）
//
// SSE（Server-Sent Events）是单向的"服务器 → 浏览器"流：每个事件是一行
//   data: {json}\n\n
// 浏览器用 fetch + ReadableStream 逐块读取，事件一到就立刻渲染。
//
// 本路由会依次推送以下帧（frame）：
//   { type: "run", runId, model }   本次 run 的元信息（前端据此展示）
//   { type: "event", event }        每个 Agent 事件（含用户消息 + Agent 内部事件）
//   { type: "done", ... }           循环结束后的最终权威结果
//   { type: "error", message }      出错信息
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import type {
  AgentEvent,
  AgentMessage,
  SessionStats,
  TodoItem,
  ToolCallContent,
  ToolDefinition,
} from "@/lib/types";
import { createUserMessage } from "@/lib/message";
import { MockModel } from "@/lib/mockModel";
import { DeepSeekModel } from "@/lib/deepseekModel";
import type { TeachingModel } from "@/lib/model";
import { createToolRegistry } from "@/lib/tools";
import type { AskQuestion } from "@/lib/tools/ask-user";
import { runAgentLoop, type ToolDecision } from "@/lib/agent";
import { TraceRecorder } from "@/lib/trace";
import { JsonlSessionStore, summarizeEntries } from "@/lib/session";
import { generateSummary } from "@/lib/summarize";
import { isValidSessionId } from "@/lib/session";
import type { StreamFrame } from "./_pipeline/frames";
import { systemPrompt } from "./_pipeline/prompt";
import { decideToolCall } from "./_pipeline/approval";
import { toolApprovals } from "@/lib/toolApproval";
import { userAnswers, makeAskKey, clearRun } from "@/lib/userAnswers";
import { runControllers } from "@/lib/runControl";
import { config, shouldCompact, compactKeepRecent } from "@/lib/config";
import { getApprovalMode } from "@/lib/approvalMode";
import { isReadOnlyBash } from "@/lib/permission/readonly";
import {
  appendApprovalReceipt,
  type ApprovalOutcome,
} from "@/lib/permission/approval-log";
import {
  isPersistApproved,
  isSessionApproved,
} from "@/lib/permission/approval-memory";

// 显式声明 Node runtime：本路由（以及它的工具）会用 node:fs / node:path，
// 后面 Phase 4 还要用 node:child_process 跑终端。
export const runtime = "nodejs";

// 路径与行为配置：全部来自 lib/config.ts（唯一入口，环境变量可覆盖）。
// 工作区根目录 / 轨迹目录 / 会话目录 / 压缩阈值 / 审批超时都收编在这里。
const { workspace: workspaceRoot, traces: traceDir, sessions: sessionDir } = config.paths;
// 工具注册表【不在这里建单例】（贴 pi create-harness）：
// 它在每次 POST 请求内组装，业务 hooks 闭包捕获当次的 store/send。

// systemPrompt 常量已拆到 _pipeline/prompt.ts（E2 阶段管线重构）

// StreamFrame 协议已拆到 _pipeline/frames.ts（E2 阶段管线重构）

// --- POST /api/chat ---
export async function POST(req: NextRequest) {
  let text: unknown;
  // Phase 2 多会话：body 可选传 sessionId，不传用 default
  let sessionId = "default";

  try {
    const body = await req.json();

    text = body?.text;
    
    if (typeof body?.sessionId === "string" && body.sessionId.trim()) {
      sessionId = body.sessionId.trim();
      // 安全：sessionId 会拼进文件路径，必须过白名单校验（见 sessionManager）
      if (!isValidSessionId(sessionId)) {
        return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "缺少 text 字段" }, { status: 400 });
  }

  // 模型选择：MOCK_MODE=true 用离线 Mock，否则用真实 DeepSeek。
  // 缺 key 时直接返回 400，让前端能显示清楚的错误，而不是崩在服务端。
  let model: TeachingModel;
  let modelLabel: string;
  try {
    const selected = selectModel();

    model = selected.model;
    modelLabel = selected.label;
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }

  const userMessage = createUserMessage(text.trim());

  // 会话存储：每次请求新建实例并从磁盘读全量。
  // 为什么不在模块级复用单例：多进程（dev server 多 worker / 未来部署）下
  // 内存态可能落后于磁盘，新建实例能保证「内存 = 磁盘」；会话文件小，读全量可接受。
  const store = new JsonlSessionStore(
    join(sessionDir, `${sessionId}.jsonl`),
    workspaceRoot,
    sessionId,
  );

  // 本次 run 的黑匣子：每次请求一个独立 runId，落到 .traces/<runId>.jsonl
  const recorder = TraceRecorder.create(traceDir, modelLabel);

  await recorder.init();

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: StreamFrame) => {
        // 每个 frame 前加 data: 开头，后加两个换行符，模拟 SSE 流
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
        );
      };

      // 客户端断开感知：标签页/浏览器关闭时，Next.js 会 abort 请求信号。
      // 此时 SSE 流的 finally 不一定触发，这里主动清理该 run 的挂起提问，
      // 防止 onAskUser Promise 永远等不到、残留内存。
      let runFinalized = false;
      const finalizeRun = () => {
        if (runFinalized) return;
        runFinalized = true;
        clearRun(recorder.runId);
      };
      req.signal.addEventListener("abort", finalizeRun);

      try {
        // 0) run 级取消：注册 AbortController（停止按钮通过 /api/chat/stop 触发）
        const abortController = new AbortController();
        runControllers.set(recorder.runId, abortController);

        // 0) 先推 run 元信息（runId + 模型名），前端据此展示"本次是哪个 run"
        send({ type: "run", runId: recorder.runId, model: modelLabel });

        // 1) 用户消息生命周期事件：既进 SSE（前端画气泡），也进轨迹（黑匣子）
        const userStart: AgentEvent = {
          type: "message_start",
          message: userMessage,
        };

        const userEnd: AgentEvent = {
          type: "message_end",
          message: userMessage,
        };

        recorder.record(userStart);

        send({ type: "event", event: userStart });
        
        recorder.record(userEnd);
        send({ type: "event", event: userEnd });

        // 1b) 多轮记忆的核心：先把用户消息落盘，再从叶子回溯出完整上下文。
        //     上一轮的 assistant/toolResult 都在上下文里，模型这一轮才能"记得"。
        await store.appendMessage(userMessage);
        const context = store.buildContext();

        // 1c) 每请求组装工具注册表（贴 pi create-harness：每次会话组装）。
        //     业务 hooks 闭包捕获「这次请求」的 store/send——工具不用引擎透传。
        //     signal/onChunk 仍是运行时参（引擎执行时注入），这里只烙业务。
        const toolRegistry = createToolRegistry(workspaceRoot, {
          // todo_write：先落盘会话（todo 是会话事件），再推 SSE 帧让前端面板实时更新。
          // await 保证工具结果返回时已入库。
          onTodoWrite: async (todos) => {
            await store.appendTodo(todos);
            send({ type: "tool_todo", todos });
          },
          // ask_user_question（A4）：推提问帧 → 挂起等用户逐题回答（不超时，用户可跳过，
          // 返回未回答，run 不挂死）→ 回答回传工具结果给模型继续。
          onAskUser: (questions) => askUserAnswer(questions, recorder.runId, send),
        });

        // 2) 运行 Agent Loop。onEvent 同时做两件事：
        //    - recorder.record(event)  → 落盘成轨迹（黑匣子）
        //    - send({type:"event"})    → 推给浏览器（实时仪表盘）
        const result = await runAgentLoop({
          systemPrompt,
          messages: context,
          tools: toolRegistry.definitions(),
          model,
          toolRegistry,
          // 循环最大轮次（防无限循环护栏）：来自 lib/config.ts，env 可覆盖
          maxTurns: config.agent.maxTurns,
          // 审批需要 send（推确认帧给前端）和 recorder.runId，所以用闭包包一层
          beforeToolCall: (call) => handleToolApproval(call, send, sessionId),
          // run 级取消：中止模型请求 + 传给 bash 杀命令
          signal: abortController.signal,
          // bash 流式输出：旁路直达前端（不进事件流/trace）
          onToolOutput: (toolCallId, text) => {
            send({ type: "tool_output", toolCallId, text });
          },
          onEvent: (event) => {
            recorder.record(event);
            send({ type: "event", event });
          },
        });

        // 2b) 本轮新增的 assistant/toolResult 逐条落盘，成为下一轮的"记忆"
        for (const message of result.newMessages) {
          await store.appendMessage(message);
        }
        // 2c) 上下文超窗口时压缩旧消息为摘要（B2 ③：LLM 结构化摘要）。
        //     三步走，对齐 pi 的 prepareCompaction → compact → 落盘：
        //     ① 纯计算准备（切点/待压消息/旧摘要，不碰模型）
        //     ② 调模型生成结构化摘要（MOCK 或失败 → 降级拼贴，保信息）
        //     ③ 落盘 compaction entry（成为新叶子）
        //     阈值按 provider 的上下文窗口算（DeepSeek V4 是 1M 窗口，
        //     几十上百轮才触发）；经济性检查（Reasonix D6）：要压的区域
        //     太小（低于 config 阈值）就不压——省下的 token 不够抵消一次
        //     摘要 API 调用的成本。
        const prep = store.prepareCompaction(
          config.provider.contextWindow - config.provider.reserveTokens,
          compactKeepRecent(),
        );
        if (prep && prep.tokensToSummarize >= config.agent.minCompactTokens) {
          // 压缩开始：先推 compacting 帧，让前端知道"后端在忙压缩"，不是卡死。
          // 压缩（尤其调模型生成摘要）耗时几秒~几十秒，这段时间 SSE 无其他帧。
          send({ type: "compacting", tokensBefore: prep.tokensBefore });
          let summary: string;
          if (config.modelSecrets.mockMode) {
            // 离线教学：不调模型，拼贴降级（信息还在，只是不省 token）
            summary = summarizeEntries(prep.messagesToSummarize);
          } else {
            // 真实模型：结构化摘要；失败降级拼贴（压缩是"防爆窗"，失败不能拖垮对话）
            summary =
              (await generateSummary(model, prep.messagesToSummarize, {
                previousSummary: prep.previousSummary,
                signal: abortController.signal,
              })) ?? summarizeEntries(prep.messagesToSummarize);
          }
          await store.commitCompaction(prep, summary);
        }

        // 3) 全部结束后，推送最终权威结果。
        //    messages 带「全量会话历史」（buildContext 从叶子回溯），
        //    前端直接整体替换渲染——多轮对话因此能完整显示。
        //    stats 是会话级累计统计（含本轮新增），前端读数盘直接展示。
        send({
          type: "done",
          messages: store.buildContext(),
          tools: toolRegistry.definitions(),
          runId: recorder.runId,
          stats: store.stats(),
          todos: store.getLatestTodos() ?? [],
        });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        // run 结束（正常/出错/被停止）：注销取消句柄 + 清理该 run 的挂起提问。
        // 用 finalizeRun 收口（含移除 abort 监听器），和客户端断开路径一致，
        // 避免两处重复。clearRun 强制 resolve 空数组，onAskUser Promise 不残留。
        req.signal.removeEventListener("abort", finalizeRun);
        finalizeRun();
        runControllers.delete(recorder.runId);
        await recorder.end({ messages: recorder.entries.length });
        controller.close();
      }
    },
  });

  // 关键：Content-Type 必须是 text/event-stream，且关闭缓存/缓冲，
  // 否则浏览器或中间件会把整个响应缓冲到结束才一次性返回。
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// --- GET /api/chat?sessionId=xxx ---
// 返回会话历史（叶子路径上的全部消息），供前端挂载/切换会话时恢复多轮对话。
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }
  const store = new JsonlSessionStore(
    join(sessionDir, `${sessionId}.jsonl`),
    workspaceRoot,
    sessionId,
  );
  return NextResponse.json({
    sessionId,
    leafId: store.getLeafId(),
    messages: store.buildContext(),
    stats: store.stats(),
    todos: store.getLatestTodos() ?? [],
  });
}

// --- DELETE /api/chat?sessionId=xxx ---
// 清空会话消息（保留会话本身）。2026-08-26：前端「清空记录」按钮已删，
// 本路由保留为服务端能力（未来斜杠命令 /clear 等可复用）。
// 为什么要有服务端清空：只清前端本地状态的话，刷新后历史会从文件复活。
export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
  }
  const store = new JsonlSessionStore(
    join(sessionDir, `${sessionId}.jsonl`),
    workspaceRoot,
    sessionId,
  );
  await store.reset();
  return NextResponse.json({ ok: true, sessionId });
}

// --- 模型提问（A4，多问题）：挂起一次提问 → 推帧（带全部 questions）→ 等逐题回答 ---
// 与 askUserApproval 同模式，但语义是「回答问题列表」不是「允许/拒绝」：
// 推 ask_user_request 帧（附 questions）给前端逐题作答 → 用户答完走
// POST /api/chat/ask-user 回传 answers[] → resolve 交回 await 中的 onAskUser
// → 工具结果回模型继续。
// 【用户要求 2026-08-24】不设超时——模型无限等用户，用户想跳过就点「跳过」
// （回传空数组 → 工具返回 SKIPPED_TEXT），不会被强制打断。
// 但 run 结束（正常/被 stop/断连）时由 finally 里的 clearRun 清掉挂起，
// 防止 Promise 残留（关浏览器/切会话的兜底）。
function askUserAnswer(
  questions: AskQuestion[],
  runId: string,
  send: (frame: StreamFrame) => void,
): Promise<string[]> {
  return new Promise((resolve) => {
    // key 带 runId 前缀，run 结束时 clearRun(runId) 能按前缀精确清理
    const key = makeAskKey(runId);

    send({ type: "ask_user_request", toolCallId: key, questions });

    userAnswers.set(key, {
      resolve: (answers: string[]) => {
        userAnswers.delete(key);
        resolve(answers);
      },
    });
  });
}

// --- POST /api/chat/ask-user ---（独立路由文件 app/api/chat/ask-user/route.ts）

// --- 模型选择（config.provider → 具体实现）---
// 这个函数是"适配层"的入口：上层 runAgentLoop 只依赖 TeachingModel 接口，
// 用哪个实现，在这里决定，引擎完全无感。
// provider 可扩展：config.provider 指向当前厂商（默认 deepseek），
// 换厂商 = 换 AI_PROVIDER + 在下面加分支（见 lib/config.ts PROVIDERS）。

function selectModel(): { model: TeachingModel; label: string } {
  if (config.modelSecrets.mockMode) {
    return { model: new MockModel(), label: "mock" };
  }

  const apiKey = config.modelSecrets.apiKey;

  if (!apiKey || apiKey === "sk-your-key-here") {
    throw new Error(
      "未配置 DEEPSEEK_API_KEY。请在 .env.local 填入真实 key 并把 MOCK_MODE 改为 false，或保持 MOCK_MODE=true 使用离线教学模式。",
    );
  }

  const model = new DeepSeekModel({
    apiKey,
    baseUrl: config.provider.baseUrl,
    model: config.provider.model,
  });

  return { model, label: config.provider.label };
}

// --- 工具审批：硬性策略 + 人工确认 ---
// 引擎每次想调工具都会先来这里（beforeToolCall 钩子）。
// 两层把关：
//   1. 硬性安全策略：secret/秘密 文件名直接拦，不弹框（这类永远不该发生）
//   2. 人工确认：写/改/删工具推确认帧给前端弹框，用户当场允许/拒绝
// 只读工具（list/read/grep/find）默认放行。
// 超时兜底：用户 5 小时不回应自动拒绝（block），避免挂起（前端不展示时间）。

// TOOLS_NEEDING_CONFIRM 已移入 _pipeline/approval.ts（E2 步骤 2）

// 人工确认超时：默认 5 小时（用户要长时间思考/离开也不该被打断；是"兜底防挂死"，
// 不是"催促"——前端已不展示任何时间提示）。可用 APPROVAL_TIMEOUT_MS 环境变量覆盖。
const APPROVAL_TIMEOUT_MS = config.approval.timeoutMs;

async function handleToolApproval(
  call: ToolCallContent,
  send: (frame: StreamFrame) => void,
  sessionId: string,
): Promise<ToolDecision> {
  // 决策交给纯函数 decideToolCall（_pipeline/approval.ts，已单测覆盖）：
  //   - allow / block / rewrite → 直接用决策
  //   - request → 需要人工确认：这里执行副作用（日志 + 挂起弹框）
  const decision = await decideToolCall(call, {
    sessionId,
    sessionDir,
    getApprovalMode,
    isReadOnlyBash,
    isPersistApproved,
    isSessionApproved,
  });
  if (decision.action !== "request") return decision;

  // ★ B1-③ 审批日志：弹框前记 asked（审计：问了什么）
  await appendApprovalReceipt(sessionDir, sessionId, {
    phase: "asked",
    approvalId: call.id,
    toolCallId: call.id,
    toolName: call.name,
    createdAt: new Date().toISOString(),
  });

  const outcome = await askUserApproval(call, send);

  // ★ B1-③ 审批日志：决定后记 decided（审计：怎么答的）
  await appendApprovalReceipt(sessionDir, sessionId, {
    phase: "decided",
    approvalId: call.id,
    toolCallId: call.id,
    toolName: call.name,
    outcome,
    createdAt: new Date().toISOString(),
  });

  // B1-④：单次/本会话/一直允许 都是"允许"（记忆在 approve 接口里写）
  if (
    outcome === "approved" ||
    outcome === "approved-session" ||
    outcome === "approved-persist"
  ) {
    return { action: "allow" };
  }
  return {
    action: "block",
    reason:
      outcome === "timeout"
        ? "审批超时未回应，自动拒绝。"
        : "用户拒绝了本次工具调用。",
  };
}

/** 挂起一次人工确认：推帧 → 注册 pending → 返回 Promise（approve 接口或超时来 resolve） */
function askUserApproval(
  call: ToolCallContent,
  send: (frame: StreamFrame) => void,
): Promise<ApprovalOutcome> {
  return new Promise((resolve) => {
    send({
      type: "tool_permission_request",
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
    });

    // 超时兜底：5 小时不回应自动拒绝（timeout），run 不会被挂死（前端不展示时间）
    const timer = setTimeout(() => {
      toolApprovals.delete(call.id);
      resolve("timeout");
    }, APPROVAL_TIMEOUT_MS);

    toolApprovals.set(call.id, {
      toolName: call.name,
      resolve: (outcome: ApprovalOutcome) => {
        clearTimeout(timer);
        toolApprovals.delete(call.id);
        resolve(outcome);
      },
      timer,
    });
  });
}
