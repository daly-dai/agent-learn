// ============================================================
// _pipeline/tools.ts —— 工具注册表组装（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 每请求组装（贴 pi create-harness：每次会话组装）。
// 业务 hooks 闭包捕获「这次请求」的 store/send——工具不用引擎透传。
// signal/onChunk 仍是运行时参（引擎执行时注入），这里只烙业务。
// ============================================================

import { createToolRegistry } from "@/lib/tools";
import type { AskQuestion } from "@/lib/tools/ask-user";
import type { JsonlSessionStore } from "@/lib/session";
import type { StreamFrame } from "./frames";

export function createPipelineTools(params: {
  workspaceRoot: string;
  store: JsonlSessionStore;
  send: (frame: StreamFrame) => void;
  /** 已绑定 runId/send 的提问闭包（route 组装时调 askUserAnswer 生成） */
  onAskUser: (questions: AskQuestion[]) => Promise<string[]>;
}) {
  return createToolRegistry(params.workspaceRoot, {
    // todo_write：先落盘会话（todo 是会话事件），再推 SSE 帧让前端面板实时更新。
    // await 保证工具结果返回时已入库。
    onTodoWrite: async (todos) => {
      await params.store.appendTodo(todos);
      params.send({ type: "tool_todo", todos });
    },
    // ask_user_question（A4）：闭包由 route 组装时绑定 runId/send
    // （_pipeline/ask-user.ts），这里只转交，不做二次柯里化。
    onAskUser: params.onAskUser,
  });
}
