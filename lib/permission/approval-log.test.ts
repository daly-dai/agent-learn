// ============================================================
// approval-log.test.ts —— 审批日志单测（纯函数 + fs）
// ============================================================

import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendApprovalReceipt,
  loadApprovalReceipts,
  replayApprovalReceipts,
  type ApprovalReceipt,
} from "./approval-log";

function asked(id: string, toolName = "bash"): ApprovalReceipt {
  return {
    phase: "asked",
    approvalId: id,
    toolCallId: id,
    toolName,
    createdAt: "2026-08-26T00:00:00.000Z",
  };
}

function decided(id: string, outcome: "approved" | "denied" = "approved"): ApprovalReceipt {
  return {
    phase: "decided",
    approvalId: id,
    toolCallId: id,
    toolName: "bash",
    outcome,
    createdAt: "2026-08-26T00:00:01.000Z",
  };
}

const tmpDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "approval-log-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  // 交给系统临时目录清理，不手动删（测试只读校验逻辑）
});

describe("replayApprovalReceipts —— 成对校验（纯函数）", () => {
  it("asked + decided 配对 → completed", () => {
    const { completed, unmatchedAsks, errors } = replayApprovalReceipts([
      asked("tool-1"),
      decided("tool-1"),
    ]);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.ask.phase).toBe("asked");
    expect(completed[0]!.decided.outcome).toBe("approved");
    expect(unmatchedAsks).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("只有 asked（中断/进行中）→ unmatchedAsks，不算错", () => {
    const { completed, unmatchedAsks, errors } = replayApprovalReceipts([
      asked("tool-1"),
    ]);
    expect(completed).toHaveLength(0);
    expect(unmatchedAsks).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("孤儿 decided（没有 ask）→ 报错", () => {
    const { errors } = replayApprovalReceipts([
      decided("tool-orphan"),
    ]);
    expect(errors.some((e) => e.includes("没有匹配的 ask"))).toBe(true);
  });

  it("重复 ask → 报错", () => {
    const { errors } = replayApprovalReceipts([
      asked("tool-1"),
      decided("tool-1"),
      asked("tool-1"),
    ]);
    expect(errors.some((e) => e.includes("被问了多次"))).toBe(true);
  });

  it("approvalId 与 toolCallId 不匹配 → 报错", () => {
    const bad = asked("tool-1");
    bad.toolCallId = "other-id";
    const { errors } = replayApprovalReceipts([bad]);
    expect(errors.some((e) => e.includes("不匹配"))).toBe(true);
  });

  it("ask 缺 toolName → 报错", () => {
    const { errors } = replayApprovalReceipts([asked("tool-1", "  ")]);
    expect(errors.some((e) => e.includes("缺 toolName"))).toBe(true);
  });

  it("decided 缺 outcome → 报错（outcome 是审计核心信息）", () => {
    const noOutcome = decided("tool-1");
    delete noOutcome.outcome;
    const { errors } = replayApprovalReceipts([asked("tool-1"), noOutcome]);
    expect(errors.some((e) => e.includes("缺 outcome"))).toBe(true);
  });

  it("空 approvalId → 报不匹配", () => {
    const bad = asked("tool-1");
    bad.approvalId = "";
    const { errors } = replayApprovalReceipts([bad]);
    expect(errors.some((e) => e.includes("不匹配"))).toBe(true);
  });
});

describe("append / load —— 文件持久化", () => {
  it("追加 asked + decided → 读回两条，replay 完整", async () => {
    const dir = freshDir();
    await appendApprovalReceipt(dir, "s1", asked("tool-1"));
    await appendApprovalReceipt(dir, "s1", decided("tool-1"));

    const receipts = await loadApprovalReceipts(dir, "s1");
    expect(receipts).toHaveLength(2);
    const { completed, errors } = replayApprovalReceipts(receipts);
    expect(completed).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("文件不存在 → 返回空数组", async () => {
    const dir = freshDir();
    expect(await loadApprovalReceipts(dir, "no-such")).toEqual([]);
  });

  it("追加损坏记录被拒绝（孤儿 decided）", async () => {
    const dir = freshDir();
    await expect(
      appendApprovalReceipt(dir, "s1", decided("tool-orphan")),
    ).rejects.toThrow(/没有匹配的 ask/);
    // 没写进去
    expect(await loadApprovalReceipts(dir, "s1")).toEqual([]);
  });

  it("追加重复 ask 被拒绝（日志防重复）", async () => {
    const dir = freshDir();
    await appendApprovalReceipt(dir, "s1", asked("tool-1"));
    await expect(
      appendApprovalReceipt(dir, "s1", asked("tool-1")),
    ).rejects.toThrow(/被问了多次/);
    expect(await loadApprovalReceipts(dir, "s1")).toHaveLength(1);
  });

  it("日志文件含损坏 JSON 行 → load 抛错（fail-closed，不静默）", async () => {
    const dir = freshDir();
    await writeFile(join(dir, "s1.approval.jsonl"), "{bad json}\n", "utf8");
    await expect(loadApprovalReceipts(dir, "s1")).rejects.toThrow();
  });

  it("不同会话日志互不影响", async () => {
    const dir = freshDir();
    await appendApprovalReceipt(dir, "s1", asked("tool-1"));
    await appendApprovalReceipt(dir, "s2", asked("tool-2"));
    expect(await loadApprovalReceipts(dir, "s1")).toHaveLength(1);
    expect(await loadApprovalReceipts(dir, "s2")).toHaveLength(1);
  });
});
