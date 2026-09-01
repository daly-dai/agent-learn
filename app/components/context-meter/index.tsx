"use client";

// ============================================================
// ContextMeter —— 上下文占用圆环（C13，抄 DSH ContextMeter）
// ============================================================
// 形态：发送按钮旁的 14px SVG 圆环（strokeDasharray 按百分比填充），
// 点击展开面板：占用百分比 + 数字（~32K / 128K）+ 条形图。
// 数据源：后端 fetchHistory / done 帧携带的 contextPressure。
// 抄 DSH `ui-conversation/src/client/skeleton/ContextMeter.tsx`：
//   - contextOccupancy 纯函数算 percent（app/lib/context-occupancy.ts）
//   - 无数据（分子或容量未知）→ 不渲染（优雅降级）
//   - 外部点击 / Esc 关闭（Menu 同款模式）
// 简化（vs DSH）：无 Tooltip 原语（用 title）；无 system/tools/messages
// 分段 breakdown（后端暂无该 heuristics，留接口）。
// ============================================================

import { useEffect, useRef, useState } from "react";
import styles from "./context-meter.module.css";
import { contextOccupancy, type ContextPressure } from "@/app/lib/context-occupancy";

/** 圆环几何：14px viewBox、2px stroke */
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 紧凑数字格式：<1K 原样、<1M 用 K、否则 M（DSH formatTokens 同款） */
function formatTokens(value: number): string {
  const scaled = (candidate: number): string =>
    candidate >= 100
      ? String(Math.round(candidate))
      : String(Math.round(candidate * 10) / 10);
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`;
  return `${scaled(value / 1_000_000)}M`;
}

export function ContextMeter({ pressure }: { pressure: ContextPressure | undefined }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const context = contextOccupancy(pressure);
  const available = context !== null;

  // 数据消失（切模型/清空）时关闭已开面板，不保留过期 UI
  useEffect(() => {
    if (!available && open) setOpen(false);
  }, [available, open]);

  // 外部点击 / Esc 关闭（Menu 同款模式）
  useEffect(() => {
    if (!open || !available) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [available, open]);

  if (context === null) return null;
  const percent = context.percent;
  const reading = `${percent}%`;

  return (
    <span ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        data-high={percent >= 75} // 高占用警示色（CSS .trigger[data-high]）
        title={`上下文已用 ${reading}（约 ${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}）`}
        aria-label={`上下文已用 ${reading}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle className={styles.track} cx="7" cy="7" r={RADIUS} />
          <circle
            className={styles.fill}
            cx="7"
            cy="7"
            r={RADIUS}
            strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>
      {open && (
        <div className={styles.panel} role="dialog" aria-label={`上下文已用 ${reading}`}>
          <div className={styles.header}>
            <span className={styles.percent}>{reading}</span>
            <span className={styles.headline}>上下文已用</span>
            <span className={styles.figures}>
              {`~${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}`}
            </span>
          </div>
          <div className={styles.bar}>
            <div
              className={styles.segment}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
    </span>
  );
}
