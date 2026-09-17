// ============================================================
// skill.test.ts —— 技能加载与渲染（C8 · T1）
// ============================================================
// 测 §8.1 的四个 seam：loadSkills / buildSkillCatalog /
// renderSkillContent / findSkill。
//
// 夹具为什么长这样（AGENTS 第 11.5 条：夹具必须能说出"这个状态为什么真
// 会发生"）—— 下面每份 SKILL.md 都**照抄本机 ~/.agents/skills 的真实样本**，
// 不是编出来的 YAML：
//   - description 带转义引号 ............ code-review 原样
//   - version/author/license/platforms
//     + metadata 嵌套块 ................. xlsx / docx 原样
//   - disable-model-invocation
//     + argument-hint ................... handoff 原样
//   - 坏技能（缺 description / 无 frontmatter）**今天不存在**，但技能文件是
//     用户手写的外部数据 —— 写错 YAML 缩进是必然会发生的状态，所以必须造。
// 也正因为技能目录是"用户随时会改的外部数据"，测试用临时目录而不是直接读
// 真实技能根：真实根今天一个坏技能都没有，测不出兜底行为。
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { config } from "../config";
import {
  buildSkillCatalog,
  findSkill,
  findSkillInvocations,
  loadSkills,
  renderSkillContent,
  type Skill,
} from "./index";

