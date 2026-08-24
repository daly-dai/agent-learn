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
import { join, resolve } from "node:path";
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
import { runAgentLoop, type ToolDecision } from "@/lib/agent";
import { TraceRecorder } from "@/lib/trace";
import { JsonlSessionStore } from "@/lib/sessionStore";
import { isValidSessionId } from "@/lib/sessionManager";
import { toolApprovals } from "@/lib/toolApproval";
import { runControllers } from "@/lib/runControl";

// 显式声明 Node runtime：本路由（以及它的工具）会用 node:fs / node:path，
// 后面 Phase 4 还要用 node:child_process 跑终端。
export const runtime = "nodejs";

// 工作区根目录
const workspaceRoot = resolve(process.cwd(), "workspace");
// 轨迹（Trace）目录
const traceDir = resolve(process.cwd(), ".traces");
// 会话（Session）目录：多轮对话的 JSONL 落盘位置，与 .traces/ 平级。
// 为什么不在 workspace/sessions：workspace 是 agent 的工作区（工具可读写），
// 会话数据是运行时状态，不该被 agent 工具碰到。
const sessionDir = resolve(process.cwd(), ".sessions");
// 工具注册表
const toolRegistry = createToolRegistry(workspaceRoot);

const systemPrompt = [
  "你是 Teaching Agent，一个帮助初学者理解 AI Agent 核心机制的教学助手。",
  "你运行在一个安全工作区（workspace/）内，只能通过工具与文件交互，不能直接改动文件系统。",
  "",
  "## 工具使用原则",
  "你可以调用这些工具：",
  "- list_files（列文件）、read_file（读文件）",
  "- write_file（写任意文件）、edit_file（精确替换文件内容）",
  "- delete_file（删除文件；写/改/删都会弹框请你确认）",
  "- grep（按正则搜内容）、find（按文件名找文件）",
  "- write_note（写工作区笔记）",
  "- bash（执行 shell 命令；命令在 Windows 环境运行，避免 ls 等 Unix 专属命令；执行前会弹框确认）",
  "- todo_write（记录并更新任务清单：复杂任务开始前先列出任务，任务状态变化时更新整表；无需确认，因为它只改会话内的任务列表，不碰文件）",
  "- 只有用户明确要求「列出 / 读取 / 写入 / 修改 / 删除 / 搜索 / 执行命令」时才调用工具；概念原理类问题直接回答，不要硬套工具。",
  "- 一次只调用当前步骤真正需要的工具；拿到工具结果后必须基于真实结果回答，绝不编造文件内容。",
  "- 工具失败或读不到内容时，如实说明，不要假装成功。",
  "- 写/改/删文件时，引擎会弹框请用户确认；被拒绝（或用户 60 秒未回应）时工具结果会报错，如实向用户说明，不要反复重试同一操作。",
  "",
  "## 输出要求",
  "- 始终用中文回答。",
  "- 用 Markdown 排版：善用标题、列表、表格；代码示例用带语言标注的代码块。",
  "- **任务优先于教学**：用户让你执行/验证/操作时，先直接给出结果（成功/失败/数据），不要借题发挥展开教学。",
  "- 工具失败时：如实复述错误和退出码，一句话说明失败原因即可；只有用户明确追问机制时才展开讲解。",
  "- 解释概念时：先一句话结论 → 再展开讲机制 → 最后给一个最小示例或类比。",
].join("\n");

