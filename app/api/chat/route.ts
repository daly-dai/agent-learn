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
import {
  createUserMessage,
  isValidSessionId,
  getApprovalMode,
  toolApprovals,
  clearRun,
  runControllers,
  config,
} from "@/lib";
import type { ToolCallContent, ToolDecision } from "@/lib";
import type { StreamFrame } from "./_pipeline/frames";
import { systemPrompt } from "./_pipeline/prompt";
import { decideToolCall } from "./_pipeline/approval";
import { selectModelSafe } from "./_pipeline/model";
import { createRequestContext, createSessionStore } from "./_pipeline/context";
import { runPipeline } from "./_pipeline/index";
import { computeContextPressure } from "./_pipeline/context";
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
  // selectModelSafe 统一"选择失败 → error 文案"（command route 同款）。
  const selected = selectModelSafe();
  if (!selected.ok) {
    return NextResponse.json({ error: selected.error }, { status: 400 });
  }
  const model = selected.model;
  const modelLabel = selected.label;

  // 创建用户消息
  const userMessage = createUserMessage(text.trim());

  // 创建会话存储和记录器
  const { store, recorder } = await createRequestContext({
    sessionId,
    sessionDir,
    workspaceRoot,
    traceDir,
    modelLabel,
  });

  // 创建文本编码器
  const encoder = new TextEncoder();

  // 创建可读流
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 创建发送函数
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
      // 客户端断开感知：标签页/浏览器关闭时，Next.js 会 abort 请求信号。
      req.signal.addEventListener("abort", finalizeRun);

      try {
        // 0) run 级取消：注册 AbortController（停止按钮通过 /api/chat/stop 触发）
        const abortController = new AbortController();
        runControllers.set(recorder.runId, abortController);

        // 0) 先推 run 元信息（runId + 模型名），前端据此展示"本次是哪个 run"
        send({ type: "run", runId: recorder.runId, model: modelLabel });

        // 1-3) 编排交给 _pipeline/index.ts 的 runPipeline（E2 步骤 4）：
        //     落盘/工具组装/loop/压缩/done 都收进编排层；这里只保留
        //     SSE 管道（send/abort/finally）——Next.js 请求生命周期。
        await runPipeline({
          systemPrompt,
          model,
          userMessage,
          store,
          recorder,
          send,
          signal: abortController.signal,
          workspaceRoot,
          beforeToolCall: (call) => handleToolApproval(call, send, sessionId),
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
  const store = createSessionStore(sessionId);
  return NextResponse.json({
    sessionId,
    leafId: store.getLeafId(),
    messages: store.buildContext(),
    stats: store.stats(),
    todos: store.getLatestTodos() ?? [],
    contextPressure: computeContextPressure(store), // C13 ContextMeter 数据源
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
  const store = createSessionStore(sessionId);
  await store.reset();
  return NextResponse.json({ ok: true, sessionId });
}

// --- 工具审批：硬性策略 + 人工确认 ---
// 引擎每次想调工具都会先来这里（beforeToolCall 钩子）。
// 两层把关：
//   1. 硬性安全策略：secret/秘密 文件名直接拦，不弹框（这类永远不该发生）
//   2. 人工确认：写/改/删工具推确认帧给前端弹框，用户当场允许/拒绝
// 只读工具（list/read/grep/find）默认放行。
// 超时兜底：用户 5 小时不回应自动拒绝（block），避免挂起（前端不展示时间）。

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
