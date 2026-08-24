// ============================================================
// find —— 按文件名通配搜索（Phase 3）
// ============================================================

import { basename } from "node:path";
import type { RegisteredTool } from "../types";
import { resolveInsideWorkspace, stringArg } from "../path-utils";
import { escapeRegExp, listFiles } from "../shared";
import { text } from "../../message";

export function createFindTool(workspaceRoot: string): RegisteredTool {
  return {
    name: "find",
    description:
      "按文件名模式查找文件（支持 * 通配符），返回工作区内的相对路径。",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "文件名模式，如 *.md 或 agent-*。",
        },
        path: {
          type: "string",
          description: "搜索起点目录（工作区内），默认 '.'。",
        },
      },
      required: ["pattern"],
    },
    async execute(args) {
      const pattern = stringArg(args.pattern, "");
      const rootDir = resolveInsideWorkspace(
        workspaceRoot,
        stringArg(args.path, "."),
      );
      // 把用户友好的 * 通配转成正则；只匹配文件名（basename），不匹配目录
      // （listFiles 返回的目录带 "/" 后缀，先过滤掉——测试倒逼出的修正）
      const regex = new RegExp(
        `^${pattern.split("*").map(escapeRegExp).join(".*")}$`,
      );
      const files = await listFiles(rootDir, workspaceRoot);
      const hits = files.filter(
        (rel) => !rel.endsWith("/") && regex.test(basename(rel)),
      );
      return {
        content: [text(hits.length > 0 ? hits.join("\n") : "(无匹配)")],
        details: { hits },
      };
    },
  };
}
