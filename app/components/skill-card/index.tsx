"use client";

// ============================================================
// skill-card —— 「宿主往上下文里注入了一块东西」的卡片（C8 T7）
// ============================================================
// 为什么必须有这张卡：手势加载（你打 `/名字`）注入的是一条 **role="user"**
// 的消息，而 message-row 把任何 user 消息都渲染成「你」说的话 —— 那是
// **事实错误**（那句话不是你打的）。所以这条消息不进 Row：没有发言人栏，
// 也就没有"你"这个标签。
//
// 形状**继承** CompactionCard（压缩摘要卡，同一族的先例）：独立卡片、
// 虚线边、默认折叠、点 head 展开。区别只有两处，都写在样式文件里：
//   - tag 用「信号笔」色（不是用户的蓝）—— 它是系统插进来的，不是你说的话
//   - 展开后是**原文载荷**，用等宽 + pre-wrap（它是给模型看的原文，不是散文）
// ============================================================

import { useState } from "react";
import styles from "./index.module.css";

type SkillCardProps = {
  /** 技能名（身份 = 目录名），展示成 `/名字` —— 跟你在输入框里打的对得上 */
  name: string;
  /** 注入给模型的**原文**（信封 + 正文），默认折叠，点开才看 */
  payload: string;
};

export function SkillCard({ name, payload }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.card}>
      <button
        className={styles.head}
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={styles.tag}>上下文注入</span>
        <span className={styles.name}>/{name}</span>
        {/* 它吃了多少上下文 —— 折着也能看见，因为这是这张卡唯一量化的代价 */}
        <span className={styles.meta}>{payload.length} 字符</span>
        <span className={styles.toggle}>{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded && (
        <div className={styles.body}>
          <pre className={styles.payload}>{payload}</pre>
        </div>
      )}
    </div>
  );
}
