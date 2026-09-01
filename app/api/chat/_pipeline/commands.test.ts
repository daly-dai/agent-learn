// ============================================================
// _pipeline/commands.test.ts —— 命令清单组装（C13）
// ============================================================
// 钉住"当前内置命令有哪些"（避免误删/漏注册）+ 查询/执行共用同一份
// COMMAND_FACTORIES：commandDescriptors（查询零注册）与 createCommands
// （执行注册）看到的命令集合必须一致。
// ============================================================

import { describe, expect, it } from "vitest";
import { commandDescriptors, createCommands, COMMAND_FACTORIES } from "./commands";

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
    expect(descriptors.map((c) => c.name)).toEqual(["clear", "compact", "export"]);
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
