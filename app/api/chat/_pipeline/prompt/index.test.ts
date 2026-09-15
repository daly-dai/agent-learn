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

  it("原有内容一个字不少（角色 / 工具清单 / 输出要求）", () => {
    // 搬迁 + 加内容时最容易顺手漏掉原来的段落——原文没有单测，
    // 这一条就是它的兜底
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toContain("Teaching Agent");
    expect(prompt).toContain("## 工具使用原则");
    expect(prompt).toContain("## 输出要求");
    expect(prompt).toContain("始终用中文回答");
    expect(prompt).toContain("todo_write");
    expect(prompt).toContain("ask_user_question");
  });

  it("两个 web 工具的用法都在（A5 第 ⑦ 步加的）", () => {
    const prompt = buildSystemPrompt(FIXED);
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("web_fetch");
  });

  it("时间不同 → 提示词不同（证明它是函数不是常量）", () => {
    expect(buildSystemPrompt(new Date(2026, 0, 1))).not.toBe(
      buildSystemPrompt(new Date(2027, 0, 1)),
    );
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
