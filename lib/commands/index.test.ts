// ============================================================
// lib/commands/index.test.ts —— 命令注册表（C13 seam）
// ============================================================
// 对齐 DSH CommandRuntime 的注册校验 fail-loud + execute 未知命令
// 返回 null（不进 handler、调用方决定 UI）+ list 按名排序；
// 吸收 codex 的 aliases（主名进列表、别名只认不显）。
// 测试只碰骨架：handler 用假实现，不碰 store/model 真实实现。
// ============================================================

import { describe, expect, it } from "vitest";
import type { JsonlSessionStore } from "@/lib/session";
import type { TeachingModel } from "@/lib/model";
import { createCommandRegistry, sortByName, toDescriptor } from "./index";
import type { CommandApi, SlashCommand } from "./types";

/** 假 api：骨架测试不碰 store/model 的真实实现 */
function fakeApi(): CommandApi {
  return {
    store: {} as unknown as JsonlSessionStore,
    model: {} as unknown as TeachingModel,
  };
}

function command(overrides: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: "compact",
    description: "Compact history",
    source: "builtin",
    handler: () => ({ kind: "success" as const, text: "done" }),
    ...overrides,
  };
}

describe("register —— 注册校验 fail-loud（DSH normalizeDefinition）", () => {
  it("合法定义 → 注册成功，list 可见", () => {
    const registry = createCommandRegistry();
    registry.register(command());
    expect(registry.list().map((c) => c.name)).toEqual(["compact"]);
  });

  it("name 大写开头 → throw（必须 [a-z] 开头）", () => {
    const registry = createCommandRegistry();
    expect(() => registry.register(command({ name: "Compact" }))).toThrow(
      /command name/,
    );
  });

  it("description 空 → throw", () => {
    const registry = createCommandRegistry();
    expect(() => registry.register(command({ description: "  " }))).toThrow(
      /description/,
    );
  });

  it("handler 非函数 → throw", () => {
    const registry = createCommandRegistry();
    expect(() =>
      registry.register(command({ handler: "not a fn" as unknown as SlashCommand["handler"] })),
    ).toThrow(/handler/);
  });

  it("source 非法值 → throw", () => {
    const registry = createCommandRegistry();
    expect(() =>
      registry.register(command({ source: "plugin" as unknown as SlashCommand["source"] })),
    ).toThrow(/source/);
  });

  it("重复 name → throw", () => {
    const registry = createCommandRegistry();
    registry.register(command());
    expect(() => registry.register(command())).toThrow(/already registered/);
  });

  it("别名与已有 name 冲突 → throw", () => {
    const registry = createCommandRegistry();
    registry.register(command({ name: "model" }));
    expect(() => registry.register(command({ aliases: ["model"] }))).toThrow(
      /already registered/,
    );
  });
});

describe("list —— 发现 UI 用的元数据视图", () => {
  it("按名排序（DSH list 同款）", () => {
    const registry = createCommandRegistry();
    registry.register(command({ name: "zeta" }));
    registry.register(command({ name: "alpha" }));
    registry.register(command({ name: "middle" }));
    expect(registry.list().map((c) => c.name)).toEqual([
      "alpha",
      "middle",
      "zeta",
    ]);
  });

  it("不暴露 handler（前端安全的 descriptor 视图）", () => {
    const registry = createCommandRegistry();
    registry.register(command());
    expect("handler" in registry.list()[0]).toBe(false);
  });

  it("available 返回 false → 过滤（codex flags 门控）", () => {
    const registry = createCommandRegistry();
    registry.register(command({ name: "visible" }));
    registry.register(
      command({ name: "hidden", available: () => false }),
    );
    expect(registry.list(fakeApi()).map((c) => c.name)).toEqual(["visible"]);
  });

  it("别名不进列表（codex ALIAS_COMMANDS：主名进、别名只认不显）", () => {
    const registry = createCommandRegistry();
    registry.register(command({ name: "quit", aliases: ["exit"] }));
    expect(registry.list().map((c) => c.name)).toEqual(["quit"]);
  });
});

