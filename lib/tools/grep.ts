// ============================================================
// grep —— 按正则搜索文件内容（Phase 3）
// ============================================================

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RegisteredTool } from "./types";
import { resolveInsideWorkspace, stringArg } from "./path-utils";
import { listFiles, truncate } from "./shared";
import { text } from "../message";

export function createGrepTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "grep",
    description: "在工作区内按正则表达式搜索文件内容，返回 路径:行号:匹配行。",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "JS 正则表达式。",
        },
        path: {
          type: "string",
          description: "搜索起点目录（工作区内），默认 '.'。",
        },
        maxResults: {
          type: "number",
          description: "最多返回的匹配行数，默认 50。",
        },
      },
      required: ["pattern"],
    },
    async execute(args) {
      const pattern = stringArg(args.pattern, "");
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        // 无效正则是「输入问题」不是「系统问题」：转成错误结果回给模型让它改
        throw new Error(
          `grep: 无效正则表达式：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const rootDir = resolveInsideWorkspace(
        workspaceRoot,
        stringArg(args.path, "."),
      );
      const maxResults =
        typeof args.maxResults === "number"
          ? Math.max(1, Math.floor(args.maxResults))
          : 50;

      const files = await listFiles(rootDir, workspaceRoot);
      const matches: string[] = [];
      for (const rel of files) {
        if (matches.length >= maxResults) break;
        let content: string;
        try {
          content = await readFile(resolve(workspaceRoot, rel), "utf8");
        } catch {
          continue; // 读不了（二进制/权限）就跳过，不让一个文件打挂整个搜索
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push(`${rel}:${i + 1}: ${truncate(lines[i].trim(), 200)}`);
            if (matches.length >= maxResults) break;
          }
        }
      }

      const truncatedNote =
        matches.length >= maxResults
          ? `\n(匹配过多，仅显示前 ${maxResults} 条)`
          : "";
      return {
        content: [
          text(
            matches.length > 0
              ? matches.join("\n") + truncatedNote
              : "(无匹配)",
          ),
        ],
        details: { count: matches.length, truncated: matches.length >= maxResults },
      };
    },
  };
}
