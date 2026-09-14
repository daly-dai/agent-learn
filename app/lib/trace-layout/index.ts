// ============================================================
// trace-layout —— 把折叠结果 + run 元信息排成「视图行」（纯函数）
// ============================================================
//
// 为什么单独一层（AGENTS 11.9）：这是**纯数据变换**，不含 React 状态/副作用，
// 所以它属于 `app/lib/` 而不是组件里的 useMemo——node 环境可单测，不用 jsdom。
//
// 它干三件事：
//   1. 插「run 分隔」与「轮次分隔」——把平铺 records 排成有层次的视图行
//   2. 「只看错误」过滤：过滤**记录**，然后**重建**分隔条（不留空壳）
//   3. 工具栏读数（总量）
//
// ⚠️ **runIndex 的约定（重要的隐式契约，写在这里以免以后忘）**：
//   `runMetas[i]` 就代表 `runIndex === i`。两边顺序由**同一个**排序决定——
//   `listTraceFiles` 按 runId 升序（runId 含定宽 ISO 时间戳 → 字典序 = 时间序）。
//   客户端的加载顺序必须与它一致：先取列表、再按同一顺序取每个 run 的 entries。
//   列表接口会把"不是轨迹"的文件丢掉，客户端也就不会去取它，所以两边不会错位。
// ============================================================

import type { TraceMeta } from "@/lib/trace";
import type { TraceFold, TraceRecord } from "@/app/lib/trace-steps";

/** run 分隔条（A3 决策 e：多次 run 是一条连续时间线，用分隔条标记边界） */
export type RunSeparator = {
  kind: "run";
  key: string;
  runIndex: number;
  /** 列表接口给的元信息（可能还没加载回来） */
  meta?: TraceMeta;
  /** 这个 run 下**当前可见**的记录条数——与它下面真正渲染出来的行数一致 */
  shown: number;
};

/** 轮次分隔条（对应原型的 T1 / T2 刻度） */
export type TurnSeparator = {
  kind: "turn";
  key: string;
  runIndex: number;
  turn: number;
  /** 该轮首条人类指令的封顶预览；该轮没有人类消息时为空串 */
  prompt: string;
};

export type RecordItem = {
  kind: "record";
  key: string;
  record: TraceRecord;
};

export type TraceViewItem = RunSeparator | TurnSeparator | RecordItem;

/** 工具栏读数——**总量**，不随「只看错误」变化（读数描述的是这次运行） */
export type TraceCounts = {
  runs: number;
  turns: number;
  steps: number;
  errors: number;
};

export type TraceView = {
  items: TraceViewItem[];
  counts: TraceCounts;
};

export function buildTraceView(
  fold: TraceFold,
  runMetas: Array<TraceMeta | undefined>,
  options: { onlyErrors?: boolean } = {},
): TraceView {
  const visible = options.onlyErrors
    ? fold.records.filter((record) => record.kind === "error")
    : fold.records;

  const recordsByRun = groupByRun(visible);
  const prompts = promptLookup(fold);

  const items: TraceViewItem[] = [];
  for (let runIndex = 0; runIndex < runMetas.length; runIndex++) {
    const records = recordsByRun.get(runIndex) ?? [];

    // 「只看错误」时，一条错都没有的 run 不占位——空分隔条只是噪音。
    // 不过滤时**哪怕 0 条也要出现**：崩掉的残 run（completed: false、没写几条）
    // 恰恰是最需要被看见的那种，不能因为它空就消失。
    if (options.onlyErrors && records.length === 0) continue;

    items.push({
      kind: "run",
      key: `run-${runIndex}`,
      runIndex,
      meta: runMetas[runIndex],
      shown: records.length,
    });

    let lastTurn = -1;
    for (const record of records) {
      // 轮次号在每个 run 内从 1 重来，所以 lastTurn 在 run 边界重置
      if (record.turn !== lastTurn) {
        lastTurn = record.turn;
        items.push({
          kind: "turn",
          key: `turn-${runIndex}-${record.turn}`,
          runIndex,
          turn: record.turn,
          prompt: prompts.get(`${runIndex}:${record.turn}`) ?? "",
        });
      }
      items.push({ kind: "record", key: record.id, record });
    }
  }

  return {
    items,
    counts: {
      runs: runMetas.length,
      turns: fold.outline.turns.length,
      steps: fold.records.length,
      errors: fold.outline.errors.length,
    },
  };
}

// ------------------------------------------------------------
// 纯辅助
// ------------------------------------------------------------

function groupByRun(records: TraceRecord[]): Map<number, TraceRecord[]> {
  const grouped = new Map<number, TraceRecord[]>();
  for (const record of records) {
    const bucket = grouped.get(record.runIndex);
    if (bucket) bucket.push(record);
    else grouped.set(record.runIndex, [record]);
  }
  return grouped;
}

/** `runIndex:turn` → 该轮指令预览（轮次号跨 run 重复，所以键必须带 runIndex） */
function promptLookup(fold: TraceFold): Map<string, string> {
  return new Map(
    fold.outline.turns.map((turn) => [`${turn.runIndex}:${turn.turn}`, turn.prompt]),
  );
}
