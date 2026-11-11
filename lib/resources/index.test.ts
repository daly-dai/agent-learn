// ============================================================
// lib/resources —— 四层资源根的解析（C50）
// ============================================================
// 测 seam：resolveResourceRoots（顺序 / 去重 / 绝对路径）、
// resolveSkillRoots（追加 skills，且**旧默认技能根仍在列**）。
//
// 夹具都是"真实会出现的形状"：Windows 路径、cwd 恰好等于数据根（在 `~/.statve`
// 里起 dev server）、带 `..` 的等价路径。最后一条尤其重要：`~/.agents/skills`
// 是搬家前唯一的技能根，它一旦掉出列表，用户装好的技能会**静默全消失**。
// ============================================================

import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { resolveResourceRoots, resolveSkillRoots } from "./index";

const CWD = resolve("E:/work-space/proj-a");
const USER_HOME = resolve("C:/Users/25082");
const DATA_ROOT = join(USER_HOME, ".statve");

const anchors = { cwd: CWD, dataRoot: DATA_ROOT, userHome: USER_HOME };

describe("resolveResourceRoots —— 四层顺序", () => {
  it("项目级 .statve > 项目级 .agents > 数据根 > 用户级 .agents", () => {
    expect(resolveResourceRoots(anchors)).toEqual([
      join(CWD, ".statve"),
      join(CWD, ".agents"),
      DATA_ROOT,
      join(USER_HOME, ".agents"),
    ]);
  });

  it("cwd 就是家目录时去重：项目级与用户级两两重合，只剩两层", () => {
    // 在家目录里起 dev server 的真实场景：`<cwd>/.statve` 就是数据根本身，
    // `<cwd>/.agents` 就是用户级共享根 —— 同一个目录扫两遍没有意义
    expect(resolveResourceRoots({ ...anchors, cwd: USER_HOME })).toEqual([
      DATA_ROOT,
      join(USER_HOME, ".agents"),
    ]);
  });

  it("带 .. 的等价路径只算一个根", () => {
    const sneaky = resolve("E:/work-space/proj-b/../proj-a");
    expect(resolveResourceRoots({ ...anchors, cwd: sneaky })).toEqual(
      resolveResourceRoots(anchors),
    );
  });

  it("输出都是绝对路径（调用方可以放心当根用）", () => {
    const roots = resolveResourceRoots({ ...anchors, cwd: "relative/at-all" });
    expect(roots.every((root) => root === resolve(root))).toBe(true);
  });
});

describe("resolveSkillRoots —— 资源根下的 skills/", () => {
  it("每个资源根下取 skills 子目录，顺序不变", () => {
    expect(resolveSkillRoots(anchors)).toEqual([
      join(CWD, ".statve", "skills"),
      join(CWD, ".agents", "skills"),
      join(DATA_ROOT, "skills"),
      join(USER_HOME, ".agents", "skills"),
    ]);
  });

  it("⭐ 旧默认技能根 ~/.agents/skills 仍在列（否则搬家的代价是技能静默全消失）", () => {
    expect(resolveSkillRoots(anchors)).toContain(
      join(USER_HOME, ".agents", "skills"),
    );
  });

  it("STATVE_HOME 改到别处时，用户级 .agents 不跟着跑（两个锚点是独立的）", () => {
    const moved = { ...anchors, dataRoot: resolve("D:/statve-data") };
    const roots = resolveSkillRoots(moved);
    expect(roots).toContain(join(USER_HOME, ".agents", "skills"));
    expect(roots).toContain(join(resolve("D:/statve-data"), "skills"));
  });
});
