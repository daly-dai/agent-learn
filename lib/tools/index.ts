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
 * 创建预装文件系统工具的 ToolRegistry（每请求组装，贴 pi create-harness）。
 * - 文件工具 + bash：闭包捕获 workspaceRoot，不需要 hooks，工厂签名不变。
 * - todo/ask-user：接收 hooks（业务回调）并闭包烙进 execute——引擎无感。
 * hooks 由使用端（route.ts）每次请求组装时传入，捕获当次的 store/send。
 */
export function createToolRegistry(
  workspaceRoot: string,
  hooks: ToolHooks,
): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of [
    createListTool(workspaceRoot),
    createReadTool(workspaceRoot),
    createWriteNoteTool(workspaceRoot),
    createWriteTool(workspaceRoot),
    createEditTool(workspaceRoot),
    createDeleteTool(workspaceRoot),
    createGrepTool(workspaceRoot),
    createFindTool(workspaceRoot),
    createBashTool(workspaceRoot),
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

  return registry;
}
