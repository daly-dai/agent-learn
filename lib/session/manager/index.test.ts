// ============================================================
// sessionManager.test.ts —— SessionManager 目录级操作（回归测试）
// ============================================================
// 背景（2026-08-26 修，幽灵会话 bug）：
//   list() 以前把会话目录里所有 *.jsonl 都当会话列——B1 审批日志
//   （<id>.approval.jsonl，带点）和手动副本（文件名带空格）混进来，
//   变成 0 条消息的会话出现在侧边栏；但 delete() 的 isValidSessionId
//   拒绝这类 id（只允许 [a-zA-Z0-9_-]）→「列得出、删不掉」。
//   修法：list() 用同一把尺（isValidSessionId）过滤，进出对称。
//   本文件钉死：合法会话 create→list→delete 闭环可用；非会话文件不冒充。
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from ".";
import { JsonlSessionStore } from "../store";
import { createUserMessage } from "../../message";

// 只包一层 rename，其余 fs/promises 函数原样展开——用来观察"替换前一刻"的
// 磁盘状态。**原子性本身（进程被杀）在单测里造不出来，造了也是假的**，
// 所以我们不造崩溃，造它**可观测的那一半**："替换这一步发生前，原文件始终完整"。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

beforeEach(() => {
  vi.mocked(rename).mockClear();
});

function makeManager(): {
  manager: SessionManager;
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "session-manager-test-"));
  const manager = new SessionManager(dir, dir);
  return { manager, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("SessionManager 会话目录操作", () => {
  it("create → list → delete 闭环：合法会话能删掉", async () => {
    const { manager, cleanup } = makeManager();
    try {
      const id = await manager.create("测试会话");
      expect((await manager.list()).map((s) => s.id)).toEqual([id]);

      await manager.delete(id);

      expect((await manager.list()).length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("list() 只列合法会话：审批日志/副本不再冒充 0 条会话（幽灵会话回归）", async () => {
    const { manager, dir, cleanup } = makeManager();
    try {
      const id = await manager.create("真会话");
      // B1 审批日志：<id>.approval.jsonl（带点，id 不合法）
      writeFileSync(join(dir, `${id}.approval.jsonl`), '{"phase":"asked"}\n');
      // 手动副本：文件名带空格（id 不合法）
      writeFileSync(join(dir, `${id} copy.jsonl`), '{"type":"session"}\n');

      const listed = await manager.list();

      expect(listed.map((s) => s.id)).toEqual([id]); // 只有真会话
    } finally {
      cleanup();
    }
  });

  it("delete 不存在的会话抛错（删除失败可见，不静默）", async () => {
    const { manager, cleanup } = makeManager();
    try {
      await expect(manager.delete("s_no_such_session")).rejects.toThrow(
        "会话不存在",
      );
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
    const { manager, dir, cleanup } = makeManager();
    try {
      const id = await manager.create("旧标题");
      // 走真管道塞一条真消息（不手拼 JSON）——"只改首行、不动其余行"才有东西可验
      await new JsonlSessionStore(manager.sessionPath(id), dir, id).appendMessage(
        createUserMessage("一条真消息"),
      );

      await manager.rename(id, "新标题");

      const lines = readFileSync(join(dir, `${id}.jsonl`), "utf8")
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
    const { manager, dir, cleanup } = makeManager();
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    try {
      const id = await manager.create("旧标题");
      const filePath = join(dir, `${id}.jsonl`);
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

// ============================================================
// delete 连带清理侧车（C18 A 档 ③）
// ============================================================
// 夹具的真实场景（AGENTS 11.5 ②）：审批日志是 <id>.approval.jsonl 侧车，
// 而 delete 原来只 rm 主文件——实测存量里**已经有 3 个孤儿**
// （s_2026-08-26T11-01-34-056Z_77przz / s_2026-09-01T02-59-02-629Z_homnjj /
// smoke_s4b：会话早删了、日志还躺在 .sessions/ 里）。
describe("delete 连带清理侧车 —— 不留孤儿", () => {
  it("⭐ 删会话时审批侧车一起删", async () => {
    const { manager, dir, cleanup } = makeManager();
    try {
      const id = await manager.create("有审批的会话");
      const sidecar = join(dir, `${id}.approval.jsonl`);
      writeFileSync(sidecar, '{"phase":"asked"}\n', "utf8");

      await manager.delete(id);

      expect(existsSync(join(dir, `${id}.jsonl`))).toBe(false);
      expect(existsSync(sidecar)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("侧车不存在也不报错（多数会话从没触发过审批——这是常态不是异常）", async () => {
    const { manager, cleanup } = makeManager();
    try {
      const id = await manager.create("没审批的会话");

      await expect(manager.delete(id)).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
