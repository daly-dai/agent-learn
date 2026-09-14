// ============================================================
// 工具共享纯函数（lib/tools/ 内部）
// ============================================================

import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { stat } from "node:fs/promises";

/** 递归列目录（跳过隐藏项），返回 workspaceRoot 内的相对路径，排序后返回 */
export async function listFiles(
  dir: string,
  workspaceRoot: string,
): Promise<string[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    const absolute = resolve(dir, dirent.name);
    const rel = relative(workspaceRoot, absolute);
    if (dirent.isDirectory()) {
      results.push(`${rel}/`);
      const nested = await listFiles(absolute, workspaceRoot);
      results.push(...nested);
    } else {
      results.push(rel);
    }
  }
  return results.sort();
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}\n... [截断 ${input.length - max} 字符]`;
}

/** 路径是否是已存在的目录（不存在/不是目录都返回 false） */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 统计 needle 在 content 中出现的次数（非重叠） */
export function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

/** 把字符串里的正则特殊字符转义，用于把用户输入安全地嵌进 RegExp */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
