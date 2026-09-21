// ============================================================
// path-utils.test.ts —— 路径沙箱（A2 第一个测试）
// ============================================================
// 为什么先测它：resolveInsideWorkspace 是所有文件工具的"围栏"，
// 越界拒绝是安全底线——这个坏了，write/read/edit 全都不安全。
// 纯函数，零 mock，最适合做 vitest 入门。
// ============================================================

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { resolveInsideWorkspace, stringArg } from ".";

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

  // ⚠️ **跨盘符**（C33，2026-09-21 补）：Windows 上 `relative()` 表达不出跨盘符相对路径时，
  // 会把 target **原样返回**（一个绝对路径），而绝对路径不以 `..` 开头 ⇒ 旧判定放行。
  // **老用例碰不到它**：上面那条 `C:/outside/x` 与本夹具 `ROOT` **同盘**（都是 C:），
  // 所以这条路径从来没被走过 —— 测试覆盖的形状和真实越界的形状不一样。
  //
  // 夹具为什么是真的（不是编的）：本机的工作区在 **E:**（`<仓库>/workspace`），
  // 而用户的技能根在 **C:**（`~/.agents/skills`）—— 2026-09-16 真机撞出的正是这两个盘：
  // 只读、**免审批**的 `read_file` 读到了 `C:\Users\…\.agents\skills\…`。
  it.skipIf(process.platform !== "win32")(
    "跨盘符的绝对路径抛错（C33：另一盘的文件也出不去）",
    () => {
      expect(() => resolveInsideWorkspace(ROOT, "E:/outside/x")).toThrow(
        /路径越界/,
      );
    },
  );

  it("根本身带 '..' 输入抛错（防御：rel 为空但 input 含 ..）", () => {
    expect(() => resolveInsideWorkspace(ROOT, "sub/..")).toThrow(/路径越界/);
  });
});
