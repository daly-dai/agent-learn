// ============================================================
// _pipeline/context.ts —— 请求准备物（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 一次 POST 请求的"准备阶段"：建会话存储 + 轨迹记录器。
// 依赖（sessionDir/traceDir/workspaceRoot/modelLabel）由 route 传入，
// 本文件不碰 SSE/req——纯准备，返回实例供后续阶段用。
// ============================================================

import { join } from "node:path";
import { JsonlSessionStore } from "@/lib/session";
import { TraceRecorder } from "@/lib/trace";

export type RequestContext = {
  /** 会话存储：每次请求新建实例并从磁盘读全量。
   *  为什么不在模块级复用单例：多进程（dev server 多 worker / 未来部署）下
   *  内存态可能落后于磁盘，新建实例能保证「内存 = 磁盘」；会话文件小，读全量可接受。 */
  store: JsonlSessionStore;
  /** 本次 run 的黑匣子：每次请求一个独立 runId，落到 .traces/<runId>.jsonl */
  recorder: TraceRecorder;
};

export async function createRequestContext(params: {
  sessionId: string;
  sessionDir: string;
  workspaceRoot: string;
  traceDir: string;
  modelLabel: string;
}): Promise<RequestContext> {
  const store = new JsonlSessionStore(
    join(params.sessionDir, `${params.sessionId}.jsonl`),
    params.workspaceRoot,
    params.sessionId,
  );
  const recorder = TraceRecorder.create(params.traceDir, params.modelLabel);
  await recorder.init();
  return { store, recorder };
}
