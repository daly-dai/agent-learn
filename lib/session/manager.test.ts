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

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "./manager";

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
