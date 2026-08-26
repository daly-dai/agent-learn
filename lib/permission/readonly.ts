// ============================================================
// readonly.ts —— 静态命令分析：判断一条 shell 命令是否"只读"
// ============================================================
// 抄 Reasonix shellsafe（Go：完整 bash AST + 命令表），但我们用
// **词法近似**：取命令首词查只读表 + fail-closed。
//
// 原理（教学点）：
//   - 命令 = 第一个词（程序名）+ 剩余参数。查两张白名单表：
//     1. 单命令只读表：cat/ls/grep/Get-Content… 程序本质只读
//     2. 子命令只读表：git status 只读、git push 写——看第二个词
//   - fail-closed：命令含"走私语法"（管道/重定向/替换/后台/链）
//     → 无法静态证明还是只读的 → 不自动放行（宁可多弹框）
//   - 只读命令带写参数（find -exec、sort -o、git diff --output）
//     → 也不放行（抄 Reasonix nestedReadOnlyArgsSafe 关键项）
//
// 为什么词法近似够用：完整解析器（Go mvdan/sh）提升的是"精确度"
// （少弹框），不是"安全性"——fail-closed 下两者都安全。
// ============================================================

/** 单命令只读表：程序名本身 = 只读行为（无文件/网络/进程副作用） */
const READ_ONLY_COMMANDS = new Set([
  // Unix 常用（抄 Reasonix readOnlyCommands）
  "cat", "head", "tail", "less", "more",
  "ls", "dir", "find", "locate", "which", "whereis", "type",
  "grep", "egrep", "fgrep", "rg",
  "echo", "printf",
  "pwd", "cd", "whoami", "id", "uname", "hostname",
  "date", "printenv",
  "wc", "sort", "uniq", "cut", "tr",
  "stat", "file", "du", "df",
  "ps", "top", "htop",
  "diff", "cmp", "comm",
  "man", "info", "help",
  "true", "false", "test", "[",
  "basename", "dirname", "realpath", "readlink",
  // PowerShell 观察性 cmdlet（抄 Reasonix 的窄表：只列动词本质
  // 是观察的 cmdlet；get-content 读、get-process 查进程等）
  "get-childitem", "get-content", "get-item", "get-location",
  "get-process", "get-command", "get-nettcpconnection",
  "resolve-path", "select-string", "measure-object", "compare-object",
  // PowerShell 常用别名
  "where", "select",
]);

/** 子命令只读表：base → 只读子命令集合（不在集合里 = fail-closed 弹框） */
const READ_ONLY_PREFIXES: Record<string, Set<string>> = {
  git: new Set([
    "log", "status", "diff", "show", "tag", "blame", "grep", "ls-files",
    "ls-tree", "rev-parse", "rev-list", "describe", "reflog", "shortlog",
    "whatchanged", "cherry", "cat-file", "for-each-ref", "name-rev",
  ]),
  go: new Set(["vet", "doc", "list", "version", "env"]),
  npm: new Set(["ls", "list", "view", "info", "outdated", "audit"]),
  // cargo 整表去掉（Reasonix：check/doc 写 target/ 构建产物、search 走网络——
  // 都不算纯只读；教学环境 cargo 少用，全弹框 fail-closed 最安全）
  docker: new Set(["ps", "images", "inspect", "logs", "stats", "info", "version"]),
  node: new Set(["-v", "--version"]),
  python: new Set(["--version", "-v", "-V"]),
  python3: new Set(["--version", "-v", "-V"]),
};

/**
 * 走私语法检测：这些 shell 组合语法能把只读命令变成写操作——
 *   | 管道（输出喂给别的命令）、& 后台/链、; 链、
 *   < > 重定向（输出写成文件）、$() 命令替换、` 反引号替换
 * 出现任何一个 → 无法静态证明只读 → fail-closed。
 * 注：引号/通配符/变量（$env:X）不改命令的只读本质，放行；
 *     误判只会多弹框（保守方向），安全。
 */
function hasSmugglingSyntax(command: string): boolean {
  return /[|&;<>`]/.test(command) || command.includes("$(");
}

/** 只读命令带写参数 → 不自动放行（抄 Reasonix nestedReadOnlyArgsSafe 关键项）
 * 注意：这里补的正是"子命令表只读、但参数能走私写操作"的缺口——
 * git tag 创建 / go env -w / npm audit fix，都是表里有、参数是写的典型。 */
function hasWriteArgs(base: string, sub: string, args: string[]): boolean {
  switch (base) {
    case "find":
      return args.some((a) =>
        ["-exec", "-execdir", "-delete", "-ok", "-okdir",
          "-fls", "-fprint", "-fprint0", "-fprintf"].includes(a),
      );
    case "sort":
      return args.some((a) =>
        a === "-o" || a === "--output" || a.startsWith("--output="),
      );
    case "git":
      if (sub === "tag") {
        // tag 只在"列出现"（无操作数，或带 -l/--list）时只读；
        // `git tag v1.0` = 创建 tag（写），必须拦截
        const listing =
          args.length === 0 ||
          args.some((a) => a === "-l" || a === "--list");
        return !listing;
      }
      if (
        (sub === "diff" || sub === "show" || sub === "log") &&
        args.some((a) => a === "--output" || a.startsWith("--output="))
      ) {
        return true;
      }
      return false;
    case "go":
      // go env -w/-u = 写 Go 环境配置（Reasonix 同款拦截）
      if (sub === "env") {
        return args.some((a) => a === "-w" || a === "-u");
      }
      return false;
    case "npm":
      // npm audit fix = 改依赖清单/lockfile（Reasonix 同款拦截）
      if (sub === "audit") {
        return args.some((a) => a === "fix" || a === "--fix");
      }
      return false;
    default:
      return false;
  }
}

/** 命令首词拆分：trim → 按空白切。引号不特殊处理（多出的"词"只
 * 影响 args，不影响 base/sub 查表；引号内的 | > 会被走私检测拦下
 * 成弹框——保守方向，安全）。 */
function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter((w) => w.length > 0);
}

/** 命令分类结果 */
export type ReadOnlyClass = {
  base: string; // 首词（小写）
  sub: string; // 子命令（如 git status 的 status；无则空串）
  ok: boolean; // 是否判定为只读
};

/**
 * 静态分类一条命令：只读 → ok=true；写/无法证明 → ok=false（fail-closed）。
 * 纯函数，可单测。
 */
export function classifyReadOnlyCommand(command: string): ReadOnlyClass {
  if (hasSmugglingSyntax(command)) return { base: "", sub: "", ok: false };
  const fields = splitCommand(command);
  if (fields.length === 0) return { base: "", sub: "", ok: false };

  const base = fields[0]!.toLowerCase();
  const args = fields.slice(1);

  if (READ_ONLY_COMMANDS.has(base)) {
    if (hasWriteArgs(base, "", args)) return { base, sub: "", ok: false };
    return { base, sub: "", ok: true };
  }

  if (args.length > 0) {
    const sub = args[0]!.toLowerCase();
    if (READ_ONLY_PREFIXES[base]?.has(sub)) {
      if (hasWriteArgs(base, sub, args.slice(1))) return { base, sub, ok: false };
      return { base, sub, ok: true };
    }
  }

  return { base: "", sub: "", ok: false };
}

/** 是否是只读命令（审批放行的判定入口） */
export function isReadOnlyBash(command: string): boolean {
  return classifyReadOnlyCommand(command).ok;
}
