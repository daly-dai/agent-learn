"use client";

// ============================================================
// ConfirmDialog —— 通用确认弹框（替换浏览器 confirm）
// ============================================================
// 形态沿用 approval-dialog 的模态骨架（mask + panel + 等宽标签 +
// 小圆角），语义是「确认一个危险/不可逆操作」。参考 Reasonix
// ConfirmDialog 的交互：默认聚焦「取消」（安全侧）、Esc 关闭、
// 点遮罩关闭。
//
// 设计：危险操作的主按钮用 error 红笔（--pen-error）——删除会话
// 不可逆，红色是"刹车"的直觉；次按钮纸底静默，与审批弹框一致。
// ============================================================

import { useEffect, useRef } from "react";
import styles from "./confirm-dialog.module.css";

type ConfirmDialogProps = {
  /** 弹框标题（等宽标签，如「删除会话」） */
  title: string;
  /** 正文说明（一句话讲清后果） */
  message: string;
  /** 主按钮文案（危险操作，如「删除」） */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 默认聚焦「取消」：误触回车也不会执行危险操作
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className={styles.mask} role="alertdialog" aria-modal="true">
      <div
        className={styles.panel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      >
        <div className={styles.title}>{title}</div>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            className={styles.cancelBtn}
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className={styles.confirmBtn}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
