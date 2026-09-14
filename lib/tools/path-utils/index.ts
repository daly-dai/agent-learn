// ============================================================
// 路径沙箱 —— 所有工具的"围栏"（lib/tools/ 内部共享）
// ============================================================
// 每个文件工具都先过 resolveInsideWorkspace：目标路径必须落在
// workspaceRoot 内，`..` 越界直接抛错。这是「agent 只能在工作区
// 里动文件」的结构保证——工具能力再强也出不了这个围栏。
// ============================================================

import { relative, resolve } from "node:path";

/** 取字符串参数；空串/非字符串时用 fallback（工具参数的可选值统一入口） */
export function stringArg(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/** 把相对/绝对路径解析进工作区；越界抛错 */
export function resolveInsideWorkspace(
  workspaceRoot: string,
  input: string,
): string {
  const target = resolve(workspaceRoot, input);
  const root = resolve(workspaceRoot);
  const rel = relative(root, target);
  if (rel.startsWith("..") || (rel === "" && input.includes(".."))) {
    throw new Error(`路径越界：${input}`);
  }
  return target;
}
