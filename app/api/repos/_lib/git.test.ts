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

/** 建一个带 1 个 commit 的临时 git 仓库 + 裸远端，返回路径 + 清理函数。
 *  2026-09-01 修（C15 单测首次落地）：被测命令硬编码 origin/<branch>
 *  （getNewCommits 等），仓库必须配置 origin——用【裸仓库当远端】模拟：
 *  remote add origin <bare> + push -u，origin/main 就指向 firstCommit；
 *  后续"远端前进"用 git push origin main 更新裸远端的 refs。
 *  为什么裸仓库：origin 指向自己（普通仓库）会被 git 拒绝 push
 *  （"failed to push some refs"），裸仓库才是真实 remote 的形态。 */
function makeRepo(branch = "main"): {
  dir: string;
  remoteDir: string;
  cleanup: () => void;
  firstCommit: string;
  run: (args: string[]) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "repo-git-test-"));
  const remoteDir = mkdtempSync(join(tmpdir(), "repo-git-remote-"));
  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  // 远端：裸仓库（无工作区，只存 .git refs/objects）
  execFileSync("git", ["init", "--bare", remoteDir]);

  run(["init", "-b", branch, "."]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.txt"), "hello");
  run(["add", "a.txt"]);
  run(["commit", "-m", "first commit"]);
  const firstCommit = run(["rev-parse", "HEAD"]).trim();

  // origin = 裸远端：push -u 后 origin/<branch> 指向 firstCommit
  run(["remote", "add", "origin", remoteDir]);
  run(["push", "-u", "origin", branch]);

  return {
    dir,
    remoteDir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(remoteDir, { recursive: true, force: true });
    },
    firstCommit,
    run,
  };
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
    const { dir, cleanup, firstCommit, run } = makeRepo();
    try {
      writeFileSync(join(dir, "b.txt"), "world");
      run(["add", "b.txt"]);
      run(["commit", "-m", "second commit"]);
      // 模拟远端前进：origin/main 更新到 second（否则 firstCommit..origin/main 为空）
      run(["push", "origin", "main"]);

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
    const { dir, cleanup, firstCommit, run } = makeRepo();
    try {
      // 落后于 firstCommit → false（origin/main 就是 firstCommit）
      expect(await isBehind(dir, "main", firstCommit)).toBe(false);

      writeFileSync(join(dir, "c.txt"), "!");
      run(["add", "c.txt"]);
      run(["commit", "-m", "third commit"]);
      run(["push", "origin", "main"]); // 模拟远端前进

      expect(await isBehind(dir, "main", firstCommit)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("fastForward：本地与远端分叉时 ff-only 拒绝（保护参考仓库）", async () => {
    const { dir, remoteDir, cleanup, firstCommit, run } = makeRepo();
    try {
      // 本地 main 前进：firstCommit → local commit
      writeFileSync(join(dir, "local.txt"), "local");
      run(["add", "local.txt"]);
      run(["commit", "-m", "local commit"]);

      // 模拟远端也前进到另一条线（分叉）：clone 裸远端，在 clone 里提交并
      // push 回远端——main 与 origin/main 各自有对方没有的 commit
      // （2026-09-01 修：曾用 update-ref 改 refs/remotes/origin/main，但 pull
      // 里的 fetch 会用远端 refs 覆盖它；必须真实 push 让远端前进）
      const cloneDir = mkdtempSync(join(tmpdir(), "repo-git-clone-"));
      try {
        execFileSync("git", ["clone", remoteDir, cloneDir], { stdio: "ignore" });
        const runClone = (args: string[]) =>
          execFileSync("git", args, { cwd: cloneDir, encoding: "utf8" });
        runClone(["config", "user.email", "test@example.com"]);
        runClone(["config", "user.name", "Test"]);
        // 裸远端 HEAD 未指向具体分支，clone 可能没 checkout——显式基于 origin/main 建 main
        runClone(["checkout", "-B", "main", "origin/main"]);
        writeFileSync(join(cloneDir, "remote.txt"), "remote");
        runClone(["add", "remote.txt"]);
        runClone(["commit", "-m", "remote commit"]);
        runClone(["push", "origin", "HEAD:main"]);
      } finally {
        rmSync(cloneDir, { recursive: true, force: true });
      }

      // 本地 fetch → origin/main = remote commit；本地 main 与它分叉
      run(["fetch", "origin"]);

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
