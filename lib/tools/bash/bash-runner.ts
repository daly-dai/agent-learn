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
import { createOutputDecoder } from "../../process-output";
import { config } from "../../config";

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

export class BashRunner {
  async run(command: string, options: BashRunOptions): Promise<BashResult> {
    return new Promise((resolve) => {
      // 为什么不再拼 chcp 65001 前缀（2026-08-25 改）：chcp 只改 cmd 的
      // "显示代码页"，对 dir 这类内建命令写入管道的字节并不可靠（实测
      // 仍输出 GBK）。改为：不干预命令，在接收端用 createOutputDecoder
      // 按平台解码（Windows → GBK，其余 → UTF-8）。对照 DSH：它用 pwsh
      // 双 pin Console.OutputEncoding；我们用 cmd 没有等价物，接收端解码
      // 是更贴合 cmd 生态的做法。
      const proc = spawn(command, {
        cwd: options.cwd,
        shell: true, // 走系统 shell（Windows 上是 cmd.exe），命令原样执行
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
          // Windows 坑（实测踩到）：spawn(shell:true) 实际起的是 cmd.exe，
          // proc.kill 只能杀 cmd，它派生的子进程（如 ping）还活着、持有管道，
          // 导致 close 不触发、run 一直挂着。taskkill /t 杀整棵进程树。
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
