// ============================================================
// list_files —— 列出工作区文件
// ============================================================

import { relative } from "node:path";
import type { RegisteredTool } from "./types";
import { resolveInsideWorkspace, stringArg } from "./path-utils";
import { listFiles } from "./shared";
import { text } from "../message";

export function createListTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "list_files",
    description: "列出安全工作区内的文件。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "工作区下的相对目录路径，默认 '.'。",
        },
      },
    },
    async execute(args) {
      const dir = resolveInsideWorkspace(workspaceRoot, stringArg(args.path, "."));
      const entries = await listFiles(dir, workspaceRoot);
      return {
        content: [text(entries.length > 0 ? entries.join("\n") : "(空目录)")],
        details: { entries },
      };
    },
  };
}
