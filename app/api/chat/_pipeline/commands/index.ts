// ============================================================
// _pipeline/commands.ts —— C13 命令注册表组装（_pipeline/index.ts 注释预留落点）
// ============================================================
// 产品层知道"有哪些产品命令"：命令清单 = COMMAND_FACTORIES 工厂数组
// （单一事实源）。查询与执行共用同一份清单，但"注册"只发生在执行时：
//   - commandDescriptors()：查询（GET /api/chat/commands）——从工厂拿
//     元数据，不建注册表（review 吐槽：查个列表为什么要注册命令？）
//   - createCommands()：执行（POST /api/chat/command）——才实例化注册
// 未来加命令 = 数组里加一个工厂（或拆文件），查询/执行同时可见。
// ============================================================

import {
  createCommandRegistry,
  toDescriptor,
  sortByName,
  createCompactCommand,
  createClearCommand,
  createExportCommand,
} from "@/lib";
import type { CommandDescriptor, CommandRegistry, SlashCommand } from "@/lib";

/** 命令工厂清单（单一事实源）：查询与执行都从这里来 */
export const COMMAND_FACTORIES: readonly (() => SlashCommand)[] = [
  createCompactCommand,
  createClearCommand,
  createExportCommand,
];

/** 查询用：命令列表元数据（不注册、不建注册表，只从工厂取定义） */
export function commandDescriptors(): CommandDescriptor[] {
  return sortByName(COMMAND_FACTORIES.map((factory) => toDescriptor(factory())));
}

/** 执行用：组装命令注册表（每请求调用，同 createPipelineTools 先例） */
export function createCommands(): CommandRegistry {
  const registry = createCommandRegistry();
  for (const factory of COMMAND_FACTORIES) {
    registry.register(factory());
  }
  return registry;
}
