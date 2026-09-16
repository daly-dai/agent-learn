// ============================================================
// command-panel —— 命令面板的数据变换（C8 T6）
// ============================================================
// 面板要干两件纯数据的事，抽出来放这里（AGENTS 11.9：不含 React 状态/副作用的
// 东西就不该是 hook —— 放 app/lib/ 当纯函数，node 环境可单测，不用 jsdom）：
//   1. **过滤**：模糊匹配（不是 startsWith —— 打 `cr` 就该出 `code-review`）
//   2. **分组**：命令在上、技能在下，各带标题
//
// 为什么模糊匹配用**子序列**而不是子串：子串要求你记得连续片段，而面板存在的
// 意义正是"只记得大概也能找到"。pi 与 DSH 都用子序列。
// ============================================================

import type { CommandDescriptor, CommandSource } from "@/lib/commands";

/** 面板里的一组（组标题的文字归组件管 —— 文案是 UI 的事，不是数据的事） */
export type CommandGroup = {
  source: CommandSource;
  items: CommandDescriptor[];
};

/** 组顺序：命令在上、技能在下（也是面板"上半 / 下半"的来源） */
const GROUP_ORDER: readonly CommandSource[] = ["builtin", "skill"];

/**
 * 按来源分组。**空组不返回** —— 打 `/cr` 只出技能时，不该留一个空荡荡的
 * 「命令」标题在那儿（标题是用来标"下面这一类开始了"，底下没东西就没意义）。
 *
 * 组内保持传入顺序（不重排）：调用方传进来的就是过滤后的列表，而它的顺序
 * 已经是"内置在前、技能在后、各自按名"——前端键盘高亮的下标指的也是这个顺序，
 * 这里一重排就会错位。
 */
export function groupCommands(commands: CommandDescriptor[]): CommandGroup[] {
  return GROUP_ORDER.flatMap((source) => {
    const items = commands.filter((command) => command.source === source);
    return items.length > 0 ? [{ source, items }] : [];
  });
}

/**
 * 子序列匹配：`query` 的字符**按顺序**出现在 `text` 里即可（不要求连续）。
 * 大小写不敏感。空 `query` 恒真（面板刚打开、还没打字 → 全都算命中）。
 */
export function matchesSubsequence(text: string, query: string): boolean {
  if (query === "") return true;

  const wanted = [...query.toLowerCase()];
  let cursor = 0;

  for (const char of text.toLowerCase()) {
    if (char === wanted[cursor]) cursor += 1;
    if (cursor === wanted.length) return true;
  }

  return false;
}

/**
 * 过滤：**名字或别名**命中即可。
 *
 * 为什么要认别名：`aliases` 的约定是"只认不显"（codex ALIAS_COMMANDS，
 * 见 `lib/commands/index.ts` 头注释）—— 输入 `/exit` 能匹配到 `quit`，
 * 但列表里只显示主名。过滤不认别名的话，那条约定就是空的。
 */
export function filterCommands(
  commands: CommandDescriptor[],
  query: string,
): CommandDescriptor[] {
  const trimmed = query.trim();
  if (trimmed === "") return commands;

  return commands.filter(
    (command) =>
      matchesSubsequence(command.name, trimmed) ||
      (command.aliases ?? []).some((alias) =>
        matchesSubsequence(alias, trimmed),
      ),
  );
}
