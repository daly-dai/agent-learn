// ============================================================
// lib/commands/index.ts —— 斜杠命令注册表（C13 seam）
// ============================================================
// 抄谁、为什么抄：
//   - 注册校验 fail-loud（name 正则/description 非空/handler 函数）
//     ← DSH normalizeDefinition：坏定义到不了 UI 协议层
//   - execute 未知命令返回 null（不记日志不进 handler，调用方决定 UI）
//     ← DSH execute：语法错/未知名返回 undefined；同 codex 硬边界
//   - list 按名排序 + 不暴露 handler（前端安全的 descriptor 视图）
//     ← DSH list()：发现 UI 用；前端只拿元数据，拿不到执行函数
//   - aliases：主名进列表、别名只认不显 ← codex ALIAS_COMMANDS
//   - available 门控 ← codex BuiltinCommandFlags：功能开关上线时按
//     条件隐藏命令，不用重构（第一批默认全可用）
//   - source: "builtin" | "skill" ← pi source 分类：命令面板 = 统一
//     功能入口，未来 C8 技能列表以 source: "skill" 进面板
//
// 注册表是"每请求组装"（同 _pipeline/tools.ts 先例）：handler 闭包
// 捕获当次请求的 store/model，注册表本身不持有业务单例。
//
// 类型定义在 ./types.ts（本文件只留逻辑，类型与逻辑分离）。
// ============================================================

import { parseSlashName } from "./parse";
import type {
  CommandApi,
  CommandDescriptor,
  CommandResult,
  CommandSource,
  SlashCommand,
} from "./types";

// 类型 re-export：外部（app/ 与 lib/index.ts 门面）从 @/lib/commands 拿类型，
// 保持单一入口不变（拆 types.ts 后引用面零改动）
export type {
  CommandApi,
  CommandDescriptor,
  CommandInvocation,
  CommandResult,
  CommandSource,
  SlashCommand,
} from "./types";

// 命令名正则（DSH COMMAND_NAME 同款）
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;
const SOURCES: readonly CommandSource[] = ["builtin", "skill"];

/** 校验并冻结一条注册定义（fail-loud：坏定义到不了 UI 协议层） */
function normalize(spec: SlashCommand): SlashCommand {
  if (!COMMAND_NAME.test(spec.name)) {
    throw new TypeError(
      `command name "${spec.name}" must match /^[a-z][a-z0-9_-]*$/`,
    );
  }
  if (
    typeof spec.description !== "string" ||
    spec.description.trim().length === 0
  ) {
    throw new TypeError(
      `command "${spec.name}" description must be a non-empty string`,
    );
  }
  if (typeof spec.handler !== "function") {
    throw new TypeError(`command "${spec.name}" handler must be a function`);
  }
  if (!SOURCES.includes(spec.source)) {
    throw new TypeError(
      `command "${spec.name}" source must be one of ${SOURCES.join("|")}`,
    );
  }
  const aliases = spec.aliases ?? [];
  for (const alias of aliases) {
    if (!COMMAND_NAME.test(alias)) {
      throw new TypeError(
        `command "${spec.name}" alias "${alias}" must match /^[a-z][a-z0-9_-]*$/`,
      );
    }
  }
  return Object.freeze({
    ...spec,
    aliases: Object.freeze([...aliases]),
  });
}

/**
 * 命令注册表（每请求组装，同 _pipeline/tools.ts 先例）。
 * 单会话架构，无 DSH 的 agent 维度与作用域层。
 */
export class CommandRegistry {
  private readonly byName = new Map<string, SlashCommand>();

  /** 注册一条命令（校验 fail-loud；重名/别名冲突直接 throw） */
  register(spec: SlashCommand): void {
    const normalized = normalize(spec);

    for (const key of [normalized.name, ...(normalized.aliases ?? [])]) {
      if (this.byName.has(key)) {
        throw new Error(
          `command "${key}" is already registered (C13 注册表重名)`,
        );
      }
    }

    this.byName.set(normalized.name, normalized);

    for (const alias of normalized.aliases ?? []) {
      this.byName.set(alias, normalized);
    }
  }

  /** 发现 UI 用的元数据列表（按名排序；不暴露 handler）。 */
  list(api?: CommandApi): CommandDescriptor[] {
    const seen = new Set<string>(); // 别名指向同一对象，按 name 去重
    const descriptors: CommandDescriptor[] = [];

    for (const command of this.byName.values()) {
      if (seen.has(command.name)) continue;
      seen.add(command.name);
      if (
        api !== undefined &&
        command.available !== undefined &&
        !command.available(api)
      ) {
        continue;
      }

      descriptors.push(toDescriptor(command));
    }

    return sortByName(descriptors);
  }

  /** 已注册名字集合（含别名）——validateSubmission 的注册表侧 */
  names(): ReadonlySet<string> {
    return new Set(this.byName.keys());
  }

  /**
   * 解析并执行一条命令（不走模型）。
   * 语法错/未知命令 → null（调用方决定 UI；同 DSH execute）。
   * handler 抛错 → 往上抛（命令实现 bug，由 API 层转 500）。
   */
  async execute(
    line: string,
    api: CommandApi,
    signal: AbortSignal,
  ): Promise<CommandResult | null> {
    const parsed = parseSlashName(line);

    if (parsed === null) return null;

    const command = this.byName.get(parsed.name);

    if (command === undefined) return null;

    return await command.handler({
      rawInput: parsed.rest,
      signal,
      api,
    });
  }
}

/** 创建空注册表（命令由 app 层组装时注册） */
export function createCommandRegistry(): CommandRegistry {
  return new CommandRegistry();
}

/**
 * 命令定义 → 前端安全的元数据视图（去掉 handler/available）。
 * list() 与 _pipeline/commands 的 commandDescriptors() 共用——
 * 查询命令列表不需要注册表实例，从工厂拿元数据即可。
 */
export function toDescriptor(spec: SlashCommand): CommandDescriptor {
  const { name, description, source, aliases, supportsInlineArgs, inputHint } = spec;
  return { name, description, source, aliases, supportsInlineArgs, inputHint };
}

/** 按名排序（list 与 commandDescriptors 共用，保持发现 UI 顺序稳定） */
export function sortByName(
  descriptors: CommandDescriptor[],
): CommandDescriptor[] {
  return descriptors.sort((a, b) => (a.name < b.name ? -1 : 1));
}
