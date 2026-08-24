// ============================================================
// path-utils.test.ts —— 路径沙箱（A2 第一个测试）
// ============================================================
// 为什么先测它：resolveInsideWorkspace 是所有文件工具的"围栏"，
// 越界拒绝是安全底线——这个坏了，write/read/edit 全都不安全。
// 纯函数，零 mock，最适合做 vitest 入门。
// ============================================================

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { resolveInsideWorkspace, stringArg } from "./path-utils";

// 用虚拟 workspace 根（不碰真实文件系统，纯路径逻辑）
const ROOT = resolve("C:/fake/workspace");

describe("stringArg —— 可选字符串参数的兜底", () => {
  it("字符串直接返回", () => {
    expect(stringArg("abc", "fallback")).toBe("abc");
  });

  it("空串/纯空白回退到 fallback", () => {
    expect(stringArg("", "fallback")).toBe("fallback");
    expect(stringArg("   ", "fallback")).toBe("fallback");
  });

  it("非字符串回退到 fallback", () => {
    expect(stringArg(undefined, "fallback")).toBe("fallback");
    expect(stringArg(null, "fallback")).toBe("fallback");
    expect(stringArg(123, "fallback")).toBe("fallback");
  });
});

describe("resolveInsideWorkspace —— 路径沙箱", () => {
  it("工作区内的相对路径正常解析", () => {
    expect(resolveInsideWorkspace(ROOT, "a.txt")).toBe(resolve(ROOT, "a.txt"));
  });

  it("嵌套相对路径正常解析", () => {
    expect(resolveInsideWorkspace(ROOT, "notes/x.md")).toBe(
      resolve(ROOT, "notes/x.md"),
    );
  });

  it("'.' 解析为工作区根本身", () => {
    expect(resolveInsideWorkspace(ROOT, ".")).toBe(ROOT);
  });

  it("工作区内的绝对路径放行（resolve 后仍在根内）", () => {
    const inside = resolve(ROOT, "sub/file.txt");
    expect(resolveInsideWorkspace(ROOT, inside)).toBe(inside);
  });

  it("'..' 越界抛错", () => {
    expect(() => resolveInsideWorkspace(ROOT, "../x")).toThrow(/路径越界/);
  });

  it("深层 '..' 越界抛错", () => {
    expect(() => resolveInsideWorkspace(ROOT, "a/../../x")).toThrow(/路径越界/);
  });

  it("根外的绝对路径抛错", () => {
    expect(() => resolveInsideWorkspace(ROOT, "C:/outside/x")).toThrow(
      /路径越界/,
    );
  });

  it("根本身带 '..' 输入抛错（防御：rel 为空但 input 含 ..）", () => {
    expect(() => resolveInsideWorkspace(ROOT, "sub/..")).toThrow(/路径越界/);
  });
});
