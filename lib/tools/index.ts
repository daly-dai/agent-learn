// ============================================================
// 工具系统 —— Agent 的"手脚"（组装层）
// ============================================================
// 每个工具一个文件（lib/tools/ 下的工厂函数），这里负责：
//   1. ToolRegistry：注册表（说明书 + 执行函数）
//   2. createToolRegistry：把 8 个工具工厂组装成一个注册表
//
// 对外接口不变：route.ts 仍 `import { createToolRegistry } from "@/lib/tools"`，
// 目录 + index 解析会自动指向本文件。
// ============================================================

import type { ToolDefinition, ToolResult } from "../types";
import type { RegisteredTool, ToolExecutorOptions } from "./types";
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

/** 创建预装文件系统工具的 ToolRegistry（每个工具闭包捕获 workspaceRoot） */
export function createToolRegistry(workspaceRoot: string): ToolRegistry {
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
    // todo_write / ask_user_question 不绑定工作区（改会话内状态/提问），工厂不需要参数
    createTodoTool(),
    createAskUserTool(),
  ]) {
    registry.register(tool);
  }

  return registry;
}
