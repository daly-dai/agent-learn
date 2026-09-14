// ============================================================
// approval-memory.ts —— 审批记忆（B1-④：本会话 / 一直允许）
// ============================================================
// 记忆的两个层次（教学点：存储位置 = 信任的有效期）：
//   - 本会话允许 → 内存 Map（进程重启即失效——本会话的信任
//     不该跨会话存活，这是安全语义不是偷懒）
//   - 一直允许   → 磁盘规则文件（跨会话、跨重启生效）
//
// 为什么挂 globalThis（抄 lib/toolApproval.ts 的注释）：
// Next dev server 可能开多个 worker，各 worker 有独立模块实例——
// SSE 请求和 approve 请求若落不同 worker，模块级 Map 就找不到了。
// globalThis 在同一进程内全局可见（本地开发单进程可接受）。
// ============================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ---------- 会话级记忆（内存，globalThis 跨 worker） ----------

const g = globalThis as {
  __sessionApprovals?: Map<string, Set<string>>;
};

const sessionApprovals: Map<string, Set<string>> =
  (g.__sessionApprovals ??= new Map());

/** 本会话内是否已允许过该工具（不弹框） */
export function isSessionApproved(
  sessionId: string,
  toolName: string,
): boolean {
  return sessionApprovals.get(sessionId)?.has(toolName) ?? false;
}

/** 记住：本会话内该工具不再询问 */
export function rememberSession(sessionId: string, toolName: string): void {
  const set = sessionApprovals.get(sessionId) ?? new Set<string>();
  set.add(toolName);
  sessionApprovals.set(sessionId, set);
}

/** 清空本会话记忆（B18：显式 reset 接口）。
 *  用途：测试隔离（不跨测试泄漏）与开发调试。
 *  不挂 globalThis 内部字段名——测试不该黑进实现细节。 */
export function resetSessionApprovals(): void {
  sessionApprovals.clear();
}

// ---------- 持久化规则（磁盘，跨会话） ----------

const RULES_FILE = "approval-rules.json";

type PersistRules = { tools: string[] };

export function persistRulesPath(dir: string): string {
  return join(dir, RULES_FILE);
}

/** 读持久化规则（文件不存在 → 空集） */
export async function loadPersistRules(dir: string): Promise<Set<string>> {
  try {
    const raw = await readFile(persistRulesPath(dir), "utf8");
    const parsed = JSON.parse(raw) as PersistRules;
    return new Set(Array.isArray(parsed.tools) ? parsed.tools : []);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw e;
  }
}

/** 是否被"一直允许"覆盖（跨会话） */
export async function isPersistApproved(
  dir: string,
  toolName: string,
): Promise<boolean> {
  return (await loadPersistRules(dir)).has(toolName);
}

/** 记住：该工具一直允许（写入规则文件，跨会话生效） */
export async function rememberPersist(
  dir: string,
  toolName: string,
): Promise<void> {
  const tools = await loadPersistRules(dir);
  tools.add(toolName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    persistRulesPath(dir),
    `${JSON.stringify({ tools: [...tools].sort() }, null, 2)}\n`,
    "utf8",
  );
}
