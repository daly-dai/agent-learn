"use client";

// ============================================================
// 铭牌 —— 页头：标志 / 标题 / run 信息 / 状态灯
// ============================================================
// 停止按钮不在页头：它是高频操作，放在输入框旁（发送按钮在 run
// 进行中变成「停止」），见 page.tsx console 区——操作位置跟随
// 用户视线，这是 Phase 4 遗留体验问题的修正。
//
// V2（2026-08-26）：清空会话功能已删除（用户拍板）——它是 Phase 1
// 单会话时代的遗产，多会话下被「新建/删除」覆盖，且当时连确认弹框
// 都没有（静默抹历史，比删除还危险）。顶栏 ⋯ 菜单随之整个移除，
// 页头只剩信息（run/模型/状态灯），没有任何操作按钮。
// 服务端 DELETE /api/chat 保留，未来斜杠命令（/clear 等）可复用。
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
};

export function Nameplate({ runId, model, phase, turn }: NameplateProps) {
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
      </div>
    </header>
  );
}

/** 标志：一段笔迹。它和轨迹区画的是同一件事 */
function PenMark() {
  return (
    <svg
      className={styles.mark}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M2 16.5H5.7L8.6 6.8l3.4 12 2-8.2 2.3 2.3h5.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
