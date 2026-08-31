// ============================================================
// lib/repos/baseline.test.ts —— 仓库更新基线（C15）
// ============================================================
// 覆盖：读不存在 → null（首刷）、写→读往返、损坏 JSON → null。
// 纯 fs，用 mkdtemp 临时目录（同 session/manager.test.ts 约定）。
// config.paths.repoBaselines 默认指向 .repo-updates/，测试要绕开它，
// 所以用 vi.mock 把 config 换成临时目录——见文件尾的 mock。
// ============================================================

import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- 先 mock config，再 import 被测模块（vitest 的 hoist 要求）----
const tempDir = mkdtempSync(join(tmpdir(), "repo-baseline-test-"));

vi.mock("@/lib/config", () => ({
  config: {
    paths: {
      repoBaselines: tempDir,
    },
  },
}));

import { baselinePath, readBaseline, writeBaseline } from "./baseline";

describe("baseline —— 仓库更新基线", () => {
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("读不存在的基线返回 null（首刷信号）", async () => {
    expect(await readBaseline("no-such-repo")).toBeNull();
  });

  it("写→读 往返：commit 和更新时间都在", async () => {
    await writeBaseline("pi", "abc123def456");
    const baseline = await readBaseline("pi");

    expect(baseline).not.toBeNull();
    expect(baseline!.lastKnownCommit).toBe("abc123def456");
    expect(typeof baseline!.updatedAt).toBe("string");
    // updatedAt 是合法 ISO 时间
    expect(new Date(baseline!.updatedAt).getTime()).not.toBeNaN();
  });

  it("损坏的 JSON 返回 null（fail-soft，当首刷）", () => {
    writeFileSync(baselinePath("pi"), "{ not valid json", "utf8");
    // 同步写后异步读，直接断言
    return expect(readBaseline("pi")).resolves.toBeNull();
  });

  it("缺 lastKnownCommit 字段的 JSON 返回 null", () => {
    writeFileSync(baselinePath("pi"), JSON.stringify({ updatedAt: "2026-01-01" }), "utf8");
    return expect(readBaseline("pi")).resolves.toBeNull();
  });

  it("不同仓库独立存储（互不覆盖）", async () => {
    await writeBaseline("pi", "commit-pi");
    await writeBaseline("codex", "commit-codex");

    expect((await readBaseline("pi"))!.lastKnownCommit).toBe("commit-pi");
    expect((await readBaseline("codex"))!.lastKnownCommit).toBe("commit-codex");
  });
});
