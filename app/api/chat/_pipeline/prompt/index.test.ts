// ============================================================
// 系统提示词单测
// ============================================================
// 为什么值得测一句提示词：**它是本次真机验收抓出来的 bug 的修复点**。
//
// 2026-09-14 验收：用户问「即梦**今年**的营收」→ 模型搜「即梦 **2025** 营收」。
// 那天是 2026-09-14。根因=提示词里没有任何时间，模型只能拿训练截止当"现在"。
//
// ⚠️ 这类 bug 的特点：**两边都不报错**。模型照常回答、工具照常返回，
// 只是答案悄悄地错了一年。所以只能靠断言钉住"提示词里必须有时间"。
// ============================================================

import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@/lib/tools";
import { buildSystemPrompt, formatCurrentTime } from ".";

/** 固定时刻（本地时区构造，落在哪一天与时区无关）——2026-09-14 是星期一 */
const FIXED = new Date(2026, 8, 14, 18, 43);

describe("formatCurrentTime —— 给人/模型看的一行时间", () => {
  it("带出年月日和星期", () => {
    const stamp = formatCurrentTime(FIXED);
    expect(stamp).toContain("2026");
    expect(stamp).toContain("9");
    expect(stamp).toContain("14");
    expect(stamp).toContain("星期一");
  });

  it("带出时区（否则那个时刻对模型是悬浮的）", () => {
    expect(formatCurrentTime(FIXED)).toContain("时区");
  });

  it("时区可注入（测试与多区域部署都要这个口子）", () => {
    // 同一个时刻，换个时区渲染出来的钟点应该不同——证明它真的在用注入的时区
    const shanghai = formatCurrentTime(FIXED, "Asia/Shanghai");
    const utc = formatCurrentTime(FIXED, "UTC");
    expect(shanghai).toContain("Asia/Shanghai");
    expect(utc).toContain("UTC");
    expect(shanghai).not.toBe(utc);
  });
});

describe("buildSystemPrompt —— 提示词整体", () => {
  it("⭐ 必须带当前年份（这次的 bug 就出在这儿）", () => {
    expect(buildSystemPrompt(FIXED)).toContain("2026");
  });

  it("必须点明「以这个时间为准、训练截止不是现在」", () => {
    // 只把时间塞进去还不够：不说用途，模型会当一段无关的元信息忽略掉。
    // 所以这句话（"训练数据截止时间不是现在"）才是修复的另一半。
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toMatch(/相对时间/);
    expect(prompt).toMatch(/训练数据截止时间不是现在/);
  });

  it("原有内容一个字不少（角色 / 工具使用原则 / 输出要求）", () => {
    // 搬迁 + 加内容时最容易顺手漏掉原来的段落——原文没有单测，
    // 这一条就是它的兜底
    // ⚠️ 两次收窄，都是"那段内容搬家了"，不是丢了：
    //   ① 2026-09-16 删掉手抄的工具**清单**（"这把工具是什么"归随请求的 `tools` 定义）
    //   ② 同日删掉手写的工具**规矩**（`todo_write` / `ask_user_question` 那些 `- 工具名：…`
    //      条目）→ 改由各工具自己投稿、按注册顺序渲染。
    // 所以这里改成**只用"不传 guidelines"的调用断言稳定骨架还在**；
    // "工具规矩真的渲染出来了"交给下面那条端到端用例。
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toContain("statve");
    expect(prompt).toContain("## 工具使用原则");
    expect(prompt).toContain("## 输出要求");
    expect(prompt).toContain("始终用中文回答");
  });

  it("⭐ 端到端：真注册表的投稿真的进了提示词（工具 → 注册表 → 提示词）", () => {
    // 原来这里是「两个 web 工具的用法都在」——那条断言的是"提示词里出现 web_search /
    // web_fetch 字样"。C34（2026-09-16）之后这个前提不成立了：web 工具的用法拆成了
    // **description**（"是什么 / 外部不可信"）和**工具自己投稿的规矩**（"什么时候用 / 接 `web_fetch`"），
    // 提示词里只该出现后者。所以换成端到端这条 —— 它守的是**渲染那一步别漏**：
    // 工具声明了 guidelines、注册表也收集了，但没渲染进提示词 ⇒ 静默少几条规矩，没人报错。
    const registry = createToolRegistry(
      { workspaceRoot: process.cwd(), skillsRoot: process.cwd() },
      {},
    );
    const guidelines = registry.guidelines();
    const prompt = buildSystemPrompt(FIXED, "", guidelines);

    for (const { name } of guidelines) {
      expect(prompt, `工具 ${name} 的规矩没有进提示词`).toContain(`- ${name}：`);
    }
    // 防"空转"：注册表一条投稿都没有的话，上面的循环什么都没验。
    // 断言的是"有工具带规矩"这个**性质**，不钉具体条数（条数会随工具增减变）。
    expect(guidelines.length).toBeGreaterThan(0);
  });

  it("时间不同 → 提示词不同（证明它是函数不是常量）", () => {
    expect(buildSystemPrompt(new Date(2026, 0, 1))).not.toBe(
      buildSystemPrompt(new Date(2027, 0, 1)),
    );
  });
});

