// ============================================================
// trace-layout —— 把折叠结果排成视图行（A3）
// ============================================================
// 测 seam：buildTraceView(fold, runMetas, { onlyErrors }) → { items, counts }。
// 纯函数、无 React，直接喂 fold 结果断言行序列。
//
// 用例重点在**两处容易错的地方**：
//   ① 轮次号在每个 run 内从 1 重来 → 分隔条不能跨 run 去重
//   ② 空 run：不过滤时要出现（残 run 最需要被看见），「只看错误」时要消失
// ============================================================

import { describe, expect, it } from "vitest";
import type { TraceMeta } from "@/lib/trace";
import type { TraceFold, TraceRecord } from "../trace-steps";
import { buildTraceView } from "./index";

// ---- 造数据：只造 buildTraceView 真正读的字段 ----

function record(partial: Partial<TraceRecord> & { id: string }): TraceRecord {
  return {
    kind: "model",
    runIndex: 0,
    turn: 1,
    label: "输出",
    ...partial,
  };
}

/**
 * 造 fold。`outline.turns` 由 records **推出来**，不给默认值——真实折叠里
 * `turn_start` 一定先于该轮的任何记录，所以"有记录却没有轮次"是不可能的状态，
 * 助手不该造得出来（2026-09-14：就是因为给了 `turns = []` 默认值，
 * 造出了一个非法 fold，让"轮数"断言失败在一个跟被测逻辑无关的地方）。
 *
 * 唯一的例外是 `turn === 0`：那是"还没见过 turn_start"（轨迹从中间开始），
 * 真实折叠里它不会进 outline，这里也照实不造。
 */
