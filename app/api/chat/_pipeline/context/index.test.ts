// ============================================================
// _pipeline/context —— 请求准备物（尤其 ToolContext）
// ============================================================
// 这组用例守的是 **F2**（失败模式表第 2 条）：
//   工具环境（围栏根 + 技能根）以前是**模块级常量**，工作区根来自全局配置
//   ⇒ 第一个请求的工作区被所有会话共用。**不报错、只是静默串味**。
// 所以这里钉两件事：
//   ① 两个不同工作空间的会话，拿到的根**必须不同**（靠真读技能目录证明）
//   ② 模块里**不许**再出现模块级的 `toolContext` 常量（回归哨兵）
// ============================================================

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@/lib/skill";
import * as context from "./index";
import { createToolContext, toolContextForWorkspace } from "./index";

const cleanups: Array<() => void> = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 在一个工作空间里装一个项目级技能：<cwd>/.statve/skills/<name>/SKILL.md */
function installProjectSkill(cwd: string, name: string): void {
  const dir = join(cwd, ".statve", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} 的项目级技能\n---\n\n正文\n`,
    "utf8",
  );
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("createToolContext —— 签名即契约", () => {
  it("两个根原样放进去，不做任何推导（推导在 toolContextForWorkspace）", () => {
    expect(
      createToolContext({ workspaceRoot: "E:\\ws", skillsRoots: ["a", "b"] }),
    ).toEqual({ workspaceRoot: "E:\\ws", skillsRoots: ["a", "b"] });
  });
});

describe("toolContextForWorkspace —— 围栏根 = 会话的工作空间", () => {
  it("两个不同工作空间 → 围栏根不同、技能根不同（F2 的核心）", () => {
    const wsA = makeTempDir("statve-ws-a-");
    const wsB = makeTempDir("statve-ws-b-");

    const a = toolContextForWorkspace(wsA);
    const b = toolContextForWorkspace(wsB);

    expect(a.workspaceRoot).toBe(wsA);
    expect(b.workspaceRoot).toBe(wsB);
    expect(a.skillsRoots).not.toEqual(b.skillsRoots);
    // 项目级第一层就是 <cwd>/.statve/skills —— 两个工作空间各自一份
    expect(a.skillsRoots[0]).toBe(join(wsA, ".statve", "skills"));
    expect(b.skillsRoots[0]).toBe(join(wsB, ".statve", "skills"));
  });

  it("⭐ 技能按工作空间分开读：A 的项目级技能在 B 里看不到", () => {
    const wsA = makeTempDir("statve-ws-a-");
    const wsB = makeTempDir("statve-ws-b-");
    installProjectSkill(wsA, "only-in-a");

    const namesInA = loadSkills(
      toolContextForWorkspace(wsA).skillsRoots,
    ).skills.map((skill) => skill.name);
    const namesInB = loadSkills(
      toolContextForWorkspace(wsB).skillsRoots,
    ).skills.map((skill) => skill.name);

    expect(namesInA).toContain("only-in-a");
    expect(namesInB).not.toContain("only-in-a");
  });

  it("技能根是四层（项目两层的根由 cwd 推出来）", () => {
    const ws = makeTempDir("statve-ws-");
    const { skillsRoots } = toolContextForWorkspace(ws);

    expect(skillsRoots[0]).toBe(join(ws, ".statve", "skills"));
    expect(skillsRoots[1]).toBe(join(ws, ".agents", "skills"));
    // 用户级两层由数据根 + 家目录推出，不随工作空间变
    expect(skillsRoots.length).toBeGreaterThanOrEqual(3);
  });
});

describe("回归哨兵：模块级 ToolContext 常量必须不存在", () => {
  it("模块导出里没有 toolContext 这个名字（有它 = 又回到「所有会话共用一个根」）", () => {
    expect("toolContext" in context).toBe(false);
  });
});