/** 往技能根里写一个技能目录（dirName 就是它的身份） */
async function writeSkill(
  root: string,
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

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "statve-skills-"));

  // ① 带转义引号的 description（code-review 真实形状）
  await writeSkill(
    root,
    "code-review",
    `---
name: code-review
description: "Review the changes since a fixed point. Use when the user asks to \\"review since X\\"."
---

Two-axis review of the diff.
`,
  );

  // ② 最简形态（tdd 真实形状）
  await writeSkill(
    root,
    "tdd",
    `---
name: tdd
description: Test-driven development. Use when the user wants test-first.
---

Write the test first.
`,
  );

  // ③ 额外键 + metadata 嵌套块 + 资源文件（xlsx 真实形状）
  await writeSkill(
    root,
    "xlsx",
    `---
name: xlsx
description: Create, read, edit Excel .xlsx workbooks and CSVs.
version: 1.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
metadata:
  category: documents
  homepage: https://example.com
---

Spreadsheet instructions.
`,
    ["scripts/make.py", "LICENSE.txt"],
  );

  // ④ 隐藏技能（handoff 真实形状：disable-model-invocation + argument-hint）
  await writeSkill(
    root,
    "handoff",
    `---
name: handoff
description: Compact the current conversation into a handoff document.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Handoff instructions.
`,
  );

  // ⑤ 目录名与 frontmatter name 不符（Q3 定案：按目录名加载 + 一条诊断）
  await writeSkill(
    root,
    "wrong-name",
    `---
name: something-else
description: The frontmatter name does not match the directory name.
---

Body of the misnamed skill.
`,
  );

  // ⑥ 缺 description（标准要求必填）→ 跳过 + 诊断
  await writeSkill(
    root,
    "no-description",
    `---
name: no-description
---

Body without a description.
`,
  );

  // ⑦ 完全没有 frontmatter → 跳过 + 诊断
  await writeSkill(root, "no-frontmatter", `Just a body, no frontmatter at all.\n`);

  // ⑧ 不是技能目录（用户会往技能根里放草稿/备份）→ 不加载，但**不是坏技能**
  await mkdir(join(root, "not-a-skill"), { recursive: true });
  await writeFile(join(root, "not-a-skill", "README.md"), "scratch\n", "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadSkills —— 扫技能根（身份 = 目录名，坏技能跳过但留诊断）", () => {
  it("正常技能：正文不含 frontmatter、baseDir 是绝对路径、文件清单递归且排除 SKILL.md", () => {
    const { skills } = loadSkills(root);
    const xlsx = skills.find((s) => s.name === "xlsx");

    expect(xlsx).toBeDefined();
    expect(xlsx?.description).toBe("Create, read, edit Excel .xlsx workbooks and CSVs.");
    expect(xlsx?.content).toBe("Spreadsheet instructions.");
    expect(xlsx?.baseDir).toBe(join(root, "xlsx"));
    expect(isAbsolute(xlsx?.baseDir ?? "")).toBe(true);
    // 递归相对路径、字母序；SKILL.md 自己的正文已经给模型了，不重复列
    expect(xlsx?.files).toEqual(["LICENSE.txt", join("scripts", "make.py")]);
    expect(xlsx?.modelInvocable).toBe(true);
  });

  it("description 的双引号被去掉、内部的 \\\" 还原（真实样本就有转义引号）", () => {
    const { skills } = loadSkills(root);
    const codeReview = skills.find((s) => s.name === "code-review");
    expect(codeReview?.description).toBe(
      'Review the changes since a fixed point. Use when the user asks to "review since X".',
    );
  });

  it("只认 3 个键：version/author/license/platforms/metadata 嵌套块一律忽略且不报错", () => {
    const { skills, diagnostics } = loadSkills(root);
    expect(skills.some((s) => s.name === "xlsx")).toBe(true);
    expect(diagnostics.some((d) => d.name === "xlsx")).toBe(false);
  });

  it("disable-model-invocation: true → modelInvocable=false，但技能本身仍在（面板要用）", () => {
    const { skills } = loadSkills(root);
    const handoff = skills.find((s) => s.name === "handoff");
    expect(handoff).toBeDefined();
    expect(handoff?.modelInvocable).toBe(false);
  });

  it("frontmatter 的 name 与目录名不符 → 按目录名加载 + 一条可见诊断", () => {
    const { skills, diagnostics } = loadSkills(root);
    expect(skills.some((s) => s.name === "wrong-name")).toBe(true);
    expect(skills.some((s) => s.name === "something-else")).toBe(false);
    expect(diagnostics).toHaveLength(1 + 2); // wrong-name + 缺 description + 无 frontmatter
    expect(diagnostics.find((d) => d.name === "wrong-name")?.reason).toContain("something-else");
  });

  it("缺 description → 跳过 + 诊断（一条坏技能不影响其余）", () => {
    const { skills, diagnostics } = loadSkills(root);
    expect(skills.some((s) => s.name === "no-description")).toBe(false);
    expect(diagnostics.some((d) => d.name === "no-description")).toBe(true);
  });

  it("完全没有 frontmatter → 跳过 + 诊断", () => {
    const { skills, diagnostics } = loadSkills(root);
    expect(skills.some((s) => s.name === "no-frontmatter")).toBe(false);
    expect(diagnostics.some((d) => d.name === "no-frontmatter")).toBe(true);
  });

  it("好技能照常加载（坏技能不阻塞）：5 个进列表、字母序", () => {
    const { skills } = loadSkills(root);
    expect(skills.map((s) => s.name)).toEqual([
      "code-review",
      "handoff",
      "tdd",
      "wrong-name",
      "xlsx",
    ]);
  });

  it("目录里没有 SKILL.md → 既不进技能列表，也不算坏技能（用户会放草稿目录）", () => {
    const { skills, diagnostics } = loadSkills(root);
    expect(skills.some((s) => s.name === "not-a-skill")).toBe(false);
    expect(diagnostics.some((d) => d.name === "not-a-skill")).toBe(false);
  });

  it("技能根不存在 → 空结果、不抛错（新机器上还没装过技能）", () => {
    const result = loadSkills(join(root, "does-not-exist"));
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("诊断带绝对路径（要能直接去改那个文件）", () => {
    const { diagnostics } = loadSkills(root);
    for (const d of diagnostics) {
      expect(isAbsolute(d.dir)).toBe(true);
    }
  });
});

// ============================================================
// parseFrontmatter 的「收尾」判定（2026-09-17 T8a · a1）
// ============================================================
// 上面那组用的是共享夹具（坏技能只有"没有 frontmatter"和"缺 description"
// 两种）；这里坏在**收尾那一行**，换个临时根单开一组，免得动上面的计数断言。
// ============================================================
describe("parseFrontmatter —— 收尾必须是「真的收尾」", () => {
  it("⭐ 忘了写收尾 + 正文里有 --- ⇒ 跳过 + 诊断（不许静默把前半段正文吞掉）", async () => {
    // 真实场景：技能是用户手写的外部数据，frontmatter 写完忘了补第二行 `---`；
    // 而 markdown 正文里本来就常有分隔线 —— 那条分隔线会被当成收尾，于是
    // "前半段正文"被逐行当成 frontmatter 字段吃掉，技能却还能"正常"加载。
    // 这是**静默**失败：不报错、不诊断，正文平白少一截。
    const dir = await mkdtemp(join(tmpdir(), "statve-swallow-"));

    try {
      await writeSkill(
        dir,
        "swallow",
        `---
name: swallow
description: 忘了写收尾的技能

# 前半段标题

前半段正文，这一段是真正的正文。

---

后半段正文。
`,
      );

      const { skills, diagnostics } = loadSkills(dir);

      expect(skills.map((s) => s.name)).toEqual([]); // ← 今天它是 ["swallow"]
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.name).toBe("swallow");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("三类「合法的非键行」都不算坏（空行 / 缩进子键 / 顶格注释）", async () => {
    // 收紧判据的**唯一**风险是假阳性 —— 把一份本来能用的技能判坏。所以这里把
    // 该放行的三类一次钉住。三类的证据强度**不一样**，如实写清：
    //   · 缩进子键：真实数据里有 16 行（`metadata:` 的子孙），最硬；
    //   · 空行 / 顶格注释：真实 30 个技能里 0 行 —— 它们不是"我们见过的形状"，
    //     而是"合法的 YAML"，且技能根是**跨 harness 共用**的（~/.agents/skills
    //     不只我们一家在读），别家走真 YAML 解析器 ⇒ 别人写的技能可能带注释，
    //     判坏了就是我们自己制造的假阳性。
    const dir = await mkdtemp(join(tmpdir(), "statve-legal-lines-"));

    try {
      await writeSkill(
        dir,
        "legal",
        `---
name: legal
description: frontmatter 里混着空行、缩进子键和注释

# 维护者备注：这个技能还没写完
metadata:
  author: someone
  version: 1.0

---

正文。
`,
      );

      const { skills, diagnostics } = loadSkills(dir);

      expect(skills.map((s) => s.name)).toEqual(["legal"]);
      expect(skills[0]?.description).toBe(
        "frontmatter 里混着空行、缩进子键和注释",
      );
      expect(diagnostics).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("⚠️ 已知边界：被吞的那半段若只有空行和 # 标题，仍然会静默截断", async () => {
    // 这条**不是在测实现做对了**，是把"我们什么时候会失败"钉在代码里。
    // 判据是「真 YAML 解析器会报错的行我们也不收」—— 而 `# 标题` 在 YAML 里
    // 就是注释、空行就是空行，**真解析器同样接受**，于是它照样把上面那个
    // 假的收尾当真。所以这一段**任何**实现都区分不了（除非比 YAML 更严，
    // 那就会误杀另一批合法技能）。复现条件：忘了写收尾 + 正文开头只隔了
    // 标题和空行就出现 `---`（真实 30 个技能里一个都没有）。
    const dir = await mkdtemp(join(tmpdir(), "statve-boundary-"));

    try {
      await writeSkill(
        dir,
        "boundary",
        `---
name: boundary
description: 收尾忘了写，被吞掉的那半段正好只有标题

# 前半段标题

---

后半段正文。
`,
      );

      const { skills, diagnostics } = loadSkills(dir);

      expect(skills.map((s) => s.name)).toEqual(["boundary"]); // 照常加载
      expect(skills[0]?.content).toBe("后半段正文。"); // 前半段标题没了
      expect(diagnostics).toEqual([]); // 而且一声不吭
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildSkillCatalog —— 只给模型看它调得动的（markdown 列表）", () => {
  it("markdown 形态 `- \`name\`: description`，前面一句引导语", () => {
    const { skills } = loadSkills(root);
    const catalog = buildSkillCatalog(skills);
    expect(catalog).toContain("- `code-review`: Review the changes since a fixed point.");
    expect(catalog.split("\n")[0]).not.toContain("- `"); // 第一行是引导语，不是条目
  });

  it("disable-model-invocation 的技能一条都不出现（作者禁止模型自己喊）", () => {
    const { skills } = loadSkills(root);
    const catalog = buildSkillCatalog(skills);
    expect(catalog).not.toContain("handoff");
  });

  it("没有技能 → 空串（调用方据此整节省略，不留一个空标题）", () => {
    expect(buildSkillCatalog([])).toBe("");
  });

  it("全部隐藏 → 也是空串（不能只剩一句引导语空吊着）", () => {
    const hidden: Skill = {
      name: "x",
      description: "d",
      baseDir: root,
      content: "c",
      files: [],
      modelInvocable: false,
    };
    expect(buildSkillCatalog([hidden])).toBe("");
  });

  it("顺序稳定（按名字）：同样的输入永远同样的输出", () => {
    const { skills } = loadSkills(root);
    const names = buildSkillCatalog(skills)
      .split("\n")
      .filter((line) => line.startsWith("- `"))
      .map((line) => line.slice(3).split("`")[0]);
    expect(names).toEqual(["code-review", "tdd", "wrong-name", "xlsx"]);
  });

  it("不带诊断时逐字不变（可选参数，向后兼容 —— 上面那几条断言就是证据）", () => {
    const { skills } = loadSkills(root);
    expect(buildSkillCatalog(skills, [])).toBe(buildSkillCatalog(skills));
  });

  it("⭐ 带诊断 → 尾巴上多一段交代，坏技能的名字进得了提示词", () => {
    // 为什么这条重要：这是 2026-09-17 定的"诊断可见"的实际落点（详案 §17）——
    // 不打 UI，借清单这条现成通道**让模型转告用户**。
    const { skills, diagnostics } = loadSkills(root);
    const catalog = buildSkillCatalog(skills, diagnostics);

    expect(catalog).toContain("没有加载成功");
    expect(catalog).toContain("把下面这条告诉他"); // 明说让模型转告，不是指望它自己想到
    expect(catalog).toContain("`no-description`");
    expect(catalog).toContain("`no-frontmatter`");
  });

  it("⭐ 「跳过坏的」这条没被改：坏技能不会变成清单条目", () => {
    // 诊断段里的行是 `- \\`名字\\`（路径）：原因`；清单条目是 `- \\`名字\\`: 描述`。
    // 只断言后者不存在 —— 别把"C 位不同"写成"名字没出现"，那证不出东西。
    const { skills, diagnostics } = loadSkills(root);
    const catalog = buildSkillCatalog(skills, diagnostics);

    expect(catalog).not.toContain("- `no-description`:");
    expect(catalog).not.toContain("- `no-frontmatter`:");
  });

  it("⭐ 只有诊断、清单为空 → 不是空串（技能全坏了，恰恰最该说）", () => {
    const { diagnostics } = loadSkills(root);
    const catalog = buildSkillCatalog([], diagnostics);

    expect(catalog).not.toBe("");
    expect(catalog).toContain("没有加载成功");
    // 但没有清单就不该有引导语（那是"清单自己的一部分"，空清单下说了会误导）
    expect(catalog).not.toContain("以下技能可用");
  });

  it("⭐ 诊断段封顶 5 条，且**如实报出还剩几条**（只封「给模型那一份」）", () => {
    // 依据：PLAN.md 排期表 C22 —— 生产者如实产全量，**只有模型输出层才截**，
    // 而且**截了要说丢了多少**。所以这里同时验两件事：列出的封在 5 条、
    // 以及"还有 3 个"这句话在。
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `broken-${i}`,
      dir: join(root, `broken-${i}`),
      reason: "缺少 description",
    }));

    const catalog = buildSkillCatalog([], many);

    expect(catalog).toContain("另有 8 个技能"); // 总数照实说
    expect(catalog).toContain("`broken-0`");
    expect(catalog).toContain("`broken-4`"); // 第 5 条（下标 4）是最后一条
    expect(catalog).not.toContain("`broken-5`"); // 第 6 条起不列
    expect(catalog).toContain("还有 3 个没列出");
    expect(catalog).toContain("全部 8 条");
  });

  it("刚好 5 条时不出现「还有 0 个没列出」这种废话", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      name: `b-${i}`,
      dir: join(root, `b-${i}`),
      reason: "缺 description",
    }));

    const catalog = buildSkillCatalog([], five);

    expect(catalog).toContain("`b-4`");
    expect(catalog).not.toContain("没列出");
  });
});

describe("renderSkillContent —— 两条路（工具 / 手势）共用的同一份形态", () => {
  it("含技能名、绝对目录、相对路径提示、正文", () => {
    const { skills } = loadSkills(root);
    const block = renderSkillContent(skills.find((s) => s.name === "code-review")!);

    expect(block).toContain('<skill_content name="code-review">');
    expect(block).toContain(join(root, "code-review"));
    expect(block).toContain("Two-axis review of the diff.");
    expect(block.trimEnd().endsWith("</skill_content>")).toBe(true);
  });

  it("文件清单进资源段（模型据此知道 scripts/ 存在，不用瞎猜）", () => {
    const { skills } = loadSkills(root);
    const block = renderSkillContent(skills.find((s) => s.name === "xlsx")!);
    expect(block).toContain(join("scripts", "make.py"));
    expect(block).toContain("LICENSE.txt");
  });

  it("没有附加文件 → 不出现空清单标题", () => {
    const { skills } = loadSkills(root);
    const block = renderSkillContent(skills.find((s) => s.name === "tdd")!);
    expect(block).toContain("<skill_resources>");
    expect(block).not.toContain("LICENSE.txt");
  });

  it("文件超过 10 个 → 只列前 10，并如实说出共几个（不假装列全了）", () => {
    const many: Skill = {
      name: "many-files",
      description: "d",
      baseDir: root,
      content: "body",
      // 边界值构造：上限就是 10，真实技能今天最多十来个文件，
      // 超限那天必须有确定行为 —— 而这条行为只能在这里钉死。
      files: Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, "0")}.txt`),
      modelInvocable: true,
    };
    const block = renderSkillContent(many);
    expect(block).toContain("f00.txt");
    expect(block).toContain("f09.txt");
    expect(block).not.toContain("f10.txt");
    expect(block).toContain("12");
  });

  it("名字里的引号 / & 被转义（名字来自目录名，我们不做 kebab 校验 ⇒ 什么字符都可能）", () => {
    const weird: Skill = {
      name: 'a"b&c',
      description: "d",
      baseDir: root,
      content: "body",
      files: [],
      modelInvocable: true,
    };
    const block = renderSkillContent(weird);
    expect(block).toContain('<skill_content name="a&quot;b&amp;c">');
    expect(block.split("\n")[0]).toBe('<skill_content name="a&quot;b&amp;c">');
  });
});

describe("findSkill —— 精确查名字（不猜、不模糊）", () => {
  it("命中目录名 → 返回技能", () => {
    const { skills } = loadSkills(root);
    expect(findSkill(skills, "code-review")?.name).toBe("code-review");
  });

  it("大小写不同不算命中（身份 = 目录名，名字是数据不是线索）", () => {
    const { skills } = loadSkills(root);
    expect(findSkill(skills, "Code-Review")).toBeUndefined();
  });

  it("不存在 → undefined（调用方决定是报错还是静默）", () => {
    const { skills } = loadSkills(root);
    expect(findSkill(skills, "frontend-desgin")).toBeUndefined();
  });
});

// ------------------------------------------------------------------
// findSkillInvocations —— 裸名手势（C8 · T4）
// ------------------------------------------------------------------
// 夹具单独开一个临时技能根，不动上面那份（那份被别的用例数过条目）。
// 三个名字各代表一种**真实会存在**的形状：
//   - `code-review`  本机真的装了它 = 正常英文名
//   - `前端设计`     Q3 明确定过"中文技能名是正常的" ⇒ 它必须能命中。
//                    这条用例同时是"不抄 DSH 的 kebab 正则"那个决定的守卫。
//   - `docs`         本机没有这个技能，是**为了可证伪才造的**：正文里写 `/docs/api`
//                    时，若把名字切到斜杠就会切出 `docs` 而**误命中**；按空白切得到
//                    `docs/api`、查不中。没有它，"名字切到哪儿"这条规则就没有用例守着。
describe("findSkillInvocations —— 裸名手势（谁被 /名字 点到了）", () => {
  let gestureRoot: string;
  let gestureSkills: Skill[];

  beforeAll(async () => {
    gestureRoot = await mkdtemp(join(tmpdir(), "statve-gesture-"));
    await writeSkill(
      gestureRoot,
      "code-review",
      "---\nname: code-review\ndescription: 两轴评审\n---\n\nbody\n",
    );
    await writeSkill(
      gestureRoot,
      "前端设计",
      "---\nname: 前端设计\ndescription: 界面设计指导\n---\n\nbody\n",
    );
    await writeSkill(
      gestureRoot,
      "docs",
      "---\nname: docs\ndescription: 文档查询（只为证明切法）\n---\n\nbody\n",
    );
    gestureSkills = loadSkills(gestureRoot).skills;
  });

  afterAll(async () => {
    await rm(gestureRoot, { recursive: true, force: true });
  });

  /** 命中结果的名字列表（顺序 = 在消息里出现的顺序） */
  function namesIn(text: string): string[] {
    return findSkillInvocations(text, gestureSkills).map((skill) => skill.name);
  }

  it("行首的 /名字 命中（面板选中后就是长这样）", () => {
    expect(namesIn("/code-review 帮我评审这个 commit")).toEqual(["code-review"]);
  });

  it("正文中间的 /名字 也命中（R3-3：扫整条消息，不只看行首）", () => {
    expect(namesIn("帮我用 /code-review 评审一下")).toEqual(["code-review"]);
  });

  it("⭐ 路径不误命中：/docs/api 里那个 docs 不算被点到（切到空白为止，不是切到斜杠）", () => {
    // 名单里**故意**有一个叫 docs 的技能 —— 这条用例的分辨力全靠它：
    // 切到斜杠 → 切出 "docs" → 误命中；切到空白 → "docs/api" → 查不中。
    expect(namesIn("参考 /docs/api 里的说明")).toEqual([]);
  });

  it("路径 /usr/bin 同理不命中", () => {
    expect(namesIn("去 /usr/bin 下面找")).toEqual([]);
  });

  it("分数 5/8 不命中（/ 左边不是串首也不是空白）", () => {
    expect(namesIn("这个比例是 5/8")).toEqual([]);
  });

  it("中文技能名命中（中文名正常 ⇒ 不做任何字符集限制）", () => {
    expect(namesIn("用 /前端设计 帮我看看这个页面")).toEqual(["前端设计"]);
  });

  it("名字打错 → 静默返回空（查名单，不猜）", () => {
    expect(namesIn("用 /frontend-desgin 看看")).toEqual([]);
  });

  it("同一个技能出现两次 → 只算一次（正文注入一次就够）", () => {
    expect(namesIn("/code-review 先看 /code-review 再说话")).toEqual([
      "code-review",
    ]);
  });

  it("两个不同技能 → 按出现顺序返回（注入顺序可复现）", () => {
    expect(namesIn("/前端设计 之后再 /code-review")).toEqual([
      "前端设计",
      "code-review",
    ]);
  });

  it("⚠️ 已知代价：名字后紧跟中文标点 → 不命中（边界就是空白，与 DSH 相同）", () => {
    // 面板选中后插的是 `/名字 `（带尾空格），从面板走踩不到这条；
    // 手打不加空格会静默失效 —— 写成用例留档，别留给后人当 bug 查。
    expect(namesIn("/code-review，帮我评审")).toEqual([]);
  });

  it("没有技能 / 空文本 → 空结果（不报错）", () => {
    expect(findSkillInvocations("/code-review 看看", [])).toEqual([]);
    expect(findSkillInvocations("", gestureSkills)).toEqual([]);
  });
});

// ------------------------------------------------------------------
// 真实技能根（本机 ~/.agents/skills）：有才跑，没装过就跳过。
// 这里**不钉数量**（技能是用户随时会装的，钉 29/20 这种数字会烂），
// 只钉"无论装了什么、这些性质都必须成立"——钉数量那类断言在技能增加
// 当天就会变红，然后被人顺手改成新数字，从此失去意义。
// ------------------------------------------------------------------
describe("真实技能根（本机已装的技能）", () => {
  const realRoot = config.paths.skillsRoot;
  const installed = existsSync(realRoot);

  it.skipIf(!installed)("每个技能都能自证：名字 = 目录名、目录绝对、正文已去掉 frontmatter", () => {
    const { skills } = loadSkills(realRoot);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.baseDir.endsWith(skill.name)).toBe(true);
      expect(isAbsolute(skill.baseDir)).toBe(true);
      expect(skill.content.startsWith("---")).toBe(false);
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });

  it.skipIf(!installed)("⭐ 隐藏技能两个条件同时成立：不在模型清单里、仍在技能列表里", () => {
    // 这条是 Q3 的守卫，在真实数据上验：漏一个 → 模型会自己喊作者禁止它喊的技能；
    // 多滤一个 → 面板里就少了它，用户打 /名字 也没反应。
    const { skills } = loadSkills(realRoot);
    const catalog = buildSkillCatalog(skills);
    const hidden = skills.filter((skill) => !skill.modelInvocable);

    for (const skill of hidden) {
      expect(catalog).not.toContain(skill.name);
      expect(findSkill(skills, skill.name)).toBeDefined();
    }
  });

  it.skipIf(!installed)("真实技能的目录名不含路径分隔符（否则名字没法当 / 手势的命令名）", () => {
    const { skills } = loadSkills(realRoot);
    for (const skill of skills) {
      expect(skill.name).not.toContain("/");
      expect(skill.name).not.toContain("\\");
    }
  });
});
