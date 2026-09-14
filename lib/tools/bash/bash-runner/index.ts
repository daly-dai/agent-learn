// ============================================================
// BashRunner —— 命令执行器（Phase 4 终端运行）
// ============================================================
// 用 node:child_process 的 spawn 起子进程：
//   - 流式：stdout/stderr 逐块 onChunk 回调（边跑边看）
//   - 超时：到点两级终止（SIGTERM → 5 秒后 SIGKILL）
//   - 取消：AbortSignal（前端「停止」按钮）触发同一套终止
//   - 截断：滚动缓冲，超过上限丢最旧（防止一条命令吐几 MB）
//
// 为什么 spawn 不用 exec：exec 攒完整输出才回调，大命令爆内存、
// 看不到中间过程；spawn 是管道流，边收边发。
// 为什么 stdio 用 ["ignore","pipe","pipe"]：
//   pipe = 子进程输出通过管道接进 Node 代码（数据才能被拿到）；
//   ignore 的 stdin = 没有键盘输入 → 交互式 TTY（vim/REPL）天然跑不起来。
// ============================================================

import { spawn } from "node:child_process";
import { createOutputDecoder } from "../../../process-output";
import { config } from "../../../config";

export type BashRunOptions = {
  /** 工作目录（锁 workspace） */
  cwd: string;
  /** 超时毫秒，默认 30 秒 */
  timeoutMs?: number;
  /** 取消信号（前端「停止」按钮） */
  signal?: AbortSignal;
  /** 流式回调：每收到一块清理后的文本就调一次 */
  onChunk?: (text: string) => void;
  /** 滚动缓冲上限（字符），默认 64KB */
  maxOutputChars?: number;
};

export type BashResult = {
  /** 截断后的合并输出（stdout + stderr） */
  output: string;
  /** 退出码；被终止/取消时为 null */
  exitCode: number | null;
  /** 是否被终止（超时或用户取消） */
  cancelled: boolean;
  /** 输出是否因超限被丢弃过最旧部分 */
  truncated: boolean;
};

// 默认值来自 lib/config.ts（唯一配置入口，环境变量可覆盖）
const DEFAULT_TIMEOUT_MS = config.bash.timeoutMs;
const DEFAULT_MAX_OUTPUT_CHARS = config.bash.maxOutputChars;
// SIGTERM 发出后等 5 秒，还不退出就 SIGKILL 处决（防死循环命令装死）
const FORCE_KILL_DELAY_MS = 5_000;

// 为什么选 pwsh 而不是 cmd（2026-08-25 定稿，对齐 DSH）：
//   cmd 生态的输出编码天生混合（内建报错 GBK + 读 UTF-8 文件内容 UTF-8），
//   接收端猜一个固定编码物理上做不到全对。DSH 的做法是【统一输出编码】：
//   让 stdout/stderr 一律 UTF-8，接收端固定 UTF-8 解。这是治本。
//
// 受限语言模式（ConstrainedLanguage）的坑（2026-08-26 实测发现）：
//   Windows 的 Smart App Control / WDAC / 安全软件会把 pwsh 压进受限模式，
//   其中【.NET 类型创建被禁】——DSH 的 preamble 双 pin
//   （[System.Text.UTF8Encoding]::new()）在受限模式下整行报
//   "Cannot create type. Only core types are supported"，pin 不生效，
//   pwsh 仍按系统代码页（GBK）输出，接收端 UTF-8 解 → 乱码依旧。
//   沙箱实测：属性 setter、静态方法调用也全被禁，preamble 无 .NET 可用。
//
// 正解（不碰 .NET，受限/非受限环境通用）：
//   cmd /c "chcp 65001 >nul & pwsh -NoProfile -EncodedCommand <base64>"
//   - chcp 是 cmd 内建命令，改的是【控制台代码页】；pwsh 作为 cmd 的
//     子进程【启动时】读到 65001 → 输出 UTF-8（pwsh 运行中再 chcp 无效，
//     它启动时就缓存了 OutputEncoding，实测过）。
//   - -EncodedCommand 用 UTF-16LE base64 传命令：base64 只有字母数字+/=，
//     天然避开 cmd 对引号、&、|、% 等字符的解析（直接 -Command 拼字符串
//     会被 cmd 二次解析，命令里带双引号就炸）。
//   - 为什么不用 shell:true 或 spawn("pwsh")：spawn("pwsh") 没有 cmd 层，
//     chcp 无从执行；shell:true 是 Node 内部拼 cmd /c，转义不可控。
//
// 注意：WindowsApps 里的 pwsh.exe 可能是"执行别名"（第一次跑弹商店），
//   若 spawn 失败可用 PWSH_PATH 环境变量指到真实 pwsh 安装路径。

