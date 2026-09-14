// ============================================================
// TraceViewer —— A3 轨迹视图
// ============================================================
// 形态基准：`workspace/prototype-a3-trace-viewer.html`（已确认的静态原型）。
//
// 职责边界（AGENTS 11.9）：**这个组件只负责画**。层次（run / 轮次 / 记录）
// 由 `app/lib/trace-layout` 的 buildTraceView 排好，它不做数据变换、不碰全局。
//
// 它自己只持两个状态，都是纯 UI 状态，不该往上提：
//   onlyErrors  —— 工具栏那个过滤器
//   errorCursor —— 「下一个错误」转到第几个
// 记录的展开/收起交给原生 `<details>`：键盘可用、零 state、语义正确。
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceMeta } from "@/lib/trace";
import {
  buildTraceView,
  type RunSeparator,
  type TurnSeparator,
  type TraceViewItem,
} from "@/app/lib/trace-layout";
import type { TraceFold, TraceRecord, TraceRecordKind } from "@/app/lib/trace-steps";
import { formatClock, formatMs, formatTokens } from "@/app/lib/format";
import { useStickyScroll } from "@/app/lib/use-sticky-scroll";
import styles from "./index.module.css";

type TraceViewerProps = {
  fold: TraceFold;
  /** 与 fold 的 runIndex 一一对应（下标即 runIndex） */
  runs: Array<TraceMeta | undefined>;
  loading: boolean;
};

