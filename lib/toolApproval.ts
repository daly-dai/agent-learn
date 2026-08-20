// ============================================================
// toolApproval —— 工具调用的人工确认注册表（Phase 3）
// ============================================================
//
// 引擎想执行写/改/删工具时，beforeToolCall 会推一个确认请求给前端
// 并 await；前端弹框后调 POST /api/chat/approve 回传决定，这里负责
// 把「toolCallId → 用户决定」联系起来。
//
// 为什么挂 globalThis 而不是模块级变量：Next dev server 可能开多个
// worker，每个 worker 有独立的模块实例——SSE 请求（挂起确认）和
// approve 请求（回传决定）若落在不同 worker，模块级 Map 就找不到了。
// globalThis 在同一进程内全局可见（多进程仍不共享，本地开发单进程可接受）。
// ============================================================

export type PendingApproval = {
  /** 用户做出决定（允许/拒绝）时调用；返回给 await 中的 beforeToolCall */
  resolve: (allow: boolean) => void;
  /** 超时定时器（60 秒自动拒绝） */
  timer: ReturnType<typeof setTimeout>;
};

const g = globalThis as { __toolApprovals?: Map<string, PendingApproval> };

export const toolApprovals: Map<string, PendingApproval> =
  (g.__toolApprovals ??= new Map());
