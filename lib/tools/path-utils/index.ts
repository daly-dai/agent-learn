// ============================================================
// 路径沙箱 —— 所有工具的"围栏"（lib/tools/ 内部共享）
// ============================================================
// 每个文件工具都先过 resolveInsideWorkspace：目标路径必须落在
// workspaceRoot 内，`..` 越界直接抛错。这是「agent 只能在工作区
// 里动文件」的结构保证——工具能力再强也出不了这个围栏。
//
// ⚠️ **这条保证曾经有一个例外：跨盘符**（2026-09-16 真机撞出：只读、免审批的
// `read_file` 读到了另一个盘的文件）。**2026-09-21 已修**（C33），见
// resolveInsideWorkspace 里的说明与回归用例 `index.test.ts` 的「跨盘符的绝对路径抛错」。
// ============================================================

import { isAbsolute, relative, resolve } from "node:path";

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
  // ⚠️ **跨盘符**（C33，2026-09-21 修）：`relative()` 在 Windows 上表达不出**跨盘符**
  // 相对路径时，会把 target **原样返回**（一个绝对路径）—— 而绝对路径不以 `..` 开头，
  // 所以只判 `startsWith("..")` 会**放行**。2026-09-16 真机上就是这么漏的：工作区在 E:，
  // 而只读、**免审批**的 `read_file` 读到了 C: 上的文件；`read_file`/`grep`/`find`/`list_files`
  // **共用这一个函数** ⇒ 另一个盘的任意文件都可读，配上自动放行的 `web_fetch` 就是外发通道。
  // `isAbsolute(rel)` 正是为这个形状准备的：`relative()` 正常工作时**永远**给相对路径。
  //
  // 老用例当初碰不到它，是因为夹具与工作区**永远同盘** —— **测试覆盖的形状和真实越界的
  // 形状不一样**。回归用例见 `index.test.ts` 的「跨盘符的绝对路径抛错」；那条用例保护的
  // **不是这个实现**，是语义（任何围栏实现都不许跨盘符放行）—— 所以 C6 换围栏时它照样守着。
  if (
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    (rel === "" && input.includes(".."))
  ) {
    throw new Error(`路径越界：${input}`);
  }
  return target;
}
