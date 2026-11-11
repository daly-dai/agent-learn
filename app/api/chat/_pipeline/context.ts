// ============================================================
// _pipeline/context.ts —— 请求准备物（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 一次 POST 请求的"准备阶段"：定位会话 + 建会话存储 + 建轨迹记录器。
// 2026-11-11 起「会话在哪个目录」只由 `SessionManager.locate(id)` 给：
// 本文件不再自己 join 路径（那是 F1「4 处拼法漏改一处就静默少东西」的来源）。
// ============================================================

import {
  JsonlSessionStore,
  estimateTokens,
  sessionManager,
} from "@/lib/session";
import type { SessionLocation } from "@/lib/session";
import { config } from "@/lib/config";
import { TraceRecorder } from "@/lib/trace";
import type { ToolContext } from "@/lib/tools";
import type { ContextPressure } from "@/app/lib/context-occupancy";

/**
 * 本次部署的「工具环境」（工作区根 + 技能根）—— **唯一的生产点**。
 *
 * 为什么放这里、不放各自的 route 里：`POST /api/chat` 要它（建工具注册表 + 扫技能根），
 * `GET /api/chat/commands` 也要它（把技能组进面板清单）。技能根只允许出现在**一处**
 * （`doc/plan/c8-skills.md` 的施工纪律 5）—— 将来多根落地时要改的是"一个函数 + 一处
 * 调用点"，不是散开的签名。
 *
 * ⚠️ **本常量在模块作用域，是有前提的**：两个值今天都来自 `config`（静态，不会变）。
 * 一旦工作区改成"**按会话 / 按工作区**不同"（C6 工作区选择 + C32 项目级配置：值从会话头
 * 的 `cwd` 来、技能根由它派生 —— 见 `doc/plan/c8-skills.md` 的**补记 4**），
 * **它必须挪进请求处理函数内部**。不挪 = **第一个请求的工作区被所有会话共用**：
 * 不报错、只是静默串味 —— 和当年那个"模块级单例注册表"是同一个病的另一面。
 */
export const toolContext: ToolContext = {
  workspaceRoot: config.paths.workspace,
  skillsRoot: config.paths.skillsRoot,
};

export type RequestContext = {
  /** 会话存储：每次请求新建实例并从磁盘读全量。
   *  为什么不在模块级复用单例：多进程（dev server 多 worker / 未来部署）下
   *  内存态可能落后于磁盘，新建实例能保证「内存 = 磁盘」；会话文件小，读全量可接受。 */
  store: JsonlSessionStore;
  /** 本次 run 的黑匣子：每次请求一个独立 runId，落在会话目录下的 `trace.<runId>.jsonl` */
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
 * 按 sessionId 找会话并建存储（每请求新建，同 createRequestContext 理由：
 * 内存 = 磁盘）。
 * 为什么抽出来：command/export/GET/DELETE 等只读会话的路由都要建 store，
 * 四处重复拼路径——收成一个工厂。
 * 找不到会抛错：调用方负责翻成 404（会话不存在）。
 */
export async function createSessionStore(
  sessionId: string,
): Promise<JsonlSessionStore> {
  const location = await sessionManager.locate(sessionId);
  if (!location) throw new Error(`会话不存在：${sessionId}`);

  return new JsonlSessionStore({
    filePath: location.logPath,
    cwd: location.cwd,
    sessionId,
  });
}

export async function createRequestContext(params: {
  sessionId: string;
  location: SessionLocation;
  modelLabel: string;
}): Promise<RequestContext> {
  const store = new JsonlSessionStore({
    filePath: params.location.logPath,
    cwd: params.location.cwd,
    sessionId: params.sessionId,
  });
  const recorder = TraceRecorder.create(
    params.location.dir,
    params.modelLabel,
    params.sessionId,
  );
  await recorder.init();
  return { store, recorder };
}
