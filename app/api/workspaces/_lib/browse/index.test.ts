// ============================================================
// 目录浏览（C6）—— 栅栏 / 面包屑 / 排序 / 截断
// ============================================================
// 测的是"人怎么被挡住、怎么被引导"，不是"文件系统怎么工作"：
//   - 进不去的路径必须**明确拒绝**（相对路径、`\foo`、`/foo`）—— 这条挡的是
//     "悄悄解析到当前盘"，用户会以为自己打开的是 E:\foo
//   - 面包屑每一节都能跳（根 → 当前）
//   - 排序确定（两次请求顺序一样），截断要**说出来**
//   - 新建目录只收**一层名字**（`a\b` 是输错了，不是"帮我建两层"）
// ============================================================

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildCrumbs,
  listDirectory,
  parentOf,
  requireDirectory,
} from "./index";

const cleanups: Array<() => void> = [];

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "browse-test-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "alpha"));
  mkdirSync(join(root, "Beta"));
  mkdirSync(join(root, "zeta"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "readme.md"), "not a directory\n");
  return root;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("requireDirectory —— 三道门", () => {
  it("完全限定的真实目录：放行，返回规范化路径", () => {
    const root = makeTree();
    expect(requireDirectory(root)).toBe(resolve(root));
  });

  it("相对路径 / 无盘符的根 → invalid-path（这条挡的是「悄悄解析到当前盘」）", () => {
    for (const bad of ["folder", ".\\folder", "\\folder", "/folder", "..\\x"]) {
      expect(() => requireDirectory(bad)).toThrowError(/完全限定/);
    }
  });

  it("不存在 / 不是目录 → not-a-directory（两种失败文案不同）", () => {
    const root = makeTree();
    expect(() => requireDirectory(join(root, "no-such-dir"))).toThrowError(
      /不存在|读不到/,
    );
    // 真实文件：这里必须报"不是文件夹"，而不是"不存在"
    expect(() => requireDirectory(join(root, "readme.md"))).toThrowError(
      /不是文件夹/,
    );
  });
});

describe("listDirectory —— 只列目录、排序确定、隐藏项标记", () => {
  it("只列目录：文件不出现；大小写不敏感排序", () => {
    const root = makeTree();
    const listing = listDirectory({ path: root });

    expect(listing.entries.map((entry) => entry.name)).toEqual([
      ".hidden",
      "alpha",
      "Beta",
      "zeta",
    ]);
    // 文件不是目录 → 不列
    expect(listing.entries.some((entry) => entry.name === "readme.md")).toBe(
      false,
    );
  });

  it("两次请求顺序一致（界面不会跳）", () => {
    const root = makeTree();
    const first = listDirectory({ path: root }).entries.map((e) => e.name);
    const second = listDirectory({ path: root }).entries.map((e) => e.name);
    expect(second).toEqual(first);
  });

  it("隐藏项被标记但不被隐藏（人要能选到 .github 这种目录）", () => {
    const root = makeTree();
    const hidden = listDirectory({ path: root }).entries.find(
      (entry) => entry.name === ".hidden",
    );
    expect(hidden?.hidden).toBe(true);
  });

  it("超过上限 → truncated=true 且如实截断（不悄悄少给）", () => {
    const root = makeTree();
    const listing = listDirectory({ path: root, maxEntries: 2 });
    expect(listing.entries).toHaveLength(2);
    expect(listing.truncated).toBe(true);
  });

  it("每个条目带可用的绝对路径（界面直接拿它请求下一层）", () => {
    const root = makeTree();
    const alpha = listDirectory({ path: root }).entries.find(
      (entry) => entry.name === "alpha",
    );
    expect(alpha?.path).toBe(join(resolve(root), "alpha"));
  });
});

describe("面包屑与上一层", () => {
  it("根 → 当前，每一节都可跳", () => {
    const root = makeTree();
    const nested = join(root, "alpha");
    const crumbs = buildCrumbs(nested);

    expect(crumbs[crumbs.length - 1].path).toBe(resolve(nested));
    expect(crumbs[0].name).toMatch(/^[A-Za-z]:\\$|^\/$/); // 盘符根或 POSIX 根
    for (const crumb of crumbs) expect(crumb.path).toBe(resolve(crumb.path));
  });

  it("盘符根没有上一层（退无可退要能表达）", () => {
    const root = resolve("C:/");
    expect(parentOf(root)).toBe(null);
  });

  it("普通目录的上一层是父目录", () => {
    const root = makeTree();
    expect(parentOf(join(root, "alpha"))).toBe(resolve(root));
  });
});
