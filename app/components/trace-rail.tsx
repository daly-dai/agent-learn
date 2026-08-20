"use client";

// ============================================================
// 轨迹区（走纸记录条）—— 把折叠好的行画成时间轴 + 底部统计
// 折叠逻辑在 ../lib/trace-fold.ts（纯函数），这里只负责渲染
// ============================================================

import type { RefObject } from "react";
import type { SessionStats } from "@/lib/types";
import type { ObservedEvent } from "../lib/sse";
import type { TraceRow } from "../lib/trace-fold";
import {
  barWidth,
  formatElapsed,
  formatMs,
  formatTokens,
  inkWidth,
} from "../lib/format";

type TraceRailProps = {
  rows: TraceRow[];
  observed: ObservedEvent[];
  // 会话级累计统计（读数盘）：由服务端从会话文件算出，页面从 useAgentRun 传入
  stats: SessionStats;
  reelRef: RefObject<HTMLDivElement | null>;
};

export function TraceRail({ rows, observed, stats, reelRef }: TraceRailProps) {
  return (
    <aside className="trace">
      <div className="trace-head">
        <span className="trace-title">Trace</span>
        <span className="trace-sub">运行记录</span>
        <span className="trace-clock">{formatElapsed(observed)}</span>
      </div>

      <div className="trace-reel" ref={reelRef}>
        {rows.length === 0 ? (
          <TraceLegend />
        ) : (
          <div className="trace-strip">
            {rows.map((row, i) => (
              <TraceRowView key={i} row={row} />
            ))}
          </div>
        )}
      </div>

      <div className="trace-foot">
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
    <div className="trace-empty">
      <p>发送指令后，这里会从上到下画出这次 run。</p>
      <div className="legend">
        {keys.map((key) => (
          <span key={key.tone} className={`legend-row legend-${key.tone}`}>
            <span className="legend-key" />
            {key.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function TraceRowView({ row }: { row: TraceRow }) {
  const cls = `trace-row pen-${row.pen}`;

  if (row.kind === "band") {
    return (
      <div className={`${cls} is-band`}>
        <span className="band-label">{row.label}</span>
        <span className="band-rule" />
      </div>
    );
  }

  if (row.kind === "stroke") {
    return (
      <div className={cls}>
        <div className={`stroke${row.live ? " is-live" : ""}`}>
          <span className="stroke-label">{row.label}</span>
          <span className="stroke-ink" style={{ width: inkWidth(row.size) }} />
          <span className="stroke-note">{row.note}</span>
        </div>
      </div>
    );
  }

  if (row.kind === "span") {
    return (
      <div className={cls}>
        <div className={`span${row.live ? " is-running" : ""}`}>
          <span className="span-name">{row.label}</span>
          <span className="span-bar" style={{ width: barWidth(row.size) }} />
          <span className="span-note">
            {row.live ? "运行中" : formatMs(row.size)}
          </span>
          {!row.live && (
            <span className={row.ok ? "span-ok" : "span-bad"}>
              {row.ok ? "✓" : "✗"}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cls}>
      <div className="signal">
        <span className="signal-strong">{row.label}</span>
        {row.note && <span>{row.note}</span>}
      </div>
    </div>
  );
}

function Gauge({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="gauge">
      <span className="gauge-value">{value}</span>
      <span className="gauge-label">{label}</span>
    </span>
  );
}
