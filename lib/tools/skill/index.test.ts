// ============================================================
// skill 工具测试（C8 · T2）
// ============================================================
// 测的是「**模型唯一的入口**」：调 `skill` 工具会发生什么。
//
// 夹具（照 11.5：说得出"这个状态为什么真的会发生"）：
//   - `code-review`：可见技能 + 一份资源文件 —— 形状照抄本机真实技能
//     （`code-review/agents/openai.yaml`）
//   - `handoff`：写了 `disable-model-invocation: true` 的真实样本 ——
//     它就是"作者禁止模型自己喊"的那一类（本机 9 个这样的技能）
//   - 12 个文件的技能：**边界值构造**。列表上限就是 10，真实技能今天最多
//     十来个文件；超限那天必须有确定行为，而这条行为只能在这里钉死。
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillTool } from "./index";

async function writeSkill(
  dirName: string,
  skillMd: string,
  extraFiles: string[] = [],
): Promise<void> {
  const baseDir = join(root, dirName);
  await mkdir(baseDir, { recursive: true });
  await writeFile(join(baseDir, "SKILL.md"), skillMd, "utf8");
  for (const rel of extraFiles) {
    const full = join(baseDir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, "# fixture\n", "utf8");
  }
}

let root: string;
let tool: ReturnType<typeof createSkillTool>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "statve-agent-skill-tool-"));

  await writeSkill(
    "code-review",
    `---
name: code-review
description: Review the changes since a fixed point.
---

Two-axis review of the diff.
`,
    ["scripts/collect.py"],
  );

  await writeSkill(
    "handoff",
    `---
name: handoff
description: Compact the current conversation into a handoff document.
disable-model-invocation: true
---

Handoff instructions.
`,
  );

  const manyFiles = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, "0")}.txt`);
  await writeSkill(
    "many-files",
    `---
name: many-files
description: A skill with more files than the listing cap.
---

Body.
`,
    manyFiles,
  );

  tool = createSkillTool(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("skill 工具 —— 加载一个技能", () => {
  it("正文 + 技能目录绝对路径 + 文件清单一起给模型（Q5 定的形状）", async () => {
    const result = await tool.execute({ name: "code-review" });
    const text = result.content[0].type === "text" ? result.content[0].text : "";

    expect(text).toContain('<skill_content name="code-review">');
    expect(text).toContain("Two-axis review of the diff.");
    expect(text).toContain(join(root, "code-review"));
    expect(text).toContain(join("scripts", "collect.py"));
    // 相对路径要相对哪儿解析，必须说清楚，否则模型会拿工作区去拼
    expect(text).toContain("技能目录");
  });

  it("details 是同一份信息的结构化版本（给前端 / 轨迹 / 测试用，模型看不到）", async () => {
    const result = await tool.execute({ name: "code-review" });
    expect(result.details).toEqual({
      name: "code-review",
      baseDir: join(root, "code-review"),
      files: [join("scripts", "collect.py")],
    });
  });

  it("文件清单封顶 10（和正文里列的口径一致）", async () => {
    const result = await tool.execute({ name: "many-files" });
    const details = result.details as { files: string[] };
    expect(details.files).toHaveLength(10);
  });

  it("未知名字 → 抛错（引擎把错误变成 isError 的 toolResult 回给模型，不静默）", async () => {
    await expect(tool.execute({ name: "frontend-desgin" })).rejects.toThrow(/frontend-desgin/);
  });

  it("隐藏技能 → 抛错：disable-model-invocation 的语义就是「模型不许自己喊」", async () => {
    // 依据 DSH（本机 dsh-tool-skill/lib/index.js:147）：
    //   if (!isModelInvocable(skill)) throw new Error('… is not available for model invocation')
    // 用户仍可以用 /handoff 触发（手势路径），但模型不能自己把它拉进来。
    await expect(tool.execute({ name: "handoff" })).rejects.toThrow(/模型自己加载|disable-model-invocation/);
  });

  it("没给 name（模型偶尔会漏参数）→ 抛错说清要什么", async () => {
    await expect(tool.execute({})).rejects.toThrow(/name/);
  });

  it("每次都重新读盘：技能改了立刻生效（不加缓存是有意的）", async () => {
    await writeSkill(
      "volatile",
      `---
name: volatile
description: v1
---

first body
`,
    );
    const before = await tool.execute({ name: "volatile" });
    expect(before.details).toMatchObject({ name: "volatile" });

    await writeSkill(
      "volatile",
      `---
name: volatile
description: v2
---

second body
`,
    );
    const after = await tool.execute({ name: "volatile" });
    const text = after.content[0].type === "text" ? after.content[0].text : "";
    expect(text).toContain("second body");
    expect(text).not.toContain("first body");
  });
});

describe("skill 工具 —— 说明书（模型唯一的入口线索）", () => {
  it("名字是 skill，参数只认 name 且必填", () => {
    expect(tool.name).toBe("skill");
    expect(tool.parameters).toMatchObject({
      type: "object",
      required: ["name"],
    });
  });

  it("⭐ 两条红线写在描述里（不是写提示词）：如实报告缺依赖 / 不许自己装包", () => {
    // 为什么钉住：技能脚本是 Python（docx/xlsx 那些），而 python-docx /
    // openpyxl 在本机**没装** —— 模型跑一次必 ModuleNotFoundError，
    // 它的下一个动作几乎必然是去 pip install（往用户全局环境写东西）。
    // 描述被顺手改短 = 这条防线消失，而没有任何测试会因此变红。
    expect(tool.description).toContain("pip install");
    expect(tool.description).toMatch(/如实报告/);
  });

  it("⭐ 描述里是**硬时序**措辞（抄 DSH，不抄 pi 的软条件版）", () => {
    expect(tool.description).toMatch(/之前/);
    expect(tool.description).toMatch(/不要凭/);
  });
});
