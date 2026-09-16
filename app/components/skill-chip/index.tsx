"use client";

// ============================================================
// SkillChip —— 输入框内上沿的「已挂技能」标签（C8 T6 · R4-1）
// ============================================================
// 为什么是"框内上沿一个标签"，而不是"把框内那段文字高亮"（R4-1 定的 A 案）：
// 我们的输入框是**纯 `<textarea>`**，HTML 层面**没法给其中一段文字单独上样式**。
// B 案（textarea 透明 + 后面垫一层同步渲染的 div）观感更接近 DSH，但字体 / 换行 /
// 滚动 / 输入法都要完全对齐，属于"把 textarea 换成富输入"那一类改动 —— 记为
// 升级路径，等 **C31（输入框改造）** 收编。
// **代价照实说**：这不是字面意义的"高亮"，是一个可点的标签。
//
// ⚠️ 它**不是**提交分流的数据源：分流看的是输入框里的文本 + 快照（见
// use-command-menu 的 submit），所以 chip 永远不会和文本走散。
// ============================================================

import styles from "./index.module.css";

type SkillChipProps = {
  /** 技能名（身份 = 目录名） */
  name: string;
  /** 点 × —— 摘掉这个技能，**保留你后面打的要求** */
  onClear: () => void;
};

export function SkillChip({ name, onClear }: SkillChipProps) {
  return (
    <div className={styles.chipRow}>
      <span className={styles.chip}>
        <span className={styles.mark}>技能</span>
        <span className={styles.name}>/{name}</span>
        <button
          className={styles.clear}
          type="button"
          onClick={onClear}
          aria-label={`取消技能 ${name}`}
        >
          ×
        </button>
      </span>
    </div>
  );
}
