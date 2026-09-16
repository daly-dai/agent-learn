"use client";

// ============================================================
// CommandMenu —— 斜杠补全面板（C13 建 / C8 T6 分组）
// ============================================================
// 形态：输入框上方的浮动过滤列表（跟随输入，不是触发器式下拉——
// 与 ui/menu 的区别：命令面板在输入过程中实时过滤，焦点始终在
// textarea，键盘导航只移动高亮项）。
// 交互约定继承 ui/menu：外部点击/Esc 关闭、↑↓ 移动、Enter 选中。
// 对齐参考系：
//   - slashCatalog 快照 ← Reasonix：命令列表是不可变快照（页面加载
//     时 fetch 一次），普通按键只过滤快照，不做全量重查
//   - 别名只认不显 ← codex ALIAS_COMMANDS：输入 /exit 能匹配到 quit，
//     但列表只显示主名（**过滤认别名**，见 app/lib/command-panel）
//
// C8 T6：面板分成两组 —— **命令在上、技能在下**，各带一个小标题，中间一条
// 全宽细线。分组规则（含"空组不显示标题"）在 `app/lib/command-panel`。
// ⚠️ 键盘高亮的下标是**扁平**的（↑↓ 跨组一路移动），所以这里必须按扁平顺序
// 还原 index —— 不能按"组内下标"定位，否则高亮会跳错项。
//
// 本组件是纯展示：过滤/键盘逻辑在 use-command-menu，这里只渲染列表 + 汇报交互。
// ============================================================

import { Fragment } from "react";
import styles from "./command-menu.module.css";
import { groupCommands } from "@/app/lib/command-panel";
import type { CommandDescriptor, CommandSource } from "@/lib/commands";

/** 组标题的文字。放组件里而不是数据层 —— 文案是 UI 的事，不是数据的事 */
const GROUP_LABEL: Record<CommandSource, string> = {
  builtin: "命令",
  skill: "技能",
};

type CommandMenuProps = {
  /** slashCatalog 快照里**已过滤**的那批（这个扁平顺序就是高亮下标的依据） */
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
  const groups = groupCommands(commands);

  if (groups.length === 0) {
    return (
      <div className={styles.popup} role="listbox" aria-label="斜杠命令与技能">
        <div className={styles.empty}>没有匹配的命令或技能</div>
      </div>
    );
  }

  // 名字 → 扁平下标。名字在快照里唯一（技能与内置撞名在服务端就被"内置优先"挡掉了，
  // 见 _pipeline/commands 的 commandCatalog）
  const flatIndex = new Map(commands.map((command, i) => [command.name, i]));

  return (
    <div className={styles.popup} role="listbox" aria-label="斜杠命令与技能">
      {groups.map((group, groupIndex) => (
        <Fragment key={group.source}>
          {/* 空组已被 groupCommands 滤掉，所以"第一条之前"不会有标题 */}
          {groupIndex > 0 && (
            <div className={styles.divider} role="separator" />
          )}
          <div className={styles.groupTitle}>{GROUP_LABEL[group.source]}</div>
          {group.items.map((command) => {
            const index = flatIndex.get(command.name) ?? -1;
            return (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.item}${index === activeIndex ? ` ${styles.active}` : ""}`}
                onMouseEnter={() => onActiveChange(index)}
                onMouseDown={(e) => e.preventDefault()} // 保持 textarea 焦点，点击只选中不抢焦
                onClick={() => onPick(command)}
              >
                <span className={styles.name}>/{command.name}</span>
                <span className={styles.desc}>{command.description}</span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
