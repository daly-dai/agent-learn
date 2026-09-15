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
import { createToolRegistry, ToolRegistry } from ".";

/** 组装一次注册表。hooks 是业务回调（todo/ask-user 用），这层用不到，给空对象 */
function registry(): ToolRegistry {
  return createToolRegistry(process.cwd(), {});
}

describe("createToolRegistry —— 组装出来的工具清单", () => {
  it("两个 web 工具都真的在里面（A5 第 ⑦ 步的注册）", () => {
    const names = registry().definitions().map((def) => def.name);
    expect(names).toContain("web_fetch");
    expect(names).toContain("web_search");
  });

  it("工具名**不重复**（重名会被 Map 静默覆盖，少一个工具也不报错）", () => {
    const names = registry().definitions().map((def) => def.name);
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
