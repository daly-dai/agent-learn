// ============================================================
// _pipeline/context.ts —— 请求准备物（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 一次 POST 请求的"准备阶段"：建会话存储 + 轨迹记录器。
// 依赖（sessionDir/traceDir/workspaceRoot/modelLabel）由 route 传入，
// 本文件不碰 SSE/req——纯准备，返回实例供后续阶段用。
// ============================================================

import { join } from "node:path";
import { JsonlSessionStore, estimateTokens } from "@/lib/session";
import { config } from "@/lib/config";
import { TraceRecorder } from "@/lib/trace";
import type { ContextPressure } from "@/app/lib/context-occupancy";

export type RequestContext = {
  /** 会话存储：每次请求新建实例并从磁盘读全量。
   *  为什么不在模块级复用单例：多进程（dev server 多 worker / 未来部署）下
   *  内存态可能落后于磁盘，新建实例能保证「内存 = 磁盘」；会话文件小，读全量可接受。 */
  store: JsonlSessionStore;
  /** 本次 run 的黑匣子：每次请求一个独立 runId，落到 .traces/<runId>.jsonl */
  recorder: TraceRecorder;
};

/** 计算当前上下文占用（C13 ContextMeter 数据源）：
 *  分子 = estimateTokens(buildContext)（prepareCompaction 同款估算），
 *  容量 = provider 上下文窗口。GET 历史与 done 帧共用。 */
export function computeContextPressure(
  store: JsonlSessionStore,
): ContextPressure {
  return {
    pressureTokens: estimateTokens(store.buildContext()),
    contextWindow: config.provider.contextWindow,
  };
}

/**
 * 按 sessionId 建会话存储（每请求新建，同 createRequestContext 理由：
 * 内存 = 磁盘）。路径来自 config（唯一配置入口）。
 * 为什么抽出来：command/export/GET/DELETE 等只读会话的路由都要建 store，
 * 四处重复 `new JsonlSessionStore(join(...))` 拼路径——收成一个工厂。
 * createRequestContext 不调它：那个要参数化 sessionDir（测试传临时目录）。
 */
export function createSessionStore(sessionId: string): JsonlSessionStore {
  return new JsonlSessionStore(
    join(config.paths.sessions, `${sessionId}.jsonl`),
    config.paths.workspace,
    sessionId,
  );
}

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
