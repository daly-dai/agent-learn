// ============================================================
// lib/repos/registry.test.ts —— 仓库清单（C15）
// ============================================================
// 钉死：5 个 git 仓库可更新（pi/codex/DSH/langchainjs/opencode），
// 4 个 zip 快照灰置（isGit=false）；findRepo 白名单查询行为。纯数据，零 mock。
// ============================================================

import { describe, expect, it } from "vitest";
import { REPOS, findRepo } from ".";

describe("REPOS —— 参考项目清单", () => {
  it("共 9 个项目，git 与非 git 分类正确", () => {
    expect(REPOS).toHaveLength(9);

    const gitNames = REPOS.filter((r) => r.isGit).map((r) => r.name);
    const nonGitNames = REPOS.filter((r) => !r.isGit).map((r) => r.name);

    expect(gitNames).toEqual([
      "pi",
      "codex",
      "deepseek-harness",
      "langchainjs",
      "opencode",
    ]);
    // 4 个 zip 快照灰置
    expect(nonGitNames).toEqual([
      "smolagents",
      "DeepSeek-Reasonix",
      "CodeWhale",
      "Survey",
    ]);
  });

  it("每个条目有名字、路径、备注", () => {
    for (const repo of REPOS) {
      expect(repo.name.length).toBeGreaterThan(0);
      expect(repo.path.length).toBeGreaterThan(0);
      expect(repo.note.length).toBeGreaterThan(0);
    }
  });

  it("git 仓库路径指向 agents-read 根下的克隆（非空且是绝对路径）", () => {
    for (const repo of REPOS.filter((r) => r.isGit)) {
      expect(repo.path).toMatch(/agents-read/);
      expect(repo.path).toMatch(/^[A-Za-z]:[\\/]/); // Windows 绝对路径
    }
  });

  it("git 仓库带主分支（分支是数据；DSH=master，opencode=dev 不是 main）", () => {
    const pi = REPOS.find((r) => r.name === "pi");
    const codex = REPOS.find((r) => r.name === "codex");
    const dsh = REPOS.find((r) => r.name === "deepseek-harness");
    const langchain = REPOS.find((r) => r.name === "langchainjs");
    const opencode = REPOS.find((r) => r.name === "opencode");

    expect(pi?.branch).toBe("main");
    expect(codex?.branch).toBe("main");
    expect(dsh?.branch).toBe("master");
    expect(langchain?.branch).toBe("main");
    // opencode 主分支是 dev（不是 main）——证明分支是数据不是硬编码
    expect(opencode?.branch).toBe("dev");
    // 非 git 仓库没有分支字段
    for (const repo of REPOS.filter((r) => !r.isGit)) {
      expect(repo.branch).toBeUndefined();
    }
  });
});

describe("findRepo —— 白名单查询", () => {
  it("存在的名字返回条目", () => {
    expect(findRepo("pi")?.isGit).toBe(true);
  });

  it("不存在的名字返回 undefined（route 白名单校验靠它）", () => {
    expect(findRepo("not-a-repo")).toBeUndefined();
  });
});
