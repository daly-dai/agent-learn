// ============================================================
// 工具系统 —— Agent 的"手脚"（组装层）
// ============================================================
// 每个工具一个文件（lib/tools/ 下的工厂函数），这里负责：
//   1. ToolRegistry：注册表（说明书 + 执行函数）
//   2. createToolRegistry：把各工具工厂组装成一个注册表
//
// 对外接口不变：route.ts 仍 `import { createToolRegistry } from "@/lib/tools"`，
// 目录 + index 解析会自动指向本文件。
// ============================================================

import type { ToolDefinition, ToolResult } from "../types";
import type { RegisteredTool, ToolExecutorOptions, ToolHooks } from "./types";
import { createListTool } from "./list";
import { createReadTool } from "./read";
import { createWriteNoteTool } from "./write-note";
import { createWriteTool } from "./write";
import { createEditTool } from "./edit";
import { createDeleteTool } from "./delete";
import { createGrepTool } from "./grep";
import { createFindTool } from "./find";
import { createBashTool } from "./bash";
import { createTodoTool } from "./todo";
import { createAskUserTool } from "./ask-user";
import { createWebFetchTool } from "./web-fetch";
import { createWebSearchTool } from "./web-search";
import { createSkillTool } from "./skill";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(
      ({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      }),
    );
  }

  /**
   * 收集所有工具的「专属规矩」，供系统提示词渲染（C34，2026-09-16）。
   *
   * ⚠️ **规矩文本住在各工具文件里，不住提示词文件里** —— 见 `RegisteredTool.guidelines`。
   * 这里只做"收集"，不做"内容判断"：哪条规矩该不该出现，由工具自己负责。
   *
   * 注意这里**顺带给了工具名**：渲染成 `- <工具名>：<规矩>`，让模型知道这条规矩管谁。
   * （pi 渲染成不带名字的裸条目 —— 我们保留点名，因为提示词里本来就是这个形状。）
   */
  guidelines(): Array<{ name: string; text: string }> {
    const collected: Array<{ name: string; text: string }> = [];

    for (const tool of this.tools.values()) {
      for (const text of tool.guidelines ?? []) {
        collected.push({ name: tool.name, text });
      }
    }
    return collected;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    options?: ToolExecutorOptions, // signal（取消）+ onChunk（bash 流式）
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(args, options);
  }
}

/**
 * 工具层需要的「**这次请求的环境**」。
 *
 * ⚠️ **只放「每次请求可能不同」的值**：
 *   - 会不同的（工作区根、技能根、将来的"当前项目技能根"…）→ **必须由请求装配处传**，
 *     工具不能自己去读静态 config（多工作区 / 多技能根那天，静态值表达不了"这一次"）
 *   - 不会不同的（模型名、输出上限、超时…）→ 进 `config`，谁用谁读，**不进这里**
 *   （同源判据见 `lib/config/index.ts`：provider 段 = "跟谁说 / 在哪"，web 段 = "我们允许它做多少"）
 *
 * ⚠️ **绑定时机的前提（2026-09-16 与用户确认，别当它是永久的）**：这些值在**注册表组装时**
 * 被工厂闭包焊进工具 ⇒ **依赖"注册表每请求重建"**（`app/api/chat/_pipeline/tools.ts` 在
 * `runPipeline` 里每请求调一次；最早 route.ts 顶部那个模块级单例正是为此拆掉的）。
 * **若将来注册表变成会话级 / 进程级长驻**，这些值必须改走 `execute` 的**运行时参数**
 * （pi 的长驻形态就是这么做的：`execute(toolCallId, params, onUpdate, toolContext, …)`）
 * —— ⚠️ **那会碰红线文件 `lib/agent/index.ts`**，届时按红线流程走（精读 pi → 对比 → 展示 → 用户拍板）。
 * 见 `PLAN.md` 排期表的「条件触发」表。
 */
export type ToolContext = {
  /** 文件工具的围栏根：所有文件工具都关在它里面（`resolveInsideWorkspace`） */
  workspaceRoot: string;
  /** 技能根：在**工作区之外**，只有 `skill` 工具读它（见 `lib/tools/skill/index.ts` 头部） */
  skillsRoot: string;
};

/**
 * 创建预装文件系统工具的 ToolRegistry（每请求组装，贴 pi create-harness）。
 * - 文件工具 + bash：闭包捕获 `context.workspaceRoot`，不需要 hooks，工厂签名不变。
 * - todo/ask-user：接收 hooks（业务回调）并闭包烙进 execute——引擎无感。
 * hooks 由使用端（route.ts）每次请求组装时传入，捕获当次的 store/send。
 *
 * 形状是「**一个对象 + hooks**」而不是一串位置参数（2026-09-16 用户提的，依据见
 * `doc/plan/c8-skills.md` §11.1）：① 位置参数每加一项就要改整条调用链，对象是**加字段**；
 * ② 原来的 `(workspaceRoot, hooks, skillsRoot)` 里**两个相邻的 `string`**，顺序写反
 * **编译不报错、运行时静默错位**（技能根当工作区用）—— 具名对象从形状上消掉这个坑。
 */
export function createToolRegistry(
  context: ToolContext,
  hooks: ToolHooks,
): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of [
    createListTool(context.workspaceRoot),
    createReadTool(context.workspaceRoot),
    createWriteNoteTool(context.workspaceRoot),
    createWriteTool(context.workspaceRoot),
    createEditTool(context.workspaceRoot),
    createDeleteTool(context.workspaceRoot),
    createGrepTool(context.workspaceRoot),
    createFindTool(context.workspaceRoot),
    createBashTool(context.workspaceRoot),
  ]) {
    registry.register(tool);
  }

  // todo_write / ask_user_question 不绑定工作区（改会话内状态/提问），
  // 但需要业务 hooks——工厂参数接收并闭包烙（贴 pi：context 烙进工具）
  registry.register(createTodoTool(hooks));
  registry.register(createAskUserTool(hooks));

  // web_fetch / web_search：不绑工作区、不需要 hooks，也不进
  // TOOLS_NEEDING_CONFIRM（只读放行）。
  //   - web_fetch 自己会拦 loopback——因为放行档下没人把关，详见
  //     lib/tools/web-fetch/index.ts 头部说明。
  //   - web_search 每次调用要花一次模型调用的钱（走服务端搜索），
  //     靠系统提示词约束"只在需要最新信息时才用"。
  registry.register(createWebFetchTool());
  registry.register(createWebSearchTool());

  // skill（C8）：不绑工作区**也不绑 hooks** —— 它只读技能根下的 SKILL.md。
  // 自动放行（不进 TOOLS_NEEDING_CONFIRM）：要防的是"动手"，不是"读"。
  // 认下的信任边界：技能正文是外部指令，会不经批准影响模型行为；兜底是
  // 正文若要模型动手，bash / 写文件**仍然弹框**。
  registry.register(createSkillTool(context.skillsRoot));

  return registry;
}
