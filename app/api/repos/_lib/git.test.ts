// ============================================================
// lib/repos/git.test.ts —— git 命令封装（C15）
// ============================================================
// 用【真实 git】在临时目录里 init 一个本地仓库做集成式单测：
//   不需要网络（本地 commit + 本地分支），验证命令封装本身对不对。
// 覆盖：HEAD commit / 新增 commit 列表（增量+首刷）/ ff 合并 /
//       落后判断 / ff-only 拒绝本地提交。
//
// 注意：测试环境必须有 git 可执行文件（本项目运行环境本来就依赖 git）。
// 分支一律作为参数传入（来自 registry.branch，不运行时探测——用户 08-31 拍板）。
// ============================================================

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fastForward,
  getHeadCommit,
  getNewCommits,
  isBehind,
  parseLsRemoteHash,
} from "./git";

/** 建一个带 1 个 commit 的临时 git 仓库，返回路径 + 清理函数 */
function makeRepo(branch = "main"): {
  dir: string;
  cleanup: () => void;
  firstCommit: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "repo-git-test-"));
  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  run(["init", "-b", branch, "."]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.txt"), "hello");
  run(["add", "a.txt"]);
  run(["commit", "-m", "first commit"]);
  const firstCommit = run(["rev-parse", "HEAD"]).trim();

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), firstCommit };
}

describe("git.ts —— 命令封装（分支作参数传入）", () => {
  it("getHeadCommit 返回完整 commit hash", async () => {
    const { dir, cleanup, firstCommit } = makeRepo();
    try {
      expect(await getHeadCommit(dir)).toBe(firstCommit);
    } finally {
      cleanup();
    }
  });

  it("getNewCommits：无基线时返回最近 N 条（首刷）", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const commits = await getNewCommits(dir, "main", undefined, 20);
      expect(commits.length).toBe(1);
      expect(commits[0]).toContain("first commit");
    } finally {
      cleanup();
    }
  });

  it("getNewCommits：有基线时只返回基线之后的（增量）", async () => {
    const { dir, cleanup, firstCommit } = makeRepo();
    try {
      const run = (args: string[]) =>
        execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      writeFileSync(join(dir, "b.txt"), "world");
      run(["add", "b.txt"]);
      run(["commit", "-m", "second commit"]);

      const newCommits = await getNewCommits(dir, "main", firstCommit);
      expect(newCommits.length).toBe(1);
      expect(newCommits[0]).toContain("second commit");
      // 基线的 first commit 不在增量里
      expect(newCommits[0]).not.toContain("first commit");
    } finally {
      cleanup();
    }
  });

  it("isBehind：无新增返回 false，有新增返回 true", async () => {
    const { dir, cleanup, firstCommit } = makeRepo();
    try {
      // 落后于 firstCommit → false（HEAD 就是 firstCommit）
      expect(await isBehind(dir, "main", firstCommit)).toBe(false);

      const run = (args: string[]) =>
        execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      writeFileSync(join(dir, "c.txt"), "!");
      run(["add", "c.txt"]);
      run(["commit", "-m", "third commit"]);

      expect(await isBehind(dir, "main", firstCommit)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("fastForward：有本地提交时 ff-only 失败（保护参考仓库）", async () => {
    const { dir, cleanup, firstCommit } = makeRepo();
    try {
      // 造一个"远端"：在另一个分支上提交（模拟 origin/main 前进）
      const run = (args: string[]) =>
        execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      // 当前分支 main 保持 firstCommit；本地再提交一个 → 本地领先
      writeFileSync(join(dir, "local.txt"), "local");
      run(["add", "local.txt"]);
      run(["commit", "-m", "local commit"]);
      // 本地 HEAD 已经前进，pull --ff-only 应失败
      await expect(
        fastForward(dir, "main"),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

describe("parseLsRemoteHash —— ls-remote 输出解析（纯函数，零网络）", () => {
  const HASH = "853a80d26c90a14c1886f0ebb8ffaae133ca2185";

  it("正常输出：取第一列 hash（tab 分隔）", () => {
    expect(parseLsRemoteHash(`${HASH}\trefs/heads/main`)).toBe(HASH);
  });

  it("空格分隔也能解析", () => {
    expect(parseLsRemoteHash(`${HASH} refs/heads/main`)).toBe(HASH);
  });

  it("空输出返回 null", () => {
    expect(parseLsRemoteHash("")).toBeNull();
  });

  it("非 40 位 hex（错误/提示信息）返回 null", () => {
    expect(parseLsRemoteHash("fatal: couldn't connect")).toBeNull();
    expect(parseLsRemoteHash("abc")).toBeNull();
  });
});