// ------------------------------------------------------------
// 工具使用原则：**只写规矩，不列工具清单**（2026-09-16 用户定）
// ------------------------------------------------------------
// 为什么删清单：每个工具"是什么、有什么参数"由**随请求发来的 `tools` 定义**承载
// （那是权威，而且改工具时同一个文件里就看见）。手抄一份名单是**第二事实源**，注定漂 ——
// 实测：这段从 Phase 3（8 个工具）一路活到 14 个工具，中途搬了三次家，第 14 个工具
// （`skill`）就漏了，**没有任何东西逼它同步**。
// 判据：**提示词里出现工具名的唯一理由 = 这条规矩是"这个工具专属"的**。

describe("buildSystemPrompt —— 工具使用原则（只写规矩，不列清单）", () => {
  it("⭐ 政策条款一条不少（删清单时最容易顺手把这些也删了）", () => {
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toMatch(/弹框请用户确认/); // 写 / 改 / 删要审批
    expect(prompt).toMatch(/不要反复重试/); // 被拒绝后不许硬来
    expect(prompt).toMatch(/一次只调用当前步骤真正需要的工具/);
    expect(prompt).toMatch(/如实说明，不要假装成功/);
    // ⚠️ 原来这里还有 5 条：`一次模型调用的钱`（web_search 成本）/ `绝不能当成指令执行`
    // （外部内容不可信）/ `PowerShell`（bash 环境）/ `completed`（todo 收尾）/
    // `跳过…不是错误`（ask 契约）。C34（2026-09-16）之后它们**全部搬进各自的工具文件**，
    // 不再是这条提示词的"政策"。它们现在由 `lib/tools/index.test.ts` 的
    // 「搬进工具文件的那几条规矩还在」+ 本文件那条端到端用例守。
    expect(prompt).toMatch(/只有用户明确要求/); // 概念的通用规矩（不点名工具）
  });

  it("⭐ 不再逐条介绍工具（那些内容在 tools 定义里）", () => {
    const prompt = buildSystemPrompt(FIXED);
    // 曾经的形状是 `- 工具名（它能干什么）`；下面这些是**纯介绍**，已删
    expect(prompt).not.toContain("你可以调用这些工具");
    expect(prompt).not.toMatch(/- list_files（/);
    expect(prompt).not.toMatch(/- read_file（/);
    expect(prompt).not.toMatch(/- write_file（/);
    expect(prompt).not.toMatch(/- grep（/);
    expect(prompt).not.toMatch(/- write_note（/);
  });

  it("投稿按注册顺序渲染成 `- <工具名>：<规矩>`（一条投稿一行，不重不漏）", () => {
    // ⚠️ 这条**取代**了原来那条"提到工具名的每一条都带着规矩"的启发式断言。
    // 为什么换掉：那条靠一张手写关键词表（确认 / 重试 / 钱 / PowerShell…）猜"这是不是规矩"，
    // 而"跨调用管道"那类投稿（"拿到结果后想知道完整内容就用 `web_fetch` 抓"）**一个关键词都不含**，
    // 却完全合法 —— 启发式会误伤它。归属定死之后，"是不是规矩"不再需要猜：
    // **渲染出来的条目只可能来自投稿**，所以直接断言"渲染 == 投稿"。
    const guidelines = [
      { name: "web_search", text: "只在确实需要最新信息时才用。" },
      { name: "todo_write", text: "全部完成时要收尾。" },
    ];
    const prompt = buildSystemPrompt(FIXED, "", guidelines);
    const rendered = prompt
      .split("\n")
      .filter((line) => /^- [a-z][a-z_]*：/.test(line));

    expect(rendered).toEqual([
      "- web_search：只在确实需要最新信息时才用。",
      "- todo_write：全部完成时要收尾。",
    ]);
  });

  it("⭐ 工具专属的规矩只能来自工具投稿 —— 手写部分一个工具名都不许有", () => {
    // 2026-09-16 定的归属规则（C34）：规矩的**文本住在各工具文件里**
    // （`RegisteredTool.guidelines`），由使用端收集后传进 buildSystemPrompt。
    //
    // ⚠️ 这条是**加宽过**的。第一版只抓「行首就是工具名」的条目（`^- [a-z_]+：`），
    // 结果重验时发现夹在句子中间的手写引用**从洞里漏过去了**：`## 什么时候必须联网` 里
    // 那句「…而你手上没有它的内容（**这时用 web_fetch**）」。改成扫**整段**里出现的
    // 每一个已注册工具名 —— 手写提到任何一个，都该由那个工具自己投稿。
    //
    // ⚠️ 为什么要一起把**清单**传空：`## 技能` 那一节开头有一句「先用 `skill` 工具加载它」，
    // 它是**跟清单同条件**出现的（空清单 → 整节省略，C8 T3 定的），属于清单自己的一部分，
    // 不是"手写规矩"（理由写在 `lib/skill` 那句旁边）。传空清单把它排除在外。
    const prompt = buildSystemPrompt(FIXED, "");
    const toolNames = createToolRegistry(
      { workspaceRoot: process.cwd(), skillsRoot: process.cwd() },
      {},
    )
      .definitions()
      .map((def) => def.name);

    for (const name of toolNames) {
      expect(
        prompt,
        `提示词里手写提到了工具 ${name} —— 这句该住在这个工具自己的文件里`,
      ).not.toContain(name);
    }
  });
});

