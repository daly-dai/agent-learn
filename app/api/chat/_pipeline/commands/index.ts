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
  loadSkills,
  createCompactCommand,
  createClearCommand,
  createExportCommand,
} from "@/lib";
import type {
  CommandDescriptor,
  CommandRegistry,
  Skill,
  SkillDiagnostic,
  SlashCommand,
} from "@/lib";

/** 命令工厂清单（单一事实源）：查询与执行都从这里来 */
export const COMMAND_FACTORIES: readonly (() => SlashCommand)[] = [
  createCompactCommand,
  createClearCommand,
  createExportCommand,
];

/** 查询用：命令列表元数据（不注册、不建注册表，只从工厂取定义） */
export function commandDescriptors(): CommandDescriptor[] {
  return sortByName(
    COMMAND_FACTORIES.map((factory) => toDescriptor(factory())),
  );
}

/** 面板要显示的一整套入口 */
export type CommandCatalog = {
  /** 内置命令在前、技能在后（各自按名）—— 面板"上半 / 下半"的物理依据 */
  commands: CommandDescriptor[];
  /** 技能侧的诊断（加载失败 + 与内置重名被顶掉）。**必须看得见**，不许静默 */
  diagnostics: SkillDiagnostic[];
};

/**
 * 查询用：命令清单 = **内置命令 + 技能**（C8 T5）。
 *
 * 技能以 `source:"skill"` 混进同一份清单 —— **不需要新接口**：
 * `CommandDescriptor.source` 这个字段 C13 时就留好了（当时注释写着"未来 skill 进面板"）。
 * 前端据此**分组**（上半命令 / 下半技能）并据此**分流**：选技能 = 把 `/名字 ` 插进
 * 输入框接着打字（走聊天），选命令 = 直接执行。
 *
 * ⭐ **重名规则（R3-1 定）：内置优先 + 可见诊断**。判据用**名字 + 别名**两张表，
 * 因为 `validateSubmission` 与 `registry.execute` 走的都是那张含别名的表 ——
 * 只比主名的话，一个撞上**别名**的技能会进面板、选中后被路由到内置命令（**静默的错**）。
 * ⚠️ 今天三个内置命令都没写别名，所以"别名那一半"暂时**没有用例守着**；留着它是因为
 * `SlashCommand.aliases` 是既有能力（codex ALIAS_COMMANDS），而漏了的后果是静默的。
 */
export function commandCatalog(skillsRoot: string): CommandCatalog {
  const commands = commandDescriptors();
  const { skills, diagnostics } = loadSkills(skillsRoot);

  const taken = new Set(
    commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
  );

  const skillCommands: CommandDescriptor[] = [];
  for (const skill of skills) {
    if (taken.has(skill.name)) {
      diagnostics.push({
        name: skill.name,
        dir: skill.baseDir,
        reason:
          "与内置命令（或它的别名）重名 —— 内置优先，这个技能不进面板" +
          "（仍可用 `skill` 工具加载，或直接打 `/名字`）",
      });
      continue;
    }
    skillCommands.push(toSkillDescriptor(skill));
  }

  return {
    commands: [...commands, ...sortByName(skillCommands)],
    diagnostics,
  };
}

/**
 * 技能 → 面板条目。
 *
 * `supportsInlineArgs: true`：技能名后面**必须**跟着你的要求才有意义，所以选中它
 * 只把 `/名字 ` 插进输入框、**不立刻执行**（与内置命令相反）。前端就靠这个字段分流。
 */
function toSkillDescriptor(skill: Skill): CommandDescriptor {
  return {
    name: skill.name,
    description: skill.description,
    source: "skill",
    supportsInlineArgs: true,
  };
}

/** 执行用：组装命令注册表（每请求调用，同 createPipelineTools 先例） */
export function createCommands(): CommandRegistry {
  const registry = createCommandRegistry();
  for (const factory of COMMAND_FACTORIES) {
    registry.register(factory());
  }
  return registry;
}
