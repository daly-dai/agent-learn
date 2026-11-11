// ============================================================
// sessionManager.test.ts —— SessionManager 目录级操作
// ============================================================
// 布局（2026-11-11 起）：`<根>/<工作空间键>/<会话目录>/session.jsonl`
// 本文件钉死四类事实：
//   ① create → list → delete 闭环可用，且**列表带 cwd**（分组靠它）
//   ② 目录里的非会话东西（散文件、`.tmp-*` 半成品）不冒充会话
//   ③ 按 id 找会话要能**跨工作空间**（侧栏是全量列表，没有"当前工作区"）
//   ④ 删除 = 删整个目录（轨迹跟着走）
// 另有两组"原子性"用例（create 与 rename）：原子性本身（进程被杀）在单测里
// 造不出来，造了也是假的，所以只钉它**可观测的那一半**。
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import type * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from ".";
import { encodeSegment, projectKey, tracePath } from "../paths";
import { JsonlSessionStore } from "../store";
import { createUserMessage } from "../../message";

// 只包一层 rename，其余 fs/promises 函数原样展开——用来观察"替换前一刻"的
// 磁盘状态。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

beforeEach(() => {
  vi.mocked(rename).mockClear();
});

/** 夹具：临时根 + 一个"工作空间路径"。工作空间目录不必真的存在——
 *  会话目录只由 cwd 字符串推出（真实数据里它当然存在，由 /api/workspaces 保证）。 */
