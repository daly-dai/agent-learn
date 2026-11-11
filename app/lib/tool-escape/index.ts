// ============================================================
// 越界判定（C6 / C48 详案的 4.6）—— 纯函数
// ============================================================
// 围栏今天只在工具里"发现越界就抛错"。这一层把"越界"提前成一个可判定的事实，
// 让审批链路能在**执行前**问人 —— 而不是等工具报错之后模型自己猜。
//
// 两条边界必须记住：
//   ① 只有"参数里带路径"的 7 个工具参与判定；`write_note`（fileName 已净化）
//      和 `bash`（命令里的路径没法静态解析）不参与。
//   ② `bash` 只做**粗筛**：命中越界痕迹 = 不再自动放行、转弹框；**不阻止执行**。
//      静态解析命令里的路径必然骗人（引号 / 变量 / 管道），所以这里只敢"提示"。

import { isAbsolute, relative, resolve } from "node:path";

export type EscapeClass =
  { kind: "inside" } | { kind: "outside"; targets: string[] };

/** 参与越界判定的工具 → 它的路径参数名 + 缺省值 */
const PATH_TOOLS: Record<string, { argument: string; fallback: string }> = {
  read_file: { argument: "path", fallback: "" },
  write_file: { argument: "path", fallback: "" },
  edit_file: { argument: "path", fallback: "" },
  delete_file: { argument: "path", fallback: "" },
  grep: { argument: "path", fallback: "." },
  find: { argument: "path", fallback: "." },
  list_files: { argument: "path", fallback: "." },
};

/** bash 粗筛：命中任一条就值得让人看一眼（只用于提示，不用于拦截） */
const ESCAPE_TRACES = [
  /[A-Za-z]:[\\/]/, // 别的盘符：C:\ D:/
  /\\\\[^\s"'|<>]+/, // UNC：\\server\share
  /(^|[\s"'=(])\.\.([\\/]|\s|$)/, // ..
  /(^|[\s"'=(])~([\\/]|\s|$)/, // ~ 或 ~/x
];

/**
 * 这次工具调用有没有越出工作空间。
 * 输入 `call` 用结构类型（只需要 name + arguments），不依赖引擎的类型。
 */
export function classifyEscape(
  call: { name: string; arguments: Record<string, unknown> },
  workspaceRoot: string,
): EscapeClass {
  const tool = PATH_TOOLS[call.name];
  if (tool === undefined) return { kind: "inside" };

  const raw = call.arguments[tool.argument];
  const input = typeof raw === "string" ? raw : tool.fallback;
  const target = resolve(workspaceRoot, input);

  return isInside(workspaceRoot, target)
    ? { kind: "inside" }
    : { kind: "outside", targets: [target] };
}

/** bash 命令里有没有越界痕迹（只用于决定"要不要弹框"，不影响能否执行） */
export function hasEscapeTraces(command: string): boolean {
  return ESCAPE_TRACES.some((pattern) => pattern.test(command));
}

/**
 * 一次性放行凭据：人批准一条越界之后，只放行**这一条**。
 * 不做 "本会话允许" 也不写持久规则 —— 越界不该被记住（详案 4.6 ③）。
 */
export type EscapePermits = {
  grant(targets: string[]): void;
  consume(target: string): boolean;
};

export function createEscapePermits(): EscapePermits {
  const granted = new Set<string>();

  return {
    grant(targets) {
      for (const target of targets) granted.add(resolve(target));
    },
    consume(target) {
      const normalized = resolve(target);
      if (!granted.has(normalized)) return false;
      granted.delete(normalized);
      return true;
    },
  };
}

/** 目标是否落在工作空间内（与 `resolveInsideWorkspace` 同一套判据） */
export function isInside(workspaceRoot: string, target: string): boolean {
  const root = resolve(workspaceRoot);
  const rel = relative(root, resolve(target));
  // Windows 跨盘符时 relative() 会把绝对路径原样返回 ⇒ isAbsolute(rel) 必须一起判
  return !rel.startsWith("..") && !isAbsolute(rel);
}
