// ============================================================
// approval-memory.test.ts —— 审批记忆单测（内存 + 磁盘）
// ============================================================

import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPersistApproved,
  isSessionApproved,
  loadPersistRules,
  rememberPersist,
  rememberSession,
  resetSessionApprovals,
} from "./approval-memory";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "approval-memory-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // B18：用显式 reset 接口清空全局会话记忆（原来直接改内部字段
  // `g.__sessionApprovals = new Map()`——测试黑进实现细节，字段改名就崩）
  resetSessionApprovals();
});

describe("会话级记忆（内存）", () => {
  it("未记住时返回 false", () => {
    expect(isSessionApproved("s1", "bash")).toBe(false);
  });

  it("记住后同会话返回 true", () => {
    rememberSession("s1", "bash");
    expect(isSessionApproved("s1", "bash")).toBe(true);
  });

  it("不同会话互不影响", () => {
    rememberSession("s1", "bash");
    expect(isSessionApproved("s2", "bash")).toBe(false);
  });

  it("不同工具互不影响", () => {
    rememberSession("s1", "bash");
    expect(isSessionApproved("s1", "write_file")).toBe(false);
  });
});

describe("持久化规则（磁盘）", () => {
  it("文件不存在 → 空集", async () => {
    expect(await loadPersistRules(tmpDir)).toEqual(new Set());
    expect(await isPersistApproved(tmpDir, "bash")).toBe(false);
  });

  it("记住后跨读取可见（写盘）", async () => {
    await rememberPersist(tmpDir, "bash");
    expect(await isPersistApproved(tmpDir, "bash")).toBe(true);
    expect(await isPersistApproved(tmpDir, "write_file")).toBe(false);
  });

  it("多次记住累积且去重", async () => {
    await rememberPersist(tmpDir, "bash");
    await rememberPersist(tmpDir, "bash");
    await rememberPersist(tmpDir, "write_file");
    const tools = await loadPersistRules(tmpDir);
    expect(tools.size).toBe(2);
    expect(tools.has("bash")).toBe(true);
    expect(tools.has("write_file")).toBe(true);
  });

  it("规则文件格式正确（JSON 可读、工具排序）", async () => {
    await rememberPersist(tmpDir, "write_file");
    await rememberPersist(tmpDir, "bash");
    const raw = await import("node:fs/promises").then((m) =>
      m.readFile(join(tmpDir, "approval-rules.json"), "utf8"),
    );
    expect(JSON.parse(raw)).toEqual({ tools: ["bash", "write_file"] });
  });

  it("规则文件损坏（非法 JSON）→ 抛错（fail-closed，不静默）", async () => {
    await writeFile(join(tmpDir, "approval-rules.json"), "{bad", "utf8");
    await expect(loadPersistRules(tmpDir)).rejects.toThrow();
  });

  it("rules 的 tools 不是数组 → 空集兜底（防脏数据）", async () => {
    await writeFile(
      join(tmpDir, "approval-rules.json"),
      JSON.stringify({ tools: "bash" }),
      "utf8",
    );
    expect(await loadPersistRules(tmpDir)).toEqual(new Set());
    expect(await isPersistApproved(tmpDir, "bash")).toBe(false);
  });
});
