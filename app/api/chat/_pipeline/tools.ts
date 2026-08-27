// ============================================================
// _pipeline/tools.ts —— 工具注册表组装（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 每请求组装（贴 pi create-harness：每次会话组装）。
// 业务 hooks 闭包都在这里统一绑定（todo + askUser）——两个 hooks
// 一处定义，不散到调用方（2026-08-27：曾把 askUser 闭包放 route 组装，
// 导致 hooks 分两处、可读性差，统一收进来）。
// signal/onChunk 仍是运行时参（引擎执行时注入），这里只烙业务。
// ============================================================

import { createToolRegistry } from "@/lib/tools";
import type { JsonlSessionStore } from "@/lib/session";
import type { TraceRecorder } from "@/lib/trace";
import type { StreamFrame } from "./frames";
import { askUserAnswer } from "./ask-user";

export function createPipelineTools(params: {
  workspaceRoot: string;
  store: JsonlSessionStore;
  recorder: TraceRecorder;
  send: (frame: StreamFrame) => void;
}) {
  return createToolRegistry(params.workspaceRoot, {
    // todo_write：先落盘会话（todo 是会话事件），再推 SSE 帧让前端面板实时更新。
    // await 保证工具结果返回时已入库。
    onTodoWrite: async (todos) => {
      await params.store.appendTodo(todos);
      params.send({ type: "tool_todo", todos });
    },
    // ask_user_question（A4）：推提问帧 → 挂起等用户逐题回答（不超时，用户可跳过，
    // 返回未回答，run 不挂死）→ 回答回传工具结果给模型继续。
    // runId 来自 recorder（本请求唯一），与 onTodoWrite 同处绑定。
    onAskUser: (questions) =>
      askUserAnswer(questions, params.recorder.runId, params.send),
  });
}
