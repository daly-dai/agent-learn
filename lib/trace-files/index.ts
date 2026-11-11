// ============================================================
// trace-files —— 会话 → 轨迹文件（定位层）
// ============================================================
//
// 这是整个 A3 里**唯一**与"轨迹文件放在哪、叫什么名字"耦合的模块。
// 其余各层都与布局无关：折叠层收 `TraceRun[]`、记录器的目录由调用方传、
// 视图收 `TraceFold`、tab 接线只是切显示。
//
// 布局（2026-11-11 改成"每会话一个目录"）：
//   `<会话目录>/trace.<runId>.jsonl`
//   ⇒ 列某个会话的轨迹 = readdir 那个目录 + 前缀过滤 = **零内容读取**。
//   （仍然是同一句判据：.traces 当年 154 个文件 / 25MB / 单个最大 1.15MB，
//    逐个读头不可接受。）
//
// 为什么不再解析文件名拿 sessionId：归属由**目录**表达，文件名只承载 runId。
// 从名字反解会话 id 只会造出第二个真相 —— 那正是 2026-09-14 那条"结构不会忘、
// 字段会忘"的教训。
// ============================================================

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { TRACE_FILE_PREFIX, TRACE_FILE_SUFFIX } from "../trace";

/**
 * 列出一个会话目录下的全部轨迹文件，按文件名升序。
 *
 * runId 形如 `run_<ISO 时间戳>_<随机>`（定宽、零填充）⇒ 字典序即时间序，
 * 所以这里不必逐个读首行就能排出「上一次 run、这一次 run」。
 *
 * 目录不存在 = 这个会话还没跑过 agent，不是错误。
 */
export async function listTraceFiles(
  sessionDirPath: string,
): Promise<string[]> {
  const entries = await readdir(sessionDirPath, { withFileTypes: true }).catch(
    () => [],
  );

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(TRACE_FILE_PREFIX) &&
        entry.name.endsWith(TRACE_FILE_SUFFIX),
    )
    .map((entry) => join(sessionDirPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}