export function TraceViewer({ fold, runs, loading }: TraceViewerProps) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [errorCursor, setErrorCursor] = useState(0);
  const reelRef = useRef<HTMLDivElement>(null);
  const follow = useStickyScroll(reelRef);

  const { items, counts } = useMemo(
    () => buildTraceView(fold, runs, { onlyErrors }),
    [fold, runs, onlyErrors],
  );

  // 新记录到达时吸底跟随；用户往上滚就停（「是否停靠」由 useStickyScroll 判定）
  useEffect(() => {
    if (!follow) return;
    const reel = reelRef.current;
    reel?.scrollTo(0, reel.scrollHeight);
  }, [items.length, follow]);

  function jumpToNextError() {
    const ids = fold.outline.errors;
    if (ids.length === 0) return;

    const target = ids[errorCursor % ids.length];
    setErrorCursor((cursor) => (cursor + 1) % ids.length);

    // 记录 id 形如 `0:3`（runIndex:seq）——放进带引号的属性选择器即可，无需转义
    const node = reelRef.current?.querySelector(`[data-trace-id="${target}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.bar}>
        <span className={styles.read}>
          {counts.runs} 次运行 · {counts.turns} 轮 · {counts.steps} 步
          {counts.errors > 0 ? (
            <em className={styles.errRead}> · {counts.errors} 个错误</em>
          ) : null}
        </span>
        <button
          type="button"
          className={styles.btn}
          aria-pressed={onlyErrors}
          onClick={() => setOnlyErrors((on) => !on)}
        >
          只看错误
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          onClick={jumpToNextError}
          disabled={counts.errors === 0}
        >
          下一个错误 <span className={styles.k}>↓</span>
        </button>
      </div>

      <div className={styles.reel} ref={reelRef}>
        <div className={styles.sheet}>
          {items.length > 0 ? (
            items.map((item) => renderItem(item, runs))
          ) : (
            <p className={styles.empty}>{emptyText(loading, onlyErrors)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 渲染（纯函数，无状态） ============

function renderItem(item: TraceViewItem, runs: Array<TraceMeta | undefined>) {
  if (item.kind === "run") return renderRun(item);
  if (item.kind === "turn") return renderTurn(item);
  return renderRecord(item.record, runs[item.record.runIndex]);
}

/** run 分隔行：轴在这里断开（本行不画轴线），右端报这次运行的状态 */
function renderRun(item: RunSeparator) {
  return (
    <div key={item.key} className={styles.runHead}>
      <span className={styles.runLabel}>第 {item.runIndex + 1} 次运行</span>
      <span className={styles.runRule} />
      <span
        className={styles.runState}
        data-broken={item.meta ? String(!item.meta.completed) : undefined}
      >
        {runState(item.meta, item.shown)}
      </span>
    </div>
  );
}

function renderTurn(item: TurnSeparator) {
  return (
    <div key={item.key} className={styles.turn}>
      <span className={styles.n}>T{item.turn}</span>
      {item.prompt ? <span className={styles.preview}>{item.prompt}</span> : null}
    </div>
  );
}

function renderRecord(record: TraceRecord, meta: TraceMeta | undefined) {
  const isTool = record.kind === "tool" || record.kind === "error";

  return (
    <details
      key={record.id}
      className={`${styles.rec} ${styles[PEN_CLASS[record.kind]]}`}
    >
      <summary className={styles.row} data-trace-id={record.id}>
        <span className={styles.label}>{labelOf(record)}</span>

        <div className={styles.body}>
          {isTool ? (
            <>
              <span className={styles.tool}>{record.label}</span>
              <div className={styles.io}>
                <span className={styles.k}>入参</span>
                <span className={styles.v}>{record.argsText || "—"}</span>
              </div>
              <div className={`${styles.io} ${record.kind === "error" ? styles.err : ""}`}>
                <span className={styles.k}>出参</span>
                <span className={styles.v}>{record.resultText || "（无输出）"}</span>
              </div>
            </>
          ) : record.text ? (
            <div className={styles.text}>{record.text}</div>
          ) : (
            /* 只调工具、没有正文的助手消息（真实存在：助手消息里只有 toolCall 块）。
               措辞沿用 DSH ui-trajectory 的 `（仅工具调用）`——不自创文案。 */
            <div className={styles.quiet}>（仅工具调用）</div>
          )}
        </div>

        <span className={styles.data}>{dataOf(record, meta)}</span>
      </summary>

      {expanded(record, isTool)}
    </details>
  );
}

function expanded(record: TraceRecord, isTool: boolean) {
  if (isTool) {
    return (
      <div className={styles.more}>
        <div className={styles.hd}>入参 · 完整</div>
        <pre>{record.argsText || "—"}</pre>
        <div className={styles.hd}>出参 · 完整</div>
        <pre>{record.resultText || "（无输出）"}</pre>
      </div>
    );
  }

  if (!record.text) return null;
  return (
    <div className={styles.more}>
      <div className={styles.hd}>完整正文</div>
      <pre>{record.text}</pre>
    </div>
  );
}

// ============ 小纯函数 ============

const PEN_CLASS: Record<TraceRecordKind, string> = {
  user: "pen-user",
  model: "pen-model",
  tool: "pen-tool",
  error: "pen-error",
  signal: "pen-signal",
};

function labelOf(record: TraceRecord): string {
  if (record.kind === "user") return "指令";
  if (record.kind === "model") return "输出";
  if (record.kind === "signal") return "▸ 信号";
  return "▸ 工具";
}

/**
 * 右侧数据列。原则：**不编造**。
 * 流式进行中的输出还没有 tokens、正在跑的工具还没有耗时——那就只显示已有的，
 * 而不是补一个 0 或一个假数字（详案 §3.1 定的）。
 */
function dataOf(record: TraceRecord, meta: TraceMeta | undefined): string {
  if (record.kind === "user") return `${record.chars ?? 0} 字`;

  if (record.kind === "model") {
    // 只调工具、没有正文时字数是 0——"0 字"是真的，但读起来像出错，
    // 而且右边空一列像渲染坏了。没值的那一项就不显示（DSH 同款处理）。
    const chars = record.chars ? `${record.chars} 字` : "";
    const tokens =
      record.tokens === undefined ? "" : `${formatTokens(record.tokens)} tok`;
    return [chars, tokens].filter(Boolean).join(" · ") || "—";
  }

  if (record.kind === "signal") return "";

  if (record.durationMs !== undefined) return formatMs(record.durationMs);
  // 没有耗时：区分「还在跑」和「跑一半就断了」——含糊比没有更糟
  return meta?.completed === false ? "中断" : "运行中";
}

function runState(meta: TraceMeta | undefined, shown: number): string {
  const size = `${shown} 条`;
  if (!meta) return size; // 元信息还没加载回来（先显示能显示的）
  return `${formatClock(meta.startedAt)} · ${size} · ${meta.completed ? "完整" : "中断"}`;
}

/** 空态不是"没有数据"，是"还没开始"——给一句能让人动手的话 */
function emptyText(loading: boolean, onlyErrors: boolean): string {
  if (loading) return "正在读取轨迹…";
  if (onlyErrors) return "这次会话没有出错的记录。";
  return "这次会话还没有轨迹。发一条消息，这里就会开始记录。";
}
