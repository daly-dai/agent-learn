// ============================================================
// createToolRegistry —— 工具组装（模型看到的工具清单）
// ============================================================
// 这个文件是 2026-09-14 A5 收尾时补的：在那之前 `createToolRegistry`
// **一条测试都没有**——每个工具自己有 index.test.ts，但"它们有没有被
// 真的注册进去"没人验证过。A5 第 ⑦ 步往这里加两个 web 工具时才发现。
//
// 为什么这个缺口值得单独补：注册失败是**静默**的。
// `ToolRegistry.register` 往 Map 里塞，重名会**悄悄覆盖**前一个；
// 少注册一个工具，模型那边只是"没这个工具可用"，不报错、不告警，
// 而且单测全绿。所以这里断言的是"**模型的工具清单**"，不是工厂函数。
// ============================================================

import { describe, expect, it } from "vitest";
import type { ToolRegistry } from ".";
import { createToolRegistry } from ".";

/** 组装一次注册表。hooks 是业务回调（todo/ask-user 用），这层用不到，给空对象 */
function registry(): ToolRegistry {
  // 环境对象（C8 ToolContext）：这层只关心"工具清单"，两个根随便给一个目录
  return createToolRegistry(
    { workspaceRoot: process.cwd(), skillsRoots: [process.cwd()] },
    {},
  );
}

