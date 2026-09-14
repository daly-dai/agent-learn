// ============================================================
// use-traces —— 加载某个会话的轨迹（A3）
// ============================================================
//
// 为什么是 hook（AGENTS 11.9）：它有**状态 + 绑定的副作用**（拉取 + 运行中轮询，
// 带清理），不是纯数据变换——纯变换那部分在 `app/lib/trace-layout`。
//
// 一次加载做两件事：
//   1. GET /api/traces?sessionId → 该会话的全部 run 元信息（按时间升序）
//   2. 按**同一顺序**逐个 GET /api/traces/<runId> → entries
//      ⚠️ 这个顺序就是 runIndex 的来源（`loaded[i].runIndex = i`），必须与
//      列表接口的顺序一致——`buildTraceView` 靠它把元信息对回记录，见那里的注释。
//
// 运行中的实时跟随：**一期从简——整份重取**（2 秒一次）。等轨迹文件大到重取有
// 痛感了再改增量（只取最后一个 run 的新 entries），那是二期。
// ============================================================

import { useEffect, useState } from "react";
import type { TraceMeta } from "@/lib/trace";
import { fetchTraceRun, fetchTraceRuns } from "@/app/services/chat";
import { foldTrace, type TraceFold, type TraceRun } from "@/app/lib/trace-steps";

const LIVE_POLL_MS = 2_000;

const EMPTY_FOLD: TraceFold = {
  records: [],
  outline: { turns: [], steps: 0, errors: [] },
};

export type TracesState = {
  /** 与 fold 里的 runIndex 一一对应（下标即 runIndex） */
  runs: Array<TraceMeta | undefined>;
  fold: TraceFold;
  loading: boolean;
  error?: string;
};

export function useTraces(
  sessionId: string,
  options: { enabled: boolean; live: boolean },
): TracesState {
  const [runs, setRuns] = useState<Array<TraceMeta | undefined>>([]);
  const [fold, setFold] = useState<TraceFold>(EMPTY_FOLD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // 只在真正需要时拉：没打开轨迹 tab（enabled=false）就不发请求
  const { enabled, live } = options;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { runs: metas } = await fetchTraceRuns(sessionId, {
          signal: controller.signal,
        });
        const loaded: TraceRun[] = [];
        for (const [runIndex, meta] of metas.entries()) {
          const { entries } = await fetchTraceRun(sessionId, meta.runId, {
            signal: controller.signal,
          });
          loaded.push({ runIndex, entries });
        }
        if (cancelled) return;
        setRuns(metas);
        setFold(foldTrace(loaded));
        setError(undefined);
      } catch (e) {
        // 卸载/切会话导致的 abort 不是错误——静默退出
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    // live 变化（run 开始/结束）也会重跑本 effect → 结束时自动补一次完整加载
    const timer = live ? setInterval(() => void load(), LIVE_POLL_MS) : undefined;

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
    };
  }, [sessionId, enabled, live]);

  return { runs, fold, loading, error };
}
