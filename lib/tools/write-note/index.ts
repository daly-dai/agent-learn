// ============================================================
// write_note —— 写工作区笔记（低危特例：只允许 notes/ 下）
// ============================================================
// 与 write_file 的分工：write_note 是「只写 notes/」的特例，
// 文件名里的 / \ 会被替换成 -（防路径逃逸的第二道防线，
// 即使绕过 resolveInsideWorkspace 也写不出 notes/ 之外）。
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { RegisteredTool } from "../types";
import { resolveInsideWorkspace, stringArg } from "../path-utils";
import { text } from "../../message";

export function createWriteNoteTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "write_note",
    description: "在 workspace/notes/ 下写入一条 markdown 笔记。",
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "笔记文件名（.md）。",
        },
        content: {
          type: "string",
          description: "笔记正文。",
        },
      },
      required: ["fileName", "content"],
    },
    async execute(args) {
      const fileName = stringArg(args.fileName, "note.md").replace(/[/\\]/g, "-");
      const notePath = resolveInsideWorkspace(workspaceRoot, `notes/${fileName}`);
      await mkdir(dirname(notePath), { recursive: true });
      await writeFile(notePath, `${stringArg(args.content, "")}\n`, "utf8");
      return {
        content: [text(relative(workspaceRoot, notePath))],
        details: { path: relative(workspaceRoot, notePath) },
      };
    },
  };
}
