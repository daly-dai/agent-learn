// ============================================================
// edit_file —— 「唯一原文 → 新文」精确替换（Phase 3）
// ============================================================
// 形态 A 最简版：oldText 必须唯一出现（找不到/多处都报错，
// 错误结果回给模型让它修正）；模糊匹配和 diff 式留作扩展。
// ============================================================

import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { RegisteredTool } from "./types";
import { resolveInsideWorkspace, stringArg } from "./path-utils";
import { countOccurrences } from "./shared";
import { text } from "../message";

export function createEditTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "edit_file",
    description:
      "用「唯一原文 → 新文」替换文件内容；oldText 必须在文件中唯一出现（找不到或多处都报错，让模型修正）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "工作区下的相对文件路径。",
        },
        oldText: {
          type: "string",
          description: "要替换的原文（必须唯一）。",
        },
        newText: {
          type: "string",
          description: "替换后的新文（可为空 = 删除该段）。",
        },
      },
      required: ["path", "oldText", "newText"],
    },
    async execute(args) {
      const filePath = resolveInsideWorkspace(
        workspaceRoot,
        stringArg(args.path, ""),
      );
      const oldText = stringArg(args.oldText, "");
      if (!oldText) {
        throw new Error("edit_file: oldText 不能为空。");
      }
      const newText = typeof args.newText === "string" ? args.newText : "";

      const content = await readFile(filePath, "utf8");
      const first = content.indexOf(oldText);
      if (first === -1) {
        throw new Error(
          `edit_file: 在 ${args.path} 中找不到要替换的原文，请检查 oldText 是否与文件内容完全一致。`,
        );
      }
      const occurrences = countOccurrences(content, oldText);
      if (occurrences > 1) {
        throw new Error(
          `edit_file: oldText 在文件中出现 ${occurrences} 处，请提供更多上下文使其唯一。`,
        );
      }

      const updated =
        content.slice(0, first) + newText + content.slice(first + oldText.length);
      await writeFile(filePath, updated, "utf8");
      return {
        content: [text(`已在 ${args.path} 中替换 1 处。`)],
        details: { path: relative(workspaceRoot, filePath) },
      };
    },
  };
}