function makeManager(): {
  manager: SessionManager;
  root: string;
  cwd: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "session-manager-test-"));
  return {
    manager: new SessionManager(root),
    root,
    cwd: join(root, "ws-a"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("SessionManager 会话目录操作", () => {
  it("create → list → delete 闭环：合法会话能删掉", async () => {
    const { manager, cwd, cleanup } = makeManager();
    try {
      const id = await manager.create({ cwd, title: "测试会话" });

      const listed = await manager.list();
      expect(listed.map((s) => s.id)).toEqual([id]);
      expect(listed[0].cwd).toBe(cwd); // 分组靠它
      expect(listed[0].title).toBe("测试会话");

      await manager.delete(id);
      expect(await manager.list()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("落盘位置：<根>/<工作空间键>/<会话目录>/session.jsonl", async () => {
    const { manager, root, cwd, cleanup } = makeManager();
    try {
      const id = await manager.create({ cwd });
      const location = await manager.locate(id);

      expect(location?.dir).toBe(
        join(root, projectKey(cwd), encodeSegment(id)),
      );
      expect(location?.logPath).toBe(join(location!.dir, "session.jsonl"));
      expect(existsSync(location!.logPath)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("list() 不把散文件与半成品目录当会话（幽灵会话回归）", async () => {
    const { manager, root, cwd, cleanup } = makeManager();
    try {
      const id = await manager.create({ cwd });
      const projectPath = join(root, projectKey(cwd));
      // 手动副本 / 审批残留：项目目录下的散文件
      writeFileSync(join(projectPath, "copy.jsonl"), '{"type":"session"}\n');
      // create() 中途的临时目录：不是会话，不能列
      mkdirSync(join(projectPath, ".tmp-s_deadbeef-abcd12"), {
        recursive: true,
      });

      expect((await manager.list()).map((s) => s.id)).toEqual([id]);
    } finally {
      cleanup();
    }
  });

  it("locate 跨工作空间找得到（侧栏是全量列表，没有当前工作区）", async () => {
    const { manager, root, cleanup } = makeManager();
    try {
      const cwdA = join(root, "ws-a");
      const cwdB = join(root, "ws-b");
      const idA = await manager.create({ cwd: cwdA });
      const idB = await manager.create({ cwd: cwdB });

      expect((await manager.locate(idA))?.cwd).toBe(cwdA);
      expect((await manager.locate(idB))?.cwd).toBe(cwdB);
      expect(await manager.locate("s_no_such_session")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("delete 删整个目录（轨迹跟着走），不存在的会话抛错", async () => {
    const { manager, cwd, cleanup } = makeManager();
    try {
      const id = await manager.create({ cwd });
      const location = await manager.locate(id);
      // 真轨迹长这样：同一目录下的 trace.<runId>.jsonl
      writeFileSync(tracePath(location!.dir, "run_x"), "{}\n");

      await manager.delete(id);

      expect(existsSync(location!.dir)).toBe(false);
      await expect(manager.delete("s_no_such_session")).rejects.toThrow(
        "会话不存在",
      );
    } finally {
      cleanup();
    }
  });
});

// ============================================================
// create 原子性：先写临时目录、再整体改名
// ============================================================
// 真实场景（F7）：半创建的会话目录 = 列表里一条"打不开的会话"（有目录、没头）。
// 所以头要写完之后，目录才允许以正式名字出现。
describe("create 原子写 —— 临时目录 → 正式目录", () => {
  it("改名那一刻：临时目录已含完整头，正式目录还不存在", async () => {
    const { manager, root, cwd, cleanup } = makeManager();
    const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
    try {
      let tmpHeaderAtSwap = "";
      let targetExistedAtSwap = true;
      vi.mocked(rename).mockImplementationOnce(async (from, to) => {
        tmpHeaderAtSwap = readFileSync(
          join(from as string, "session.jsonl"),
          "utf8",
        );
        targetExistedAtSwap = existsSync(to as string);
        return actual.rename(from, to);
      });

      const id = await manager.create({ cwd, title: "原子会话" });

      expect(JSON.parse(tmpHeaderAtSwap.trim()).title).toBe("原子会话");
      expect(targetExistedAtSwap).toBe(false);

      // 替换后不留残骸
      const projectPath = join(root, projectKey(cwd));
      expect(
        readdirSync(projectPath).filter((n) => n.startsWith(".tmp-")),
      ).toEqual([]);
      expect(
        existsSync(join(projectPath, encodeSegment(id), "session.jsonl")),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ============================================================
// rename 原子写（C18 A 档 ②）
// ============================================================
// 夹具的真实场景（AGENTS 11.5 ②）：**dev server 随改代码反复重启**——
// rename 是「全量读 → 改首行 → **全量写回**」，实测最大会话 124KB；
// 写回中途进程被杀，文件就被截断成半截 JSON，会话永久损坏。
describe("rename 原子写 —— 先写临时文件再替换", () => {
  it("正常路径：标题改了、其余行一条不少（回归）", async () => {
    const { manager, cwd, cleanup } = makeManager();
    try {
      const id = await manager.create({ cwd, title: "旧标题" });
      const location = await manager.locate(id);
      // 走真管道塞一条真消息（不手拼 JSON）——"只改首行、不动其余行"才有东西可验
      await new JsonlSessionStore({
        filePath: location!.logPath,
        cwd,
        sessionId: id,
      }).appendMessage(createUserMessage("一条真消息"));

      await manager.rename(id, "新标题");

      const lines = readFileSync(location!.logPath, "utf8")
        .split("\n")
        .filter(Boolean);
      expect(lines.length).toBe(2); // 头 + 1 条消息
      expect(JSON.parse(lines[0]).title).toBe("新标题"); // 首行改到了
      expect(JSON.parse(lines[1]).message.role).toBe("user"); // 第二行原样
    } finally {
      cleanup();
    }
  });

  it("⭐ 替换前一刻：原文件仍是完整旧内容、临时文件已是完整新内容", async () => {
    const { manager, cwd, cleanup } = makeManager();
    const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
    try {
      const id = await manager.create({ cwd, title: "旧标题" });
      const location = await manager.locate(id);
      const filePath = location!.logPath;
      const tmpPath = `${filePath}.tmp`;
      const original = readFileSync(filePath, "utf8");

      let targetAtSwap = "";
      let tmpAtSwap = "";
      vi.mocked(rename).mockImplementationOnce(async (from, to) => {
        // 这就是"进程被杀"会发生的那个窗口——原子替换要求此刻
        // 目标文件仍完整、新内容已完整就位
        targetAtSwap = readFileSync(to as string, "utf8");
        tmpAtSwap = readFileSync(from as string, "utf8");
        return actual.rename(from, to);
      });

      await manager.rename(id, "新标题");

      expect(targetAtSwap).toBe(original); // 目标文件此刻未被截断
      expect(JSON.parse(tmpAtSwap.split("\n")[0]).title).toBe("新标题"); // 新内容已完整
      // 同目录 → 同文件系统 → rename 原子（跨盘 rename 不原子，这条钉死目录选择）
      expect(rename).toHaveBeenCalledWith(tmpPath, filePath);
      expect(existsSync(tmpPath)).toBe(false); // 替换后不留残骸
      expect(readFileSync(filePath, "utf8")).toContain("新标题");
    } finally {
      cleanup();
    }
  });
});
