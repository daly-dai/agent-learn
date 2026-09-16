// ============================================================
// command-panel/index.test.ts —— 面板的数据变换（C8 T6）
// ============================================================
// 测两个纯 seam：filterCommands（模糊匹配）与 groupCommands（分组）。
// 夹具说明（AGENTS 11.5：手造夹具必须说得出"这个状态为什么真会发生"）：
//   - `builtin` 那两条是**真实形状**（`/clear` + 一个带别名的命令）。⚠️ 今天
//     三个内置命令都没写别名，但"别名只认不显"是既有约定（codex ALIAS_COMMANDS，
//     见 `lib/commands/index.ts` 头注释）—— 这条用例守的是**那条约定本身**：
//     过滤不认别名，`/exit` 那类输入就永远匹配不到东西。
//   - `skill` 那两条是 `source:"skill"` 的真实形状（T5 送出来的就是这样）。
// ============================================================

import { describe, expect, it } from "vitest";
import type { CommandDescriptor } from "@/lib/commands";
import { filterCommands, groupCommands, matchesSubsequence } from ".";

function command(
  name: string,
  source: "builtin" | "skill",
  aliases: string[] = [],
): CommandDescriptor {
  return { name, description: `${name} 的说明`, source, aliases };
}

const CLEAR = command("clear", "builtin", ["reset"]);
const COMPACT = command("compact", "builtin");
const CODE_REVIEW = command("code-review", "skill");
const FRONTEND = command("frontend-design", "skill");

const ALL = [CLEAR, COMPACT, CODE_REVIEW, FRONTEND];

describe("matchesSubsequence —— 子序列匹配", () => {
  it("打 cr 命中 code-review（字符按顺序出现即可，不要求连续）", () => {
    expect(matchesSubsequence("code-review", "cr")).toBe(true);
  });

  it("打 review 也命中（子序列能跨过中间那些字符）", () => {
    expect(matchesSubsequence("code-review", "review")).toBe(true);
  });

  it("顺序不对就不命中 —— cw 命中 code-review，但 wc 不命中", () => {
    expect(matchesSubsequence("code-review", "cw")).toBe(true);
    expect(matchesSubsequence("code-review", "wc")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(matchesSubsequence("code-review", "CR")).toBe(true);
  });

  it("空查询恒真（面板刚打开、还没打字）", () => {
    expect(matchesSubsequence("anything", "")).toBe(true);
  });

  it("查询里有名字里没有的字符 → 不命中", () => {
    expect(matchesSubsequence("clear", "cz")).toBe(false);
  });
});

describe("filterCommands —— 名字或别名命中", () => {
  it("空查询 → 原样返回（不重排）", () => {
    expect(filterCommands(ALL, "")).toEqual(ALL);
    expect(filterCommands(ALL, "   ")).toEqual(ALL);
  });

  it("打 cr → 命中 clear 与 code-review（子序列不要求连续，c…r 两个词里都有）", () => {
    expect(filterCommands(ALL, "cr").map((c) => c.name)).toEqual([
      "clear",
      "code-review",
    ]);
  });

  it("⭐ 别名也认（只认不显）：打 reset 能匹配到 clear，但列表显示的主名是 clear", () => {
    const hit = filterCommands(ALL, "reset");
    expect(hit.map((c) => c.name)).toEqual(["clear"]);
  });
});

describe("groupCommands —— 命令在上、技能在下", () => {
  it("两组都在时：先 builtin 后 skill，组内保持传入顺序", () => {
    expect(groupCommands(ALL)).toEqual([
      { source: "builtin", items: [CLEAR, COMPACT] },
      { source: "skill", items: [CODE_REVIEW, FRONTEND] },
    ]);
  });

  it("⭐ 空组不返回（打 cr 只剩技能时，不该留一个空的「命令」标题）", () => {
    const onlySkills = filterCommands(ALL, "frontend");
    expect(groupCommands(onlySkills)).toEqual([
      { source: "skill", items: [FRONTEND] },
    ]);
  });

  it("一条都没有 → 空数组（面板据此显示空态）", () => {
    expect(groupCommands([])).toEqual([]);
  });
});
