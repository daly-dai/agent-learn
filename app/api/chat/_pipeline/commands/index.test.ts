// ============================================================
// _pipeline/commands.test.ts —— 命令清单组装（C13）
// ============================================================
// 钉住"当前内置命令有哪些"（避免误删/漏注册）+ 查询/执行共用同一份
// COMMAND_FACTORIES：commandDescriptors（查询零注册）与 createCommands
// （执行注册）看到的命令集合必须一致。
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandCatalog,
  commandDescriptors,
  createCommands,
  COMMAND_FACTORIES,
} from ".";

/** 往技能根里写一个技能目录（dirName 就是它的身份）—— 同 lib/skill 的夹具助手 */
async function writeSkill(
  root: string,
  dirName: string,
  description: string,
): Promise<void> {
  const baseDir = join(root, dirName);
  await mkdir(baseDir, { recursive: true });
  await writeFile(
    join(baseDir, "SKILL.md"),
    `---\nname: ${dirName}\ndescription: ${description}\n---\n\nbody\n`,
    "utf8",
  );
}

describe("COMMAND_FACTORIES —— 命令清单单一事实源", () => {
  it("当前内置 3 个命令（compact/clear/export）", () => {
    expect(COMMAND_FACTORIES.map((f) => f().name)).toEqual([
      "compact",
      "clear",
      "export",
    ]);
  });
});

describe("commandDescriptors —— 查询（不注册、不建注册表）", () => {
  it("返回全部命令的元数据视图，按名排序", () => {
    const descriptors = commandDescriptors();
    expect(descriptors.map((c) => c.name)).toEqual([
      "clear",
      "compact",
      "export",
    ]);
    for (const command of descriptors) {
      expect(command.source).toBe("builtin");
      expect(command.description.length).toBeGreaterThan(0);
      expect("handler" in command).toBe(false); // 前端安全：不泄漏执行函数
    }
  });

  it("与 createCommands().list() 看到的命令集合一致（同一份工厂数组）", () => {
    expect(commandDescriptors().map((c) => c.name)).toEqual(
      createCommands()
        .list()
        .map((c) => c.name),
    );
  });
});

describe("createCommands —— 执行（才实例化注册）", () => {
  it("注册了全部内置命令（compact/clear/export）", () => {
    const registry = createCommands();
    expect(registry.names()).toEqual(new Set(["compact", "clear", "export"]));
  });
});

// ------------------------------------------------------------------
// commandCatalog —— 面板清单 = 内置命令 + 技能（C8 T5）
// ------------------------------------------------------------------
// 夹具：**真实的**临时技能根（走真 `loadSkills`，不手拼 `Skill` 对象 —— 11.5
// 「能走真管道就走真管道」）。三个目录各代表一种真实会存在的形状：
//   - `code-review` 正常技能，该进面板
//   - `前端设计`    中文名（Q3 已定"中文技能名是正常的"）
//   - `compact`     **故意与内置命令同名** —— 这不是编的：技能目录名是用户起的，
//                   我们管不着，所以"撞名"是必然会发生的状态（R3-1 就是为它定的规则）
describe("commandCatalog —— 面板清单（内置命令 + 技能）", () => {
  let skillsRoot: string;

  beforeAll(async () => {
    skillsRoot = await mkdtemp(join(tmpdir(), "statve-catalog-"));
    await writeSkill(skillsRoot, "code-review", "两轴评审");
    await writeSkill(skillsRoot, "前端设计", "界面设计指导");
    await writeSkill(skillsRoot, "compact", "冒充内置命令的技能");
  });

  afterAll(async () => {
    await rm(skillsRoot, { recursive: true, force: true });
  });

  it('技能以 source:"skill" 进清单，且 supportsInlineArgs=true（选中是插文本、不是执行）', () => {
    const byName = new Map(
      commandCatalog(skillsRoot).commands.map((c) => [c.name, c]),
    );

    expect(byName.get("code-review")).toMatchObject({
      source: "skill",
      description: "两轴评审",
      supportsInlineArgs: true,
    });
    expect(byName.get("前端设计")?.source).toBe("skill");

    // 前端安全：descriptor 不许泄漏执行函数（同内置命令那条断言）
    for (const command of commandCatalog(skillsRoot).commands) {
      expect("handler" in command).toBe(false);
    }
  });

  it("命令在前、技能在后（面板上半 / 下半的物理依据；各自按名排序）", () => {
    expect(commandCatalog(skillsRoot).commands.map((c) => c.name)).toEqual([
      "clear",
      "compact",
      "export",
      "code-review",
      "前端设计",
    ]);
  });

  it("⭐ 撞名：内置优先 —— 技能被顶掉，但**有一条诊断**（R3-1：不能静默丢）", () => {
    const { commands, diagnostics } = commandCatalog(skillsRoot);

    const compacts = commands.filter((c) => c.name === "compact");
    expect(compacts).toHaveLength(1);
    expect(compacts[0]?.source).toBe("builtin");

    const collided = diagnostics.find((d) => d.name === "compact");
    expect(collided?.reason).toContain("重名");
    expect(collided?.dir).toBe(join(skillsRoot, "compact"));
  });

  it("坏技能的诊断随清单一起带出去（T5 的职责：把同一份诊断带给前端面板）", async () => {
    const broken = await mkdtemp(join(tmpdir(), "statve-catalog-broken-"));
    // 缺 description 的技能：标准要求必填，真机上用户手写 SKILL.md 时最容易漏
    await mkdir(join(broken, "no-desc"), { recursive: true });
    await writeFile(
      join(broken, "no-desc", "SKILL.md"),
      "---\nname: no-desc\n---\n\nbody\n",
      "utf8",
    );

    const { commands, diagnostics } = commandCatalog(broken);
    expect(commands.map((c) => c.name)).toEqual(["clear", "compact", "export"]);
    expect(diagnostics.map((d) => d.name)).toEqual(["no-desc"]);

    await rm(broken, { recursive: true, force: true });
  });

  it("技能根不存在 → 只有命令、没有诊断（新机器还没装过技能，不是错误）", () => {
    const { commands, diagnostics } = commandCatalog(join(skillsRoot, "nope"));
    expect(commands.map((c) => c.name)).toEqual(["clear", "compact", "export"]);
    expect(diagnostics).toEqual([]);
  });
});
