"use client";

// ============================================================
// 空态起手式 —— 会话为空时展示的引导 + 例句按钮
// ============================================================

import styles from "./overture.module.css";

// 每条都标注它会练到哪个工具（最后一条故意不需要工具）
const SEEDS = [
  { text: "列出工作区文件", tool: "list_files" },
  { text: "读取 agent-notes.md", tool: "read_file" },
  { text: "把 Agent Loop 的要点写成笔记", tool: "write_note" },
  { text: "什么是 Agent Loop？", tool: "不调用工具，直接回答" },
];

export function Overture({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className={styles.overture}>
      <p className={styles.overtureEyebrow}>多轮对话 · 会话记忆已开启</p>
      <h1 className={styles.overtureTitle}>
        给它一个目标，看它怎么一步步做完。
      </h1>
      <p className={styles.overtureNote}>
        每次发送开始一次新的 run，之前的对话会被记住，模型带着完整上下文回答。
        右边的记录条会同步画出这次 run 的全过程：
        分成几轮、调了哪些工具、每步花了多久。
      </p>
      <div className={styles.seedGrid}>
        {SEEDS.map((seed) => (
          <button
            key={seed.text}
            className={styles.seed}
            type="button"
            onClick={() => onPick(seed.text)}
          >
            <span className={styles.seedText}>{seed.text}</span>
            <span className={styles.seedTool}>{seed.tool}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