/** Windows 上把命令包成 cmd 层：先 chcp 65001，再起 pwsh 用 base64 传命令 */
export function buildWindowsCommandLine(command: string): string {
  // pwsh -EncodedCommand 要求 UTF-16LE（含 BOM 语义）的 base64
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  // PWSH_PATH 指向真实 pwsh 时加引号（路径可能含空格）
  const pwsh = process.env.PWSH_PATH
    ? `"${process.env.PWSH_PATH}"`
    : "pwsh";
  return `chcp 65001 >nul & ${pwsh} -NoProfile -EncodedCommand ${encoded}`;
}

export class BashRunner {
  async run(command: string, options: BashRunOptions): Promise<BashResult> {
    return new Promise((resolve) => {
      // Windows：cmd 包一层（chcp 65001 → pwsh -EncodedCommand），
      // 避开受限模式禁 .NET 的问题（见文件头注释）。
      // 非 Windows：直接 bash -c。
      const proc =
        process.platform === "win32"
          ? spawn(
              "cmd",
              ["/d", "/s", "/c", buildWindowsCommandLine(command)],
              {
                cwd: options.cwd,
                stdio: ["ignore", "pipe", "pipe"],
              },
            )
          : spawn("bash", ["-c", command], {
              cwd: options.cwd,
              stdio: ["ignore", "pipe", "pipe"],
            });

      // ---- 滚动缓冲：始终保留最新，超限丢最旧 ----
      const chunks: string[] = [];
      let totalChars = 0;
      let truncated = false;

      const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
      const push = (text: string) => {
        chunks.push(text);
        totalChars += text.length;
        while (totalChars > maxChars && chunks.length > 1) {
          const removed = chunks.shift()!;
          totalChars -= removed.length;
          truncated = true;
        }
        options.onChunk?.(text);
      };

      // ---- 清理：去 ANSI 色码、去 \r（Windows 换行残留）----
      // 输入已经是解码后的文本（decoder 负责字节 → 正确编码）
      const sanitize = (text: string) =>
        text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");

      // stdout / stderr 各一个 decoder：TextDecoder 有内部状态，
      // 两个流共用会把一端的半个字符交给另一端补齐，照样乱码。
      const stdoutDecoder = createOutputDecoder();
      const stderrDecoder = createOutputDecoder();

      proc.stdout?.on("data", (data: Buffer) =>
        push(sanitize(stdoutDecoder.decode(data))),
      );
      proc.stderr?.on("data", (data: Buffer) =>
        push(sanitize(stderrDecoder.decode(data))),
      );

      // ---- 终止进程：Windows 杀进程树，Unix 两级（SIGTERM → 5 秒后 SIGKILL）----
      let killed = false;
      const killProcess = () => {
        if (killed) return;
        killed = true;

        if (process.platform === "win32") {
          // Windows 坑：proc 是 cmd（再带 pwsh 子进程），proc.kill 只能杀
          // cmd 本体，它派生的 pwsh（以及 git/npm 等孙进程）还活着、持有
          // 管道，导致 close 不触发、run 一直挂着。taskkill /t 杀整棵进程树。
          spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
            stdio: "ignore",
          });
        } else {
          proc.kill("SIGTERM"); // 请配合退出（程序可清理）
          setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) {
              proc.kill("SIGKILL"); // 5 秒还不退就处决（防死循环装死）
            }
          }, FORCE_KILL_DELAY_MS);
        }
      };

      const timer = setTimeout(killProcess, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      options.signal?.addEventListener("abort", killProcess, { once: true });

      proc.on("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", killProcess);
        // 流结束：吐出两个 decoder 里可能残留的半个字符
        const tail = stdoutDecoder.flush() + stderrDecoder.flush();
        if (tail.length > 0) push(sanitize(tail));
        resolve({
          output: chunks.join(""),
          exitCode: killed ? null : code,
          cancelled: killed,
          truncated,
        });
      });
    });
  }
}