// SSE 帧的联合类型（前端 sse.ts 用同名类型来消费）
type StreamFrame =
  | { type: "run"; runId: string; model: string }
  | { type: "event"; event: AgentEvent }
  | {
      type: "done";
      messages: AgentMessage[];
      tools: ToolDefinition[];
      runId: string;
      // 会话级累计统计（读数盘）：done 时点由 store 从会话文件算出
      stats: SessionStats;
      // 任务清单（Phase 5）：叶子回溯取最新 todo 条目，前端面板权威恢复值
      todos: TodoItem[];
    }
  | { type: "error"; message: string }
  // 写/改/删工具需要人工确认：推给前端弹框，用户决定后回传 /api/chat/approve
  | {
      type: "tool_permission_request";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  // bash 命令的流式输出（旁路帧，不是 AgentEvent）：工具 → 这里 → SSE → 前端
  | { type: "tool_output"; toolCallId: string; text: string }
  // todo_write 更新任务清单（旁路帧，Phase 5）：工具 → 落盘会话 → 这里 → 前端面板
  | { type: "tool_todo"; todos: TodoItem[] };

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

        // 
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

        // 2) 运行 Agent Loop。onEvent 同时做两件事：
        //    - recorder.record(event)  → 落盘成轨迹（黑匣子）
        //    - send({type:"event"})    → 推给浏览器（实时仪表盘）
        const result = await runAgentLoop({
          systemPrompt,
          messages: context,
          tools: toolRegistry.definitions(),
          model,
          toolRegistry,
          // 审批需要 send（推确认帧给前端）和 recorder.runId，所以用闭包包一层
          beforeToolCall: (call) => handleToolApproval(call, send),
          // run 级取消：中止模型请求 + 传给 bash 杀命令
          signal: abortController.signal,
          // bash 流式输出：旁路直达前端（不进事件流/trace）
          onToolOutput: (toolCallId, text) => {
            send({ type: "tool_output", toolCallId, text });
          },
          // todo_write 旁路（Phase 5）：先落盘会话（todo 是会话事件），
          // 再推 SSE 帧让前端面板实时更新。await 保证工具结果返回时已入库。
          onTodoWrite: async (todos) => {
            await store.appendTodo(todos);
            send({ type: "tool_todo", todos });
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
        // 2c) 上下文超窗口时压缩旧消息为摘要，防止上下文无限膨胀
        await store.compactIfNeeded(4000, 8);

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
        // run 结束（无论正常/出错/被停止）：注销取消句柄，防止 Map 泄漏
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
// 清空会话（与前端「清空记录」按钮配套：只清本地状态的话，刷新后历史会复活）。
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

  return { model, label: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" };
}

// --- 工具审批：硬性策略 + 人工确认 ---
// 引擎每次想调工具都会先来这里（beforeToolCall 钩子）。
// 两层把关：
//   1. 硬性安全策略：secret/秘密 文件名直接拦，不弹框（这类永远不该发生）
//   2. 人工确认：写/改/删工具推确认帧给前端弹框，用户当场允许/拒绝
// 只读工具（list/read/grep/find）默认放行。
// 超时兜底：用户 60 秒不回应自动拒绝（block），避免挂起。

/** 需要人工确认的工具：全部写/改/删操作 + bash（已确认：全量弹框） */
const TOOLS_NEEDING_CONFIRM = [
  "write_note",
  "write_file",
  "edit_file",
  "delete_file",
  "bash",
] as const;

const APPROVAL_TIMEOUT_MS = 60_000;

async function handleToolApproval(
  call: ToolCallContent,
  send: (frame: StreamFrame) => void,
): Promise<ToolDecision> {
  // --- 硬性策略：secret/秘密 永不弹框，直接拦 ---
  if (call.name === "write_note" || call.name === "write_file") {
    // 取要检查的路径：write_note 用 fileName，write_file 用 path。
    // 不用嵌套三元——两层 ? : 叠在一起难读，if/else 直白。
    let target = "";
    if (typeof call.arguments.fileName === "string") {
      target = call.arguments.fileName;
    } else if (typeof call.arguments.path === "string") {
      target = call.arguments.path;
    }

    if (/secret|秘密/i.test(target)) {
      return {
        action: "block",
        reason: "教学版权限策略：不允许写入包含 secret/秘密 的文件。",
      };
    }
  }

  // --- 人工确认：推帧给前端弹框，await 用户决定 ---
  if ((TOOLS_NEEDING_CONFIRM as readonly string[]).includes(call.name)) {
    const allow = await askUserApproval(call, send);
    return allow
      ? { action: "allow" }
      : { action: "block", reason: "用户拒绝了本次工具调用。" };
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

/** 挂起一次人工确认：推帧 → 注册 pending → 返回 Promise（approve 接口或超时来 resolve） */
function askUserApproval(
  call: ToolCallContent,
  send: (frame: StreamFrame) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    send({
      type: "tool_permission_request",
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
    });

    // 超时兜底：60 秒不回应自动拒绝（block），run 不会被挂死
    const timer = setTimeout(() => {
      toolApprovals.delete(call.id);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);

    toolApprovals.set(call.id, {
      resolve: (allow: boolean) => {
        clearTimeout(timer);
        toolApprovals.delete(call.id);
        resolve(allow);
      },
      timer,
    });
  });
}
