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
import { resolve } from "node:path";
import type { AgentEvent, AgentMessage, ToolDefinition } from "@/lib/types";
import { createUserMessage } from "@/lib/message";
import { MockModel } from "@/lib/mockModel";
import { DeepSeekModel } from "@/lib/deepseekModel";
import type { TeachingModel } from "@/lib/model";
import { createToolRegistry } from "@/lib/tools";
import { runAgentLoop } from "@/lib/agent";
import { TraceRecorder } from "@/lib/trace";

// 显式声明 Node runtime：本路由（以及它的工具）会用 node:fs / node:path，
// 后面 Phase 4 还要用 node:child_process 跑终端。
export const runtime = "nodejs";

// 工作区根目录
const workspaceRoot = resolve(process.cwd(), "workspace");
// 轨迹（Trace）目录
const traceDir = resolve(process.cwd(), ".traces");
// 工具注册表
const toolRegistry = createToolRegistry(workspaceRoot);

const systemPrompt = [
  "你是 Teaching Agent，一个帮助初学者理解 AI Agent 核心机制的教学助手。",
  "你运行在一个安全工作区（workspace/）内，只能通过工具与文件交互，不能直接改动文件系统。",
  "",
  "## 工具使用原则",
  "你可以调用这些工具：list_files（列文件）、read_file（读文件）、write_note（写 Markdown 笔记）。",
  "- 只有用户明确要「列出 / 读取 / 写入」文件时才调用工具；概念原理类问题直接回答，不要硬套工具。",
  "- 一次只调用当前步骤真正需要的工具；拿到工具结果后必须基于真实结果回答，绝不编造文件内容。",
  "- 工具失败或读不到内容时，如实说明，不要假装成功。",
  "",
  "## 输出要求",
  "- 始终用中文回答。",
  "- 用 Markdown 排版：善用标题、列表、表格；代码示例用带语言标注的代码块。",
  "- 解释概念时：先一句话结论 → 再展开讲机制 → 最后给一个最小示例或类比。",
].join("\n");

// SSE 帧的联合类型（前端 page.tsx 用同名类型来消费）
type StreamFrame =
  | { type: "run"; runId: string; model: string }
  | { type: "event"; event: AgentEvent }
  | {
      type: "done";
      messages: AgentMessage[];
      tools: ToolDefinition[];
      runId: string;
    }
  | { type: "error"; message: string };

// --- POST /api/chat ---
export async function POST(req: NextRequest) {
  let text: unknown;

  try {
    const body = await req.json();

    text = body?.text;
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

      try {
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

        // 2) 运行 Agent Loop。onEvent 同时做两件事：
        //    - recorder.record(event)  → 落盘成轨迹（黑匣子）
        //    - send({type:"event"})    → 推给浏览器（实时仪表盘）
        const result = await runAgentLoop({
          systemPrompt,
          messages: [userMessage],
          tools: toolRegistry.definitions(),
          model,
          toolRegistry,
          beforeToolCall,
          onEvent: (event) => {
            recorder.record(event);
            send({ type: "event", event });
          },
        });

        // 3) 全部结束后，推送最终权威结果（完整消息列表 + 工具定义 + runId）。
        send({
          type: "done",
          messages: [userMessage, ...result.newMessages],
          tools: toolRegistry.definitions(),
          runId: recorder.runId,
        });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
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

// --- 模型选择（环境变量 → 具体实现）---
// 这个函数是"适配层"的入口：上层 runAgentLoop 只依赖 TeachingModel 接口，
// 用哪个实现，在这里决定，引擎完全无感。

function selectModel(): { model: TeachingModel; label: string } {
  if (process.env.MOCK_MODE === "true") {
    return { model: new MockModel(), label: "mock" };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey || apiKey === "sk-your-key-here") {
    throw new Error(
      "未配置 DEEPSEEK_API_KEY。请在 .env.local 填入真实 key 并把 MOCK_MODE 改为 false，或保持 MOCK_MODE=true 使用离线教学模式。",
    );
  }

  const model = new DeepSeekModel({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || undefined,
    model: process.env.DEEPSEEK_MODEL || undefined,
  });

  return { model, label: process.env.DEEPSEEK_MODEL || "deepseek-chat" };
}

// --- beforeToolCall 审批策略 ---
// 这是「审批」这个生命周期的另一个使用端：引擎每次想调工具都会先来这里问一句。

function beforeToolCall(call: {
  name: string;
  arguments: Record<string, unknown>;
}):
  | { action: "allow"; reason?: string }
  | { action: "block"; reason: string }
  | { action: "rewrite"; args: Record<string, unknown>; reason?: string } {
  // 策略：不允许写入含 secret/秘密 的文件名
  if (call.name === "write_note") {
    const fileName =
      typeof call.arguments.fileName === "string"
        ? call.arguments.fileName
        : "";

    if (/secret|秘密/i.test(fileName)) {
      return {
        action: "block",
        reason: "教学版权限策略：不允许写入包含 secret/秘密 的笔记文件。",
      };
    }
  }

  // list_files 没有 path 参数时补齐默认值
  if (call.name === "list_files" && typeof call.arguments.path !== "string") {
    return {
      action: "rewrite",
      args: { ...call.arguments, path: "." },
      reason: "补齐默认目录参数。",
    };
  }

  return { action: "allow" };
}
