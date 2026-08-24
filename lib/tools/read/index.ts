// ============================================================
// read_file —— 读取工作区文件（长内容截断）
// ============================================================

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { RegisteredTool } from "../types";
import { resolveInsideWorkspace, stringArg } from "../path-utils";
import { truncate } from "../shared";
import { text } from "../../message";

export function createReadTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "read_file",
    description: "读取安全工作区内的 UTF-8 文本文件。",
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
      const content = await readFile(filePath, "utf8");
      return {
        content: [text(truncate(content, 1800))],
        details: { path: relative(workspaceRoot, filePath) },
      };
    },
  };
}
