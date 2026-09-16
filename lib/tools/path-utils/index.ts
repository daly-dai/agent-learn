// ============================================================
// 路径沙箱 —— 所有工具的"围栏"（lib/tools/ 内部共享）
// ============================================================
// 每个文件工具都先过 resolveInsideWorkspace：目标路径必须落在
// workspaceRoot 内，`..` 越界直接抛错。这是「agent 只能在工作区
// 里动文件」的结构保证——工具能力再强也出不了这个围栏。
//
// ⚠️ **但这条保证当前有一个已知例外**：**跨盘符**的绝对路径能穿出去
// （2026-09-16 真机实测，**经用户决定暂不修**）。详见下面 resolveInsideWorkspace
// 里的说明与 `PLAN.md` 排期表的 C33。
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
  // ⚠️ 已知漏洞（2026-09-16 真机实测，**故意未修**）：`relative()` 在 Windows 上
  // 表达不出**跨盘符**相对路径时，会把 target **原样返回**（一个绝对路径），
  // 于是 `startsWith("..")` 为假 ⇒ **跨盘符的绝对路径能穿出工作区**。
  // 实测：工作区在 E:，而只读、免审批的 `read_file` 读到了 C: 上的文件。
  // 同盘符挡得住 —— 所以老用例（夹具与工作区永远同盘）碰不到它，
  // **测试覆盖的形状和真实越界的形状不一样**。
  // 修法（`isAbsolute(rel)` 一并判定）与先红后绿的回归用例都已验证过一次，
  // **留到做项目分组时一起修**（围栏语义那时要重定）——见 `PLAN.md` 排期表的 **C33**。
  if (rel.startsWith("..") || (rel === "" && input.includes(".."))) {
    throw new Error(`路径越界：${input}`);
  }
  return target;
}