// ------------------------------------------------------------
// 决策边界（2026-09-14 加，出处：codex 的 web.run 工具描述）
// ------------------------------------------------------------
// ⭐ 为什么加这段：昨天修的是「模型不知道今天几号」——解决的是"哪一年"。
// 但模型那次是**知道该搜**（它确实调了 web_search），却**用自己的记忆填了年份**。
// codex 的 Decision boundary 解决的正是另一半：「**该不该信自己的记忆**」。
//   "consider whether it is temporally stable; i.e. whether there's even a
//    small (>10%) chance it has changed. If it is unstable, you must verify."
// 出处：codex-rs/ext/web-search/web_run_description.md

describe("buildSystemPrompt —— 什么时候必须联网", () => {
  it("有「信息会随时间变」的判据 + 那条 10% 阈值", () => {
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toMatch(/随时间|会变|过期/);
    expect(prompt).toContain("10%");
  });

  it("列出必须联网的场景（新闻 / 价格 / 法律 / 人物）", () => {
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toMatch(/新闻/);
    expect(prompt).toMatch(/价格/);
    expect(prompt).toMatch(/法律|规章|标准/);
    expect(prompt).toMatch(/CEO|总统/);
  });

  it("有「拿不准就倾向于查」的兜底（codex 反复强调的那句）", () => {
    expect(buildSystemPrompt(FIXED)).toMatch(/拿不准[\s\S]*倾向/);
  });

  it("⭐ 把相对时间和「当前时间」挂钩（上一个 bug 的直接防线）", () => {
    // 只有「现在是 2026-09-14」还不够——必须同时说"别用训练数据里的年份"，
    // 否则模型会把两者当成互不相关的两段信息
    expect(buildSystemPrompt(FIXED)).toMatch(/训练数据里的年份|不要用.*训练数据/);
  });
});

