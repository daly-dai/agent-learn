// ============================================================
// runControl —— run 级取消注册表（Phase 4 停止按钮）
// ============================================================
// 前端点「停止」→ POST /api/chat/stop { runId } → 查到这个 run 的
// AbortController → abort() → 模型请求中止 + bash 命令被杀死。
//
// 为什么挂 globalThis：与 toolApprovals 同理——SSE 请求（注册）和
// stop 请求（查找）可能落在不同 dev worker，globalThis 同进程共享。
// ============================================================

const g = globalThis as { __runControllers?: Map<string, AbortController> };

export const runControllers: Map<string, AbortController> =
  (g.__runControllers ??= new Map());
