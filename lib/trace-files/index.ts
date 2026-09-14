// ============================================================
// trace-files —— 会话 → 轨迹文件（定位层）
// ============================================================
//
// 这是整个 A3 里**唯一**与"轨迹文件放在哪、叫什么名字"耦合的模块。
// 其余各层都与布局无关：折叠层收 `TraceRun[]`、记录器的目录由调用方传、
// 视图收 `TraceFold`、tab 接线只是切显示。
//
// 所以"以后按工作目录分组"（PLAN C18 ⑥）落地时，**只改这里的内部实现，
// 签名不变**——这是把它单独拆出来的全部理由。
//
// 布局（2026-09-14 定，详案 §3.1 ①）：`<traceDir>/<sessionId>.<runId>.jsonl`
//   列某个会话的轨迹 = readdir + 前缀匹配 = **零内容读取**。
//   （.traces 现有 154 个文件 / 25MB / 单个最大 1.15MB，逐个读头不可接受。）
//
// 归属为什么写在文件名而不是文件里的字段：见 `lib/trace/index.ts` 头部注释。
// ============================================================

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseTraceFileName } from "../trace";

export type TraceFile = {
  path: string;
  sessionId: string;
  runId: string;
};

/**
 * 列出某个会话的全部轨迹文件，按时间升序。
 *
 * 匹配方式是"**先解析文件名、再比 sessionId**"，不是 `startsWith(sessionId)`——
 * 否则 `s_a` 会把 `s_ab` 的文件也算进来（前缀包含 ≠ 同一个会话）。
 */
export async function listTraceFiles(traceDir: string, sessionId: string): Promise<TraceFile[]> {
  // 目录不存在 = 这个工作区还没跑过 agent，不是错误
  const entries = await readdir(traceDir, { withFileTypes: true }).catch(() => []);
  const files: TraceFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseTraceFileName(entry.name);
    if (!parsed || parsed.sessionId !== sessionId) continue;
    files.push({ path: join(traceDir, entry.name), ...parsed });
  }

  // runId 形如 run_<ISO 时间戳>_<随机>，定宽零填充 → 字典序即时间序
  return files.sort((a, b) => a.runId.localeCompare(b.runId));
}