describe("execute —— 分发（DSH execute 语义）", () => {
  it("已知命令 → 调 handler，rawInput 是 trim 后的参数", async () => {
    const registry = createCommandRegistry();
    let seen: string | undefined;
    registry.register(
      command({
        handler: (inv) => {
          seen = inv.rawInput;
          return { kind: "success", text: "ok" };
        },
      }),
    );
    const result = await registry.execute("/compact 参数", fakeApi(), new AbortController().signal);
    expect(result).toEqual({ kind: "success", text: "ok" });
    expect(seen).toBe("参数");
  });

  it("未知命令 → null（不进 handler）", async () => {
    const registry = createCommandRegistry();
    registry.register(command());
    let called = false;
    registry.register(
      command({
        name: "watcher",
        handler: () => {
          called = true;
          return { kind: "success" };
        },
      }),
    );
    const result = await registry.execute("/watcher-x", fakeApi(), new AbortController().signal);
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("非命令形态（无斜杠）→ null", async () => {
    const registry = createCommandRegistry();
    registry.register(command());
    expect(await registry.execute("compact", fakeApi(), new AbortController().signal)).toBeNull();
  });

  it("别名命中（别名只认不显）", async () => {
    const registry = createCommandRegistry();
    let called = false;
    registry.register(
      command({
        name: "quit",
        aliases: ["exit"],
        handler: () => {
          called = true;
          return { kind: "success" };
        },
      }),
    );
    expect(await registry.execute("/exit", fakeApi(), new AbortController().signal)).toEqual({
      kind: "success",
    });
    expect(called).toBe(true);
  });

  it("handler 返回 error result → 原样透传（业务错误不吞）", async () => {
    const registry = createCommandRegistry();
    registry.register(
      command({ handler: () => ({ kind: "error", text: "no args allowed" }) }),
    );
    expect(await registry.execute("/compact", fakeApi(), new AbortController().signal)).toEqual({
      kind: "error",
      text: "no args allowed",
    });
  });

  it("handler 是 async → await 结果", async () => {
    const registry = createCommandRegistry();
    registry.register(
      command({
        handler: async () => ({ kind: "success", text: "async done" }),
      }),
    );
    expect(await registry.execute("/compact", fakeApi(), new AbortController().signal)).toEqual({
      kind: "success",
      text: "async done",
    });
  });

  it("handler 抛错 → 往上抛（命令实现 bug，由 API 层转 500）", async () => {
    const registry = createCommandRegistry();
    registry.register(
      command({
        handler: () => {
          throw new Error("boom");
        },
      }),
    );
    await expect(
      registry.execute("/compact", fakeApi(), new AbortController().signal),
    ).rejects.toThrow("boom");
  });
});

describe("names —— 提交验证用（validateSubmission 的注册表侧）", () => {
  it("含主名与别名", () => {
    const registry = createCommandRegistry();
    registry.register(command());
    registry.register(command({ name: "quit", aliases: ["exit"] }));
    const names = registry.names();
    expect(names.has("compact")).toBe(true);
    expect(names.has("quit")).toBe(true);
    expect(names.has("exit")).toBe(true);
  });
});

describe("toDescriptor / sortByName —— 查询侧元数据纯函数", () => {
  it("toDescriptor 去掉 handler/available（前端安全视图）", () => {
    const spec = command({ name: "compact", aliases: ["c"] });
    const descriptor = toDescriptor(spec);
    expect(descriptor.name).toBe("compact");
    expect(descriptor.aliases).toEqual(["c"]);
    expect("handler" in descriptor).toBe(false);
    expect("available" in descriptor).toBe(false);
  });

  it("sortByName 按名排序（查询与 list 共用）", () => {
    const specs = [command({ name: "zeta" }), command({ name: "alpha" })];
    const sorted = sortByName(specs.map((s) => toDescriptor(s)));
    expect(sorted.map((d) => d.name)).toEqual(["alpha", "zeta"]);
  });
});
