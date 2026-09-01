"use client";

// ============================================================
// CommandMenu —— 斜杠命令补全面板（C13）
// ============================================================
// 形态：输入框上方的浮动过滤列表（跟随输入，不是触发器式下拉——
// 与 ui/menu 的区别：命令面板在输入过程中实时过滤，焦点始终在
// textarea，键盘导航只移动高亮项）。
// 交互约定继承 ui/menu：外部点击/Esc 关闭、↑↓ 移动、Enter 选中。
// 对齐参考系：
//   - slashCatalog 快照 ← Reasonix：命令列表是不可变快照（页面加载
//     时 fetch 一次），普通按键只过滤快照，不做全量重查
//   - 别名只认不显 ← codex ALIAS_COMMANDS：输入 /exit 能匹配到 quit，
//     但列表只显示主名
// 本组件是纯展示：过滤/键盘逻辑在 page.tsx（焦点在 textarea，键盘
// 事件从那里进），这里只渲染列表 + 汇报交互。
// ============================================================

import styles from "./command-menu.module.css";
import type { CommandDescriptor } from "@/lib/commands";

type CommandMenuProps = {
  /** slashCatalog 快照：全部命令（父级已过滤匹配，这里只渲染） */
  commands: CommandDescriptor[];
  /** 当前高亮项下标（键盘导航移动它；父级持有状态） */
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onPick: (command: CommandDescriptor) => void;
};

export function CommandMenu({
  commands,
  activeIndex,
  onActiveChange,
  onPick,
}: CommandMenuProps) {
  if (commands.length === 0) {
    return (
      <div className={styles.popup} role="listbox" aria-label="斜杠命令">
        <div className={styles.empty}>没有匹配的命令</div>
      </div>
    );
  }

  return (
    <div className={styles.popup} role="listbox" aria-label="斜杠命令">
      {commands.map((command, i) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.item}${i === activeIndex ? ` ${styles.active}` : ""}`}
          onMouseEnter={() => onActiveChange(i)}
          onMouseDown={(e) => e.preventDefault()} // 保持 textarea 焦点，点击只选中不抢焦
          onClick={() => onPick(command)}
        >
          <span className={styles.name}>/{command.name}</span>
          <span className={styles.desc}>{command.description}</span>
        </button>
      ))}
    </div>
  );
}
