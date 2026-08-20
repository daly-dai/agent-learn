// ============================================================
// bash —— 执行 shell 命令（Phase 4 终端运行）
// ============================================================
// 最高危的工具（任意命令 = 任意能力）：执行前会经人工确认弹框，
// cwd 锁 workspace；但诚实地说——bash 绕得过路径沙箱（cd .. 一行
// 就出去），它的安全不靠沙箱靠确认。stdin 是 ignore 的，所以
// 交互式 TTY（vim/REPL）天然跑不起来。
// ============================================================

import type { RegisteredTool } from "./types";
import { BashRunner } from "./bash-runner";
import { text } from "../message";

export function createBashTool(workspaceRoot: string): RegisteredTool {
  const runner = new BashRunner();

  return {
    name: "bash",
    description:
      "在工作区内执行一条 shell 命令，流式返回输出；执行前会弹框请用户确认。命令在 Windows 环境运行（cmd.exe），避免 ls 等 Unix 专属命令。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的命令。",
        },
      },
      required: ["command"],
    },
    async execute(args, options) {
      const command =
        typeof args.command === "string" && args.command.trim()
          ? args.command
          : "";

      if (!command) {
        throw new Error("bash: command 不能为空。");
      }

      const result = await runner.run(command, {
        cwd: workspaceRoot,
        signal: options?.signal,
        onChunk: options?.onChunk,
      });

      // 终止/失败时给模型一个明确的收尾提示（它要据此向用户解释）
      const statusNote = result.cancelled
        ? "\n[命令被终止：超时或用户取消]"
        : result.exitCode === 0
          ? ""
          : `\n[命令退出码：${result.exitCode}]`;

      return {
        content: [
          text(
            result.output.length > 0
              ? `${result.output}${statusNote}`
              : `(无输出)${statusNote}`,
          ),
        ],
        details: {
          exitCode: result.exitCode,
          cancelled: result.cancelled,
          truncated: result.truncated,
        },
      };
    },
  };
}
