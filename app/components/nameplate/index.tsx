"use client";

// ============================================================
// 铭牌 —— 页头：标志 / 标题 / run 信息 / 状态灯 / 清空按钮
// ============================================================
// 停止按钮不在页头：它是高频操作，放在输入框旁（发送按钮在 run
// 进行中变成「停止」），见 page.tsx console 区——操作位置跟随
// 用户视线，这是 Phase 4 遗留体验问题的修正。
// ============================================================

import styles from "./nameplate.module.css";
import { shortId } from "../../lib/format";

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
    <header className={styles.nameplate}>
      <PenMark />
      <span className={styles.wordmark}>Teaching Agent</span>
      <span className={styles.plateRule} />
      <span className={styles.wordmarkCn}>观测台</span>

      <div className={styles.plateRight}>
        {runId && (
          <span
            className={styles.readoutRun}
            title={`run ${runId} · ${model}`}
          >
            <span className={styles.model}>{model}</span>
            <span className={styles.plateRule} />
            <span className={styles.run}>run {shortId(runId)}</span>
          </span>
        )}
        {/* 相位是动态值，beacon-${phase} 保持全局字符串（见 module.css 注释） */}
        <span className={`${styles.beacon} beacon-${phase}`}>
          <span className={styles.beaconLens} />
          <span className={styles.beaconLabel}>{PHASES[phase]}</span>
          {turn > 0 && <span className={styles.beaconTurn}>T{turn}</span>}
        </span>
        {/* .btn 是跨组件共享按钮类，留在全局层 */}
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
    <svg
      className={styles.mark}
      width="21"
      height="21"
      viewBox="0 0 21 21"
      aria-hidden="true"
    >
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
