"use client";

// ============================================================
// 轨迹区（走纸记录条）—— 把折叠好的行画成时间轴 + 底部统计
// 折叠逻辑在 ../../lib/trace-fold.ts（纯函数），这里只负责渲染
// ============================================================

import type { RefObject } from "react";
import type { SessionStats } from "@/lib/types";
import type { ObservedEvent } from "../../lib/sse";
import type { TraceRow } from "../../lib/trace-fold";
import {
  barWidth,
  formatElapsed,
  formatMs,
  formatTokens,
  inkWidth,
} from "../../lib/format";
import styles from "./trace-rail.module.css";

type TraceRailProps = {
  rows: TraceRow[];
  observed: ObservedEvent[];
  // 会话级累计统计（读数盘）：由服务端从会话文件算出，页面从 useAgentRun 传入
  stats: SessionStats;
  reelRef: RefObject<HTMLDivElement | null>;
};

export function TraceRail({ rows, observed, stats, reelRef }: TraceRailProps) {
  return (
    <aside className={styles.trace}>
      <div className={styles.traceHead}>
        <span className={styles.traceTitle}>Trace</span>
        <span className={styles.traceSub}>运行记录</span>
        <span className={styles.traceClock}>{formatElapsed(observed)}</span>
      </div>

      <div className={styles.traceReel} ref={reelRef}>
        {rows.length === 0 ? (
          <TraceLegend />
        ) : (
          <div className={styles.traceStrip}>
            {rows.map((row, i) => (
              <TraceRowView key={i} row={row} />
            ))}
          </div>
        )}
      </div>

      <div className={styles.traceFoot}>
        <Gauge value={stats.turns} label="轮次" />
        <Gauge value={stats.tools} label="工具调用" />
        <Gauge value={formatTokens(stats.tokens)} label="token" />
      </div>
    </aside>
  );
}

/** 空态里放读法说明：与其写「暂无事件」，不如先教会怎么看这张纸 */
function TraceLegend() {
  const keys = [
    { tone: "turn", text: "轮次分节 T1 / T2" },
    { tone: "model", text: "模型输出，长度随字数" },
    { tone: "tool", text: "工具执行，条长 = 耗时" },
    { tone: "signal", text: "运行信号与审批干预" },
  ];

  return (
    <div className={styles.traceEmpty}>
      <p>发送指令后，这里会从上到下画出这次 run。</p>
      <div className={styles.legend}>
        {keys.map((key) => (
          <span
            key={key.tone}
            className={`${styles.legendRow} legend-${key.tone}`}
          >
            <span className={styles.legendKey} />
            {key.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function TraceRowView({ row }: { row: TraceRow }) {
  // pen-* 是动态笔色，保持全局字符串（见 module.css 注释）
  const cls = `${styles.traceRow} pen-${row.pen}`;

  if (row.kind === "band") {
    return (
      <div className={`${cls} is-band`}>
        <span className={styles.bandLabel}>{row.label}</span>
        <span className={styles.bandRule} />
      </div>
    );
  }

  if (row.kind === "stroke") {
    return (
      <div className={cls}>
        <div className={`${styles.stroke}${row.live ? " is-live" : ""}`}>
          <span className={styles.strokeLabel}>{row.label}</span>
          <span
            className={styles.strokeInk}
            style={{ width: inkWidth(row.size) }}
          />
          <span className={styles.strokeNote}>{row.note}</span>
        </div>
      </div>
    );
  }

  if (row.kind === "span") {
    return (
      <div className={cls}>
        <div className={`${styles.span}${row.live ? " is-running" : ""}`}>
          <span className={styles.spanName}>{row.label}</span>
          <span
            className={styles.spanBar}
            style={{ width: barWidth(row.size) }}
          />
          <span className={styles.spanNote}>
            {row.live ? "运行中" : formatMs(row.size)}
          </span>
          {!row.live && (
            <span className={row.ok ? styles.spanOk : styles.spanBad}>
              {row.ok ? "✓" : "✗"}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cls}>
      <div className={styles.signal}>
        <span className={styles.signalStrong}>{row.label}</span>
        {row.note && <span>{row.note}</span>}
      </div>
    </div>
  );
}

function Gauge({ value, label }: { value: number | string; label: string }) {
  return (
    <span className={styles.gauge}>
      <span className={styles.gaugeValue}>{value}</span>
      <span className={styles.gaugeLabel}>{label}</span>
    </span>
  );
}
