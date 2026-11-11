// ============================================================
// _pipeline/context —— 请求准备物（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 一次 POST 请求的"准备阶段"：定位会话 + 建会话存储 + 建轨迹记录器 + 建工具环境。
//
// 2026-11-11 起「会话在哪个目录」只由 `SessionManager.locate(id)` 给：
// 本文件不再自己 join 路径（那是 F1「4 处拼法漏改一处就静默少东西」的来源）。
//
// ⚠️ **工具环境（ToolContext）不再是模块常量**：以前它是个 `export const`，
// 工作区根来自全局配置 ⇒ 所有会话共用第一个工作区（F2：不报错、静默串味）。
// 现在它由**会话头的 cwd** 每请求构造一次。谁能 new 的纪律：只许下面两个工厂造，
// 不许在模块作用域出现 `const ctx: ToolContext = ...`。
// ============================================================

import { homedir } from "node:os";
import {
  JsonlSessionStore,
  estimateTokens,
  sessionManager,
} from "@/lib/session";
import type { SessionLocation } from "@/lib/session";
import { config } from "@/lib/config";
import { resolveSkillRoots } from "@/lib/resources";
import { TraceRecorder } from "@/lib/trace";
import type { ToolContext } from "@/lib/tools";
import type { ContextPressure } from "@/app/lib/context-occupancy";

export type RequestContext = {
  /** 会话存储：每次请求新建实例并从磁盘读全量。
   *  为什么不在模块级复用单例：多进程（dev server 多 worker / 未来部署）下
   *  内存态可能落后于磁盘，新建实例能保证「内存 = 磁盘」；会话文件小，读全量可接受。 */
  store: JsonlSessionStore;
  /** 本次 run 的黑匣子：每次请求一个独立 runId，落在会话目录下的 `trace.<runId>.jsonl` */
  recorder: TraceRecorder;
  /** 本次请求的工具环境：围栏根 = 这个会话的工作空间，技能根由它派生 */
  toolContext: ToolContext;
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
 * 造一份工具环境（签名即契约，见 `doc/plan/workspace.md` 4.5）。
 * 两个根都显式传入 —— 它不读全局配置，所以两个会话拿到的根可以不同。
 */
export function createToolContext(params: {
  workspaceRoot: string;
  skillsRoots: string[];
}): ToolContext {
  return {
    workspaceRoot: params.workspaceRoot,
    skillsRoots: params.skillsRoots,
  };
}

/**
 * 由「工作空间路径」推出工具环境 —— **生产环境唯一入口**。
 * 技能根走四层解析（`lib/resources`）：项目级 .statve/.agents 优先，用户级在后。
 * 用户家目录取 `os.homedir()`：`.agents` 是跨工具约定的用户级目录，与数据根无关。
 */
export function toolContextForWorkspace(cwd: string): ToolContext {
  return createToolContext({
    workspaceRoot: cwd,
    skillsRoots: resolveSkillRoots({
      cwd,
      dataRoot: config.paths.home,
      userHome: homedir(),
    }),
  });
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
  return {
    store,
    recorder,
    toolContext: toolContextForWorkspace(params.location.cwd),
  };
}