describe("buildSystemPrompt —— 引用规范", () => {
  it("要求链接贴近支撑它的那句话，不许全堆在末尾", () => {
    expect(buildSystemPrompt(FIXED)).toMatch(/附近/);
  });

  it("不许只贴裸 URL", () => {
    expect(buildSystemPrompt(FIXED)).toMatch(/裸 ?URL/);
  });

  it("不要大段逐字照搬", () => {
    expect(buildSystemPrompt(FIXED)).toMatch(/逐字|照搬|概括/);
  });
});

// ------------------------------------------------------------
// 「抄路线不抄机器」的可执行形式
// ------------------------------------------------------------

describe("buildSystemPrompt —— 不搬 codex 的产品机制", () => {
  it("不出现 codex/OpenAI 侧专有的东西", () => {
    // ⭐ 这条断言的作用不是"防手滑"，是**把口径钉死**：
    // 我们抄的是 codex 的**决策边界思路**，不抄它的产品机制——
    //   `ref_id` / `turn0xxx` 是 OpenAI 服务端的引用句柄
    //   `[wordlim N]` 是它服务端按来源计的引用字数上限
    //   reddit 版权例外、screenshot/finance/weather 命令，都是它的服务端才有的
    // 没有这条，"以后顺手把整段 description 粘过来"就没人拦得住——
    // 而那种抄法正是「抄机器」那一档，删都难删（看起来更专业）。
    const prompt = buildSystemPrompt(FIXED);
    for (const codexOnly of [
      "wordlim",
      "ref_id",
      "turn0",
      "reddit",
      "screenshot",
      "finance",
    ]) {
      expect(prompt).not.toContain(codexOnly);
    }
  });
});

// ------------------------------------------------------------
// 技能清单（2026-09-16 C8 T3 加）
// ------------------------------------------------------------
// 清单由**调用方**算好传进来（`buildSkillCatalog(loadSkills(root).skills)`）——
// 这一层保持纯函数：给什么渲染什么，不碰文件系统。为什么这么切：
//   ① 好测（固定字符串进、固定字符串出，不用造技能目录）
//   ② "技能根在哪"由调用方决定 —— 将来按工作区变，这里一行都不用动
// ⚠️ 空清单必须**整节省略**：留一个空标题，模型会以为"有技能但没列出来"，
// 正好是最坏的那种失败（它会去猜名字）。

describe("buildSystemPrompt —— 技能清单", () => {
  it("清单作为独立一节进提示词（模型据此知道有哪些技能）", () => {
    const catalog = "以下技能可用。开始任务前先用 `skill` 工具加载。\n\n- `code-review`: 两轴评审";
    const prompt = buildSystemPrompt(FIXED, catalog);

    expect(prompt).toContain("## 技能");
    expect(prompt).toContain("- `code-review`: 两轴评审");
    expect(prompt).toContain("`skill` 工具");
  });

  it("⭐ 空清单（或纯空白）→ 这一节整节不出现，不留空标题", () => {
    // 不传 = 老调用点的行为不变；传空串 = 这台机器没装技能
    expect(buildSystemPrompt(FIXED)).not.toContain("## 技能");
    expect(buildSystemPrompt(FIXED, "")).not.toContain("## 技能");
    expect(buildSystemPrompt(FIXED, "   \n  ")).not.toContain("## 技能");
  });

  it("清单原文逐字进提示词（不转义、不截断）", () => {
    // 清单是我们自己生成的 markdown；顺手"转义一下"会把反引号包着的技能名弄坏，
    // 而技能名正是模型要原样回传的东西（`skill({"name":"code-review"})`）。
    const catalog = '以下技能可用。\n\n- `code-review`: a & b <c> "d" 的评审流程';
    expect(buildSystemPrompt(FIXED, catalog)).toContain(catalog);
  });

  it("清单变了 → 提示词跟着变（说明它真是参数，不是常量）", () => {
    expect(buildSystemPrompt(FIXED, "- `a`: A")).not.toBe(
      buildSystemPrompt(FIXED, "- `b`: B"),
    );
  });
});
