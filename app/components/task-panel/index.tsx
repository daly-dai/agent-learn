"use client";

// ============================================================
// TaskPanel —— 任务面板（Phase 5 + 2026-08-24 增补关闭交互）
// ============================================================
// 形态抄 Reasonix TodoPanel（走读 18）：进度徽章 done/total + 当前任务 +
// 状态标签 + 折叠（默认收起，头部常驻显示进度）。
//
// 只读展示：todo 的唯一写者是模型（todo_write 工具整表替换），前端不直接改
// ——保持单一写者，避免"前端改 + 模型改"两条写路径打架（DSH/Reasonix 同款）。
//
// 关闭交互（抄 Reasonix todoVisibility）：未完成任务强制可见（忽略 dismissed），
// 全部完成才出现 × 关闭按钮，关闭状态持久化到 localStorage（按 sessionId 隔离）。
// 判定是派生状态（幂等）：show = 有清单 && (有未完成 || 未关闭)——每次渲染重算，
// 新任务（未完成）到来面板自动复活，无需额外逻辑。
// ============================================================

import { useState } from "react";
import type { TodoItem } from "@/lib/types";
import styles from "./task-panel.module.css";

type TaskPanelProps = {
  todos: TodoItem[];
  sessionId?: string; // 关闭状态按会话隔离；空（会话未就绪）时不持久化
};

const STATUS_LABEL: Record<TodoItem["status"], string> = {
  pending: "待办",
  in_progress: "进行中",
  completed: "已完成",
};

const dismissKey = (sessionId: string) => `todoPanel:dismissed:${sessionId}`;

export function TaskPanel({ todos, sessionId }: TaskPanelProps) {
  // 默认收起：头部常驻显示进度，展开才看明细（Reasonix 同款：新批次默认折叠）
  const [open, setOpen] = useState(false);
  // 关闭标记（Reasonix 式）：仅"全部完成"时可关闭；localStorage 按会话持久化。
  // 注意 typeof window 防护：Next.js 对 use client 组件也会服务端预渲染，
  // useState 初始化函数在服务端也会执行，那里没有 localStorage。
  const [dismissed, setDismissed] = useState(
    () =>
      !!sessionId &&
      typeof window !== "undefined" &&
      localStorage.getItem(dismissKey(sessionId)) === "1",
  );

  // 空清单不渲染，避免无意义占位
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = todos.length > 0 && done === todos.length;
  const hasIncomplete = todos.some((t) => t.status !== "completed");
  // 核心判定（派生状态）：有未完成 → 强制显示（即使已关闭）；全完成且已关闭 → 隐藏。
  // 新任务（未完成）到来自动复活——hasIncomplete 直接短路，不需要清 dismissed。
  const show = todos.length > 0 && (hasIncomplete || !dismissed);
  if (!show) return null;

  // 当前任务 = 唯一的 in_progress；全完成时头部直接显示"全部完成"
  const current = todos.find((t) => t.status === "in_progress");
  // 头部摘要：当前任务 → 全完成文案 → 最后一条，按这个优先级回退
  const summary = current?.content ?? (allDone ? "全部完成" : todos[todos.length - 1]?.content ?? "");

  const handleDismiss = () => {
    setDismissed(true);
    if (sessionId) localStorage.setItem(dismissKey(sessionId), "1");
  };

  return (
    <section className={styles.panel} aria-label="任务清单">
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={styles.title}>任务</span>
        <span className={styles.badge}>
          {done}/{todos.length}
        </span>
        <span className={styles.meta}>{summary}</span>
        <span className={styles.toggle} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {/* 关闭按钮（Reasonix 式）：仅全部完成时出现。放 header 外避免
          button 嵌套 button（HTML 非法）；绝对定位在面板右上角。 */}
      {allDone && (
        <button
          type="button"
          className={styles.close}
          onClick={handleDismiss}
          aria-label="关闭任务面板"
        >
          ×
        </button>
      )}

      {open && (
        <ul className={styles.list}>
          {todos.map((todo, index) => (
            <li
              key={`${todo.content}-${index}`}
              // 状态动态类：todo-<status>（全局，JSX 拼字符串）决定文本的删除线/加粗/颜色
              className={`${styles.item} todo-${todo.status}`}
            >
              <span className={`${styles.status} ${styles[`status_${todo.status}`]}`}>
                {STATUS_LABEL[todo.status]}
              </span>
              <span className={styles.text}>{todo.content}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
