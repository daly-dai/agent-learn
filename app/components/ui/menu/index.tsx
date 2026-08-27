"use client";

// ============================================================
// Menu —— 下拉菜单原语（B3 第一个原语，2026-08-26）
// ============================================================
// 用途：把「挤不下的操作」收进一个可复用的下拉菜单。
//   会话行 ⋯（重命名/删除）、面板头部操作，
//   全部走这一个组件——全站只有一个溢出模式，视觉与行为统一。
//   （2026-08-26：顶栏 ⋯ 曾用它收「清空记录」，清空功能删除后顶栏不再用 Menu）
//
// 参考：DSH `dsh-client-ui-primitives`（自研原语库，不引第三方）、
//       Reasonix 面板族（头部 = 标题 + 操作区，操作可收纳）。
//
// 行为约定：
//   - 点击触发器开/关；点菜单外部 / Esc 关闭
//   - 打开后自动聚焦第一个可用项；↑↓ 循环移动，Home/End 到头尾
//   - 选中即关闭，焦点还给触发器（键盘用户不丢位置）
//   - 危险项（danger）用错误红，禁用项不可聚焦不可点
//   - aria：触发器 aria-haspopup="menu" + aria-expanded，
//     菜单 role="menu"、项 role="menuitem"
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isPlainKey } from "../../../lib/keys";
import styles from "./menu.module.css";

export type MenuItem = {
  label: string;
  /** 右侧小字说明（如「不可恢复」），可有可无 */
  hint?: string;
  /** 危险操作：红色，如删除/清空 */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

type MenuProps = {
  /** 触发器 aria-label（图标按钮必须有名字，屏幕阅读器靠它） */
  label: string;
  items: MenuItem[];
  /**
   * 弹框对齐方式：
   *   start —— 贴触发器左缘往下展开（默认）
   *   end   —— 贴触发器右缘往下展开（面板右上角用）
   *   side  —— 贴触发器右侧水平展开（窄侧栏里不盖住列表信息）
   */
  align?: "start" | "end" | "side";
  /** 触发器内容：默认「⋯」；传文字可做文字触发器 */
  children?: ReactNode;
  /** 包在触发器外的定位类（如绝对定位到面板右上角） */
  className?: string;
};

export function Menu({
  label,
  items,
  align = "start",
  children = "⋯",
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // side 对齐的固定定位坐标（视口坐标）。只在点击打开时量一次。
  const [sideRect, setSideRect] = useState<{ left: number; top: number } | null>(
    null,
  );

  // 点菜单外部关闭（mousedown 比 click 早，先关再让点击落空，不会误触发别的）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // side 模式下滚动/缩放时关闭：fixed 面板不跟随滚动，浮错位置比关掉更糟
  useEffect(() => {
    if (!open || align !== "side") return;
    const close = () => setOpen(false);
    // capture: true —— 捕获阶段监听，滚动容器（.sessionList）的滚动也能拦到
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, align]);

  // 打开时聚焦第一个可用项：键盘用户直接能选，不用先 Tab 进来
  useEffect(() => {
    if (!open) return;
    const first = itemRefs.current.find((el) => el && !el.disabled);
    first?.focus();
  }, [open]);

  // side 对齐：在 setOpen 之前量触发器位置（同步量，避免首帧错位闪烁）
  function toggleOpen() {
    if (!open && align === "side") {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setSideRect({ left: rect.right + 8, top: rect.top });
    }
    setOpen((v) => !v);
  }

  function pick(item: MenuItem) {
    setOpen(false);
    triggerRef.current?.focus(); // 焦点还给触发器，形成闭环
    item.onSelect();
  }

  // 在可用项里循环移动焦点（disabled 项跳过）
  function moveFocus(delta: 1 | -1) {
    const enabled = itemRefs.current.filter(
      (el): el is HTMLButtonElement => !!el && !el.disabled,
    );
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = enabled[(current + delta + enabled.length) % enabled.length];
    next.focus();
  }

  function jumpFocus(edge: "first" | "last") {
    const enabled = itemRefs.current.filter(
      (el): el is HTMLButtonElement => !!el && !el.disabled,
    );
    if (enabled.length > 0) enabled[edge === "first" ? 0 : enabled.length - 1].focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    // 修饰键组合让路（app/lib/keys.ts）：Ctrl/Cmd/Alt+方向键是系统/浏览器
    // 快捷键，不该触发菜单导航——approval-dialog 同款前置判定
    if (!isPlainKey(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      jumpFocus("first");
    } else if (e.key === "End") {
      e.preventDefault();
      jumpFocus("last");
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap}${className ? ` ${className}` : ""}`}
      // 菜单是独立交互岛：阻止冒泡，避免外层可点容器（如会话行）被误触发
      onClick={(e) => e.stopPropagation()}
      // Tab/失焦移到菜单外时关闭（配合外部 mousedown，双保险）
      onBlurCapture={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {children}
      </button>

      {/* side 对齐必须等 sideRect 量好才渲染（fixed 定位需要真实坐标，
          没有坐标就渲染会闪一帧错位） */}
      {open && (align !== "side" || sideRect) && (
        <div
          className={styles.panel}
          data-align={align}
          style={
            align === "side" && sideRect
              ? { position: "fixed", left: sideRect.left, top: sideRect.top }
              : undefined
          }
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className={`${styles.item}${item.danger ? ` ${styles.danger}` : ""}`}
              disabled={item.disabled}
              onClick={() => pick(item)}
            >
              <span className={styles.itemLabel}>{item.label}</span>
              {item.hint && <span className={styles.itemHint}>{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