function fold(records: TraceRecord[], promptByTurn: Record<string, string> = {}): TraceFold {
  const turns: TraceFold["outline"]["turns"] = [];
  const seen = new Set<string>();

  for (const item of records) {
    if (item.turn <= 0) continue;
    const key = `${item.runIndex}:${item.turn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    turns.push({
      turn: item.turn,
      runIndex: item.runIndex,
      id: `${item.runIndex}:turn-${item.turn}`,
      prompt: promptByTurn[key] ?? "",
      response: "",
    });
  }

  return {
    records,
    outline: {
      turns,
      steps: records.length,
      errors: records.filter((r) => r.kind === "error").map((r) => r.id),
    },
  };
}

function meta(runId: string, completed = true): TraceMeta {
  return {
    runId,
    model: "deepseek-chat",
    sessionId: "s_test",
    startedAt: 1_000,
    completed,
    bytes: 100,
  };
}

/** 行序列的紧凑描述，便于一眼看出层次 */
function shape(items: ReturnType<typeof buildTraceView>["items"]): string[] {
  return items.map((item) => {
    if (item.kind === "run") return `run:${item.runIndex}(${item.shown})`;
    if (item.kind === "turn") return `turn:${item.runIndex}.${item.turn}`;
    return `rec:${item.record.id}`;
  });
}

// ============================================================

describe("buildTraceView：层次与分隔", () => {
  it("一条 run 一条轮：run 分隔 → 轮次分隔 → 记录", () => {
    const view = buildTraceView(
      fold([record({ id: "0:2" }), record({ id: "0:3" })]),
      [meta("run_a")],
    );

    expect(shape(view.items)).toEqual(["run:0(2)", "turn:0.1", "rec:0:2", "rec:0:3"]);
  });

  it("同一轮内多条记录只出一个轮次分隔", () => {
    const view = buildTraceView(
      fold([
        record({ id: "0:2", turn: 1 }),
        record({ id: "0:3", turn: 1 }),
        record({ id: "0:4", turn: 1 }),
      ]),
      [meta("run_a")],
    );

    expect(shape(view.items).filter((s) => s.startsWith("turn"))).toEqual(["turn:0.1"]);
  });

  it("轮次切换时插入新的轮次分隔，并从 outline 取指令预览", () => {
    const view = buildTraceView(
      fold([record({ id: "0:2", turn: 1 }), record({ id: "0:5", turn: 2 })], {
        "0:1": "第一轮的指令",
        "0:2": "第二轮的指令",
      }),
      [meta("run_a")],
    );

    const turns = view.items.filter((item) => item.kind === "turn");
    expect(turns.map((item) => item.prompt)).toEqual(["第一轮的指令", "第二轮的指令"]);
  });

  it("⭐ 轮次号在每个 run 内重新计数：run 1 的第 1 轮不能被当成 run 0 的重复而漏掉", () => {
    const view = buildTraceView(
      fold(
        [
          record({ id: "0:2", runIndex: 0, turn: 1 }),
          record({ id: "1:2", runIndex: 1, turn: 1 }),
        ],
        { "0:1": "第一次的指令", "1:1": "第二次的指令" },
      ),
      [meta("run_a"), meta("run_b")],
    );

    expect(shape(view.items)).toEqual([
      "run:0(1)",
      "turn:0.1",
      "rec:0:2",
      "run:1(1)",
      "turn:1.1",
      "rec:1:2",
    ]);
    // 「第 1 轮」出现两次，但各自取到自己 run 的预览
    const turns = view.items.filter((item) => item.kind === "turn");
    expect(turns.map((item) => item.prompt)).toEqual(["第一次的指令", "第二次的指令"]);
  });

  it("轮次号为 0（轨迹从中间开始，没见过 turn_start）→ 分隔条照出，prompt 空串", () => {
    const view = buildTraceView(fold([record({ id: "0:9", turn: 0 })]), [meta("run_a")]);

    expect(shape(view.items)).toEqual(["run:0(1)", "turn:0.0", "rec:0:9"]);
    const turn = view.items.find((item) => item.kind === "turn");
    expect(turn?.kind === "turn" && turn.prompt).toBe("");
  });

  it("run 元信息带上分隔条（视图要显示开始时间 / 是否中断）", () => {
    const view = buildTraceView(fold([record({ id: "0:2" })]), [meta("run_a", false)]);
    const run = view.items[0];
    expect(run.kind === "run" && run.meta?.completed).toBe(false);
    expect(run.kind === "run" && run.meta?.runId).toBe("run_a");
  });

  it("元信息还没加载回来时也能渲染（meta 为 undefined）", () => {
    const view = buildTraceView(fold([record({ id: "0:2" })]), [undefined]);
    expect(shape(view.items)).toEqual(["run:0(1)", "turn:0.1", "rec:0:2"]);
  });
});

describe("buildTraceView：空 run", () => {
  it("⭐ 不过滤时，0 条记录的 run 也要出现（崩掉的残 run 最需要被看见）", () => {
    const view = buildTraceView(
      fold([record({ id: "0:2" })]),
      [meta("run_a"), meta("run_b", false), meta("run_c")],
    );

    expect(view.items.filter((item) => item.kind === "run").map((item) => item.shown)).toEqual([
      1, 0, 0,
    ]);
  });

  it("「只看错误」时，没有错误的 run 不占空壳", () => {
    const view = buildTraceView(
      fold([
        record({ id: "0:2", runIndex: 0, kind: "model" }),
        record({ id: "1:2", runIndex: 1, kind: "error", label: "bash" }),
      ]),
      [meta("run_a"), meta("run_b")],
      { onlyErrors: true },
    );

    expect(shape(view.items)).toEqual(["run:1(1)", "turn:1.1", "rec:1:2"]);
  });
});

describe("buildTraceView：只看错误", () => {
  const mixed = fold([
    record({ id: "0:2", runIndex: 0, turn: 1, kind: "user", label: "指令" }),
    record({ id: "0:3", runIndex: 0, turn: 1, kind: "model" }),
    record({ id: "0:4", runIndex: 0, turn: 2, kind: "error", label: "bash" }),
    record({ id: "0:6", runIndex: 0, turn: 2, kind: "tool", label: "grep" }),
  ]);

  it("只剩错误记录，但保留它所在的 run / 轮次上下文", () => {
    const view = buildTraceView(mixed, [meta("run_a")], { onlyErrors: true });
    expect(shape(view.items)).toEqual(["run:0(1)", "turn:0.2", "rec:0:4"]);
  });

  it("不过滤时全都出来", () => {
    const view = buildTraceView(mixed, [meta("run_a")]);
    expect(shape(view.items)).toEqual([
      "run:0(4)",
      "turn:0.1",
      "rec:0:2",
      "rec:0:3",
      "turn:0.2",
      "rec:0:4",
      "rec:0:6",
    ]);
  });

  it("⭐ counts 是总量，不随过滤变化（读数描述的是这次运行）", () => {
    const all = buildTraceView(mixed, [meta("run_a")]).counts;
    const errorsOnly = buildTraceView(mixed, [meta("run_a")], { onlyErrors: true }).counts;

    expect(errorsOnly).toEqual(all);
    expect(all).toEqual({ runs: 1, turns: 2, steps: 4, errors: 1 });
  });

  it("shown 是「当前可见条数」，与它下面真正渲染的行数一致", () => {
    const view = buildTraceView(mixed, [meta("run_a")], { onlyErrors: true });
    const run = view.items.find((item) => item.kind === "run");
    const recordsBelow = view.items.filter((item) => item.kind === "record").length;

    expect(run?.kind === "run" && run.shown).toBe(recordsBelow);
  });
});

describe("buildTraceView：行 key", () => {
  it("⭐ 所有 key 唯一（React 列表要用它，重复会静默错渲染）", () => {
    const view = buildTraceView(
      fold(
        [
          record({ id: "0:2", runIndex: 0, turn: 1 }),
          record({ id: "0:3", runIndex: 0, turn: 2 }),
          record({ id: "1:2", runIndex: 1, turn: 1 }),
        ],
        { "0:1": "a", "0:2": "b", "1:1": "c" },
      ),
      [meta("run_a"), meta("run_b")],
    );

    const keys = view.items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
