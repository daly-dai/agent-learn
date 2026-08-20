"use client";

// ============================================================
// 铭牌 —— 页头：标志 / 标题 / run 信息 / 状态灯 / 清空按钮
// ============================================================
// 停止按钮不在页头：它是高频操作，放在输入框旁（发送按钮在 run
// 进行中变成「停止」），见 page.tsx console 区——操作位置跟随
// 用户视线，这是 Phase 4 遗留体验问题的修正。
// ============================================================

import { shortId } from "../lib/format";

// 状态灯的四档（相位）：由页面根据最近事件推导，这里只负责文案
export const PHASES = {
  idle: "待命",
  thinking: "思考中",
  tool: "执行工具",
  streaming: "输出中",
} as const;

export type Phase = keyof typeof PHASES;

type NameplateProps = {
  runId: string;
  model: string;
  phase: Phase;
  turn: number;
  canReset: boolean;
  onReset: () => void;
};

export function Nameplate({
  runId,
  model,
  phase,
  turn,
  canReset,
  onReset,
}: NameplateProps) {
  return (
    <header className="nameplate">
      <PenMark />
      <span className="wordmark">Teaching Agent</span>
      <span className="plate-rule" />
      <span className="wordmark-cn">观测台</span>

      <div className="plate-right">
        {runId && (
          <span className="readout-run" title={`run ${runId} · ${model}`}>
            <span className="model">{model}</span>
            <span className="plate-rule" />
            <span className="run">run {shortId(runId)}</span>
          </span>
        )}
        <StatusBeacon phase={phase} turn={turn} />
        <button className="btn" onClick={onReset} disabled={!canReset}>
          清空记录
        </button>
      </div>
    </header>
  );
}

/** 标志：一段笔迹。它和轨迹区画的是同一件事 */
function PenMark() {
  return (
    <svg className="mark" width="21" height="21" viewBox="0 0 21 21" aria-hidden="true">
      <path
        d="M1.5 14.5H5L7.5 6l3 10.5L13 10l2 2h4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusBeacon({ phase, turn }: { phase: Phase; turn: number }) {
  return (
    <span className={`beacon beacon-${phase}`}>
      <span className="beacon-lens" />
      <span className="beacon-label">{PHASES[phase]}</span>
      {turn > 0 && <span className="beacon-turn">T{turn}</span>}
    </span>
  );
}
