// ============================================================
// delete_file —— 删除工作区文件（Phase 3，不可逆）
// ============================================================

import { rm, stat } from "node:fs/promises";
import { relative } from "node:path";
import type { RegisteredTool } from "./types";
import { resolveInsideWorkspace, stringArg } from "./path-utils";
import { text } from "../message";

export function createDeleteTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "delete_file",
    description: "删除工作区内的一个文件（不可逆；调用前会弹框请你确认）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "工作区下的相对文件路径。",
        },
      },
      required: ["path"],
    },
    async execute(args) {
      const filePath = resolveInsideWorkspace(
        workspaceRoot,
        stringArg(args.path, ""),
      );

      const info = await stat(filePath).catch(() => null);

      if (!info) {
        throw new Error(`delete_file: 文件不存在：${args.path}`);
      }

      if (info.isDirectory()) {
        throw new Error(`delete_file: ${args.path} 是目录，本工具只删除文件。`);
      }

      await rm(filePath);

      return {
        content: [text(`已删除：${args.path}`)],
        details: { path: relative(workspaceRoot, filePath) },
      };
    },
  };
}
