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

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 64 * 1024;
// SIGTERM 发出后等 5 秒，还不退出就 SIGKILL 处决（防死循环命令装死）
const FORCE_KILL_DELAY_MS = 5_000;

export class BashRunner {
  async run(command: string, options: BashRunOptions): Promise<BashResult> {
    return new Promise((resolve) => {
      // Windows 乱码修复：cmd 默认输出 GBK（代码页 936），Node 按 UTF-8
      // 解码会乱码（实测 ping/dir 的中文全乱）。chcp 65001 把输出切到
      // UTF-8，字节流和默认解码就对上了。`&` 无条件连接：chcp 失败
      // 也不影响命令本身执行。
      const effectiveCommand =
        process.platform === "win32" ? `chcp 65001 >nul & ${command}` : command;

      const proc = spawn(effectiveCommand, {
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
      const sanitize = (raw: Buffer) =>
        raw.toString().replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");

      proc.stdout?.on("data", (data) => push(sanitize(data)));
      proc.stderr?.on("data", (data) => push(sanitize(data)));

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