describe("createToolRegistry —— 组装出来的工具清单", () => {
  it("两个 web 工具都真的在里面（A5 第 ⑦ 步的注册）", () => {
    const names = registry()
      .definitions()
      .map((def) => def.name);
    expect(names).toContain("web_fetch");
    expect(names).toContain("web_search");
  });

  it("skill 工具真的在里面（C8 T2 的注册）", () => {
    const names = registry()
      .definitions()
      .map((def) => def.name);
    expect(names).toContain("skill");
  });

  it("工具名**不重复**（重名会被 Map 静默覆盖，少一个工具也不报错）", () => {
    const names = registry()
      .definitions()
      .map((def) => def.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("每个工具都有模型/API 能接受的说明书", () => {
    // 这三条是发给模型的 function 定义的最低要求：
    // 名字要能当函数名、描述不能为空、参数必须是 object 根
    for (const def of registry().definitions()) {
      expect(def.name).toMatch(/^[a-z][a-z_]*$/);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.parameters).toMatchObject({ type: "object" });
    }
  });

  it("web_fetch 必填 url；web_search 必填 queries", () => {
    // 参数名写错（比如 queries → query）不会让任何东西报错，
    // 只会让模型每次调用都失败——所以在这里钉住
    const byName = new Map(
      registry()
        .definitions()
        .map((def) => [def.name, def]),
    );
    expect(byName.get("web_fetch")?.parameters).toMatchObject({
      required: ["url"],
    });
    expect(byName.get("web_search")?.parameters).toMatchObject({
      required: ["queries"],
    });
  });

  it("未知工具名 → 抛错，不是静默返回空结果", async () => {
    await expect(registry().execute("没有这个工具", {})).rejects.toThrow(
      /not found/i,
    );
  });
});

// ------------------------------------------------------------
// 工具自己的「专属规矩」投稿（C34，2026-09-16 定）
// ------------------------------------------------------------
// 归属规则：规矩的**文本住在各工具文件里**（`RegisteredTool.guidelines`），不在提示词文件里。
// 为什么它是强关联、而不是"换个写法"：改工具的人就看得见它；工具删了它跟着消失。
// 这条测试守的是那种**没有任何东西会红**的失效：上游工具提到下游工具（"想知道完整内容
// 就用 `web_fetch` 抓那个 URL"），下游改名 / 删除之后，那句话变成一条悬空指令。

describe("工具规矩投稿（guidelines）", () => {
  /** 投稿正文里出现的反引号 token —— 约定：提到工具 / 参数一律用反引号包起来 */
  function backtickedTokens(text: string): string[] {
    return (text.match(/`[^`]+`/g) ?? [])
      .map((token) => token.slice(1, -1))
      .filter((word) => /^[a-z][a-z_]*$/.test(word));
  }

  it("⭐ 投稿里提到的工具名必须真的注册了（防下游改名/删除后留下悬空引用）", () => {
    const reg = registry();
    const toolNames = new Set(reg.definitions().map((def) => def.name));
    // schema 里出现过的词也算合法 —— 规矩里会写 `completed` 这类**参数值 / 参数名**，
    // 它们不是工具名。词表从 schema 现算，不手写（手写就会漂）。
    const schemaWords = new Set(
      JSON.stringify(reg.definitions().map((def) => def.parameters)).match(
        /[a-z][a-z_]*/g,
      ) ?? [],
    );

    for (const { name, text } of reg.guidelines()) {
      for (const word of backtickedTokens(text)) {
        expect(
          toolNames.has(word) || schemaWords.has(word),
          `${name} 的规矩里提到 \`${word}\`，但它既不是注册的工具、也不在任何工具的 schema 里`,
        ).toBe(true);
      }
    }
  });

  it("收集出来的规矩带着工具名（渲染成 `- <工具名>：<规矩>`）", () => {
    for (const { name, text } of registry().guidelines()) {
      expect(name).toMatch(/^[a-z][a-z_]*$/);
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it("搬进工具文件的那几条规矩还在（C34 迁移不许静默丢内容）", () => {
    // 这几条原来是手写在系统提示词里的，2026-09-16 按归属规则搬进各自的工具文件。
    // 搬家最容易出的错就是**搬丢了**，而且提示词那边看起来一样正常（少一条规矩没人报错）。
    // 所以这里按"谁家该有什么"逐个断言 —— 这就是原提示词测试里那条
    // 「政策条款一条不少」在新归属下的等价形式。
    const rulesByTool = new Map<string, string>();
    for (const { name, text } of registry().guidelines()) {
      rulesByTool.set(name, (rulesByTool.get(name) ?? "") + text);
    }

    expect(rulesByTool.get("web_search")).toMatch(/一次模型调用的钱/); // 成本提醒
    expect(rulesByTool.get("web_search")).toMatch(/`web_fetch`/); // 跨调用管道（挂上游）
    expect(rulesByTool.get("web_fetch")).toMatch(/抓回来/); // 什么时候用它（重验时补搬的）
    expect(rulesByTool.get("todo_write")).toMatch(/全部完成时必须再调用一次/); // 收尾
    expect(rulesByTool.get("ask_user_question")).toMatch(/跳过/); // 被跳过的契约
  });

  it("「外部内容不可信」住在 description 里（提示词里那份重复被删了）", () => {
    // C34 删掉的两处"重复"之一。它没消失，只是**只留一个家**：工具的 description
    // （随请求的 `tools` 字段发出去，模型挑工具时就会读到）。
    const byName = new Map(
      registry()
        .definitions()
        .map((def) => [def.name, def]),
    );
    expect(byName.get("web_search")?.description).toMatch(/外部不可信数据/);
    expect(byName.get("web_fetch")?.description).toMatch(/外部不可信数据/);
  });

  it("⭐ definitions() 只发三个字段 —— 投稿**不上 wire**", () => {
    // 这是"规矩文本只有一份"的机检形式：`guidelines` 只经 `guidelines()` 进**系统提示词**，
    // 绝不混进随请求发的 `tools` 定义。混进去的后果是**同一句话在请求里出现两次**
    // （一次在 tools、一次在 system prompt）—— 正是 C34 要消灭的那种重复。
    // 顺带兜住"往 ToolDefinition 上加了字段、忘了它会被一起发出去"这类改动。
    for (const def of registry().definitions()) {
      expect(Object.keys(def).sort()).toEqual([
        "description",
        "name",
        "parameters",
      ]);
    }
  });
});
