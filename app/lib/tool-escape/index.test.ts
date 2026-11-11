// ============================================================
// 越界判定（4.6）—— 纯函数用例
// ============================================================
// 这一层错了的后果不是"报错"，而是**该弹的框不弹**（或反过来，每步都弹）。
// 所以用例盯三件事：
//   ① 7 个带路径的工具都判到（漏一个 = 那个工具可以静默越界）
//   ② 不参与的两个（write_note / bash）真的不参与
//   ③ 前缀陷阱：`E:\ws2` 不能被当成 `E:\ws` 里面

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyEscape,
  createEscapePermits,
  hasEscapeTraces,
  isInside,
} from "./index";

const root = resolve(process.cwd(), "workspace");
const outsideAbsolute =
  process.platform === "win32"
    ? "Z:\\outside\\secret.txt"
    : "/outside/secret.txt";

function call(name: string, args: Record<string, unknown>) {
  return { name, arguments: args };
}

describe("classifyEscape —— 参与判定的 7 个工具", () => {
  it.each(["read_file", "write_file", "edit_file", "delete_file"])(
    "%s 的相对路径在工作空间内 → inside",
    (name) => {
      expect(classifyEscape(call(name, { path: "notes/a.md" }), root)).toEqual({
        kind: "inside",
      });
    },
  );

  it.each(["read_file", "write_file", "edit_file", "delete_file"])(
    "%s 的 ../ 逃逸 → outside 并给出绝对路径",
    (name) => {
      const result = classifyEscape(
        call(name, { path: "../secret.txt" }),
        root,
      );
      expect(result.kind).toBe("outside");
      if (result.kind === "outside") {
        expect(result.targets).toHaveLength(1);
        expect(isInside(root, result.targets[0])).toBe(false);
      }
    },
  );

  it("别的盘符（或 POSIX 根外的绝对路径）→ outside", () => {
    expect(
      classifyEscape(call("read_file", { path: outsideAbsolute }), root).kind,
    ).toBe("outside");
  });

  it("grep / find / list_files 缺省 path=. → inside；给 ../ → outside", () => {
    for (const name of ["grep", "find", "list_files"]) {
      expect(classifyEscape(call(name, {}), root)).toEqual({ kind: "inside" });
      expect(classifyEscape(call(name, { path: ".." }), root).kind).toBe(
        "outside",
      );
    }
  });
});

describe("classifyEscape —— 不参与的两个", () => {
  it("write_note 的 fileName 不参与（它已被净化在 notes 目录内）", () => {
    expect(
      classifyEscape(call("write_note", { fileName: "../../secret.md" }), root),
    ).toEqual({
      kind: "inside",
    });
  });

  it("bash 的命令不参与（命令里的路径没法静态解析）", () => {
    expect(
      classifyEscape(call("bash", { command: "cat ../../etc/passwd" }), root),
    ).toEqual({
      kind: "inside",
    });
  });

  it("不认识的工具默认 inside（不误弹框）", () => {
    expect(
      classifyEscape(call("todo_write", { path: "../../x" }), root),
    ).toEqual({ kind: "inside" });
  });
});

describe("isInside —— 前缀陷阱", () => {
  it("工作空间内为真", () => {
    expect(isInside(root, resolve(root, "a", "b"))).toBe(true);
    expect(isInside(root, root)).toBe(true);
  });

  it("同前缀的邻居目录为假（E:\\ws2 不在 E:\\ws 里）", () => {
    expect(isInside(root, `${root}2`)).toBe(false);
    expect(isInside(root, resolve(root, ".."))).toBe(false);
  });
});

describe("hasEscapeTraces —— bash 粗筛（只提示，不拦截）", () => {
  it.each([
    "Get-Content C:\\Users\\me\\.env",
    "cat ../secret.txt",
    "cd ..",
    "cat ~/.ssh/id_rsa",
    "dir \\\\server\\share",
  ])("带越界痕迹：%s", (command) => {
    expect(hasEscapeTraces(command)).toBe(true);
  });

  it.each(["npm test", "git status", "echo hello", "ls -la src"])(
    "普通命令不算越界痕迹：%s",
    (command) => {
      expect(hasEscapeTraces(command)).toBe(false);
    },
  );
});

describe("createEscapePermits —— 一次性通行证", () => {
  it("批准一次只能用一次", () => {
    const permits = createEscapePermits();
    const target = resolve(root, "..", "secret.txt");

    permits.grant([target]);

    expect(permits.consume(target)).toBe(true);
    expect(permits.consume(target)).toBe(false); // 第二次必须重新问人
  });

  it("没批准过的目标一律不放行", () => {
    const permits = createEscapePermits();
    expect(permits.consume(resolve(root, "..", "x.txt"))).toBe(false);
  });

  it("批准时会规范化路径（a/../b 与 b 是同一条）", () => {
    const permits = createEscapePermits();
    const actual = resolve(root, "b.txt");

    permits.grant([resolve(root, "a", "..", "b.txt")]);

    expect(permits.consume(actual)).toBe(true);
  });
});
