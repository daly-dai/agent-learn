"use client";

// ============================================================
// TaskPanel —— 任务面板（Phase 5）
// ============================================================
// 形态抄 Reasonix TodoPanel（走读 18）：进度徽章 done/total + 当前任务 +
// 状态标签 + 折叠（默认收起，头部常驻显示进度）。
//
// 只读展示：todo 的唯一写者是模型（todo_write 工具整表替换），前端不直接改
// ——保持单一写者，避免"前端改 + 模型改"两条写路径打架（DSH/Reasonix 同款）。
//
// 数据源：useAgentRun 的 todos（GET 历史恢复 + tool_todo 帧实时 + done 帧权威）
// ============================================================

import { useState } from "react";
import type { TodoItem } from "@/lib/types";
import styles from "./task-panel.module.css";

type TaskPanelProps = {
  todos: TodoItem[];
};

const STATUS_LABEL: Record<TodoItem["status"], string> = {
  pending: "待办",
  in_progress: "进行中",
  completed: "已完成",
};

export function TaskPanel({ todos }: TaskPanelProps) {
  // 默认收起：头部常驻显示进度，展开才看明细（Reasonix 同款：新批次默认折叠）
  const [open, setOpen] = useState(false);

  // 空清单不渲染，避免无意义占位
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = todos.length > 0 && done === todos.length;
  // 当前任务 = 唯一的 in_progress；全完成时头部直接显示"全部完成"
  const current = todos.find((t) => t.status === "in_progress");
  // 头部摘要：当前任务 → 全完成文案 → 最后一条，按这个优先级回退
  const summary = current?.content ?? (allDone ? "全部完成" : todos[todos.length - 1]?.content ?? "");

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
