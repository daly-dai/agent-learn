// ============================================================
// bash —— 执行 shell 命令（Phase 4 终端运行）
// ============================================================
// 最高危的工具（任意命令 = 任意能力）：执行前会经人工确认弹框，
// cwd 锁 workspace；但诚实地说——bash 绕得过路径沙箱（cd .. 一行
// 就出去），它的安全不靠沙箱靠确认。stdin 是 ignore 的，所以
// 交互式 TTY（vim/REPL）天然跑不起来。
// ============================================================

import type { RegisteredTool } from "../types";
import { BashRunner } from "./bash-runner";
import { text } from "../../message";

export function createBashTool(workspaceRoot: string): RegisteredTool {
  const runner = new BashRunner();

  return {
    name: "bash",
    description:
      "在工作区内执行一条 shell 命令，流式返回输出；执行前会弹框请用户确认。命令在 Windows 环境的 PowerShell 中运行（pwsh），可用 dir/type/get-content 等；避免 ls 等 Unix 专属命令。返回的是 stdout 与 stderr 合并后的文本。",
    // 这把工具**专属的规矩**：住工具文件里，不住提示词文件里（判据见 `RegisteredTool.guidelines`）。
    // 这两条原先只活在 `bash-runner/index.ts` 的代码注释里（2026-08-26 实测）——
    // **注释是给人看的，模型看不见**，于是 2026-09-17 它照样写出 `[Math]::Min(...)`：
    // 18 个文件全报错、退出码 0、工具回"成功"（详案 C36 第二节）。知识得挂在模型看得见的那一面。
    guidelines: [
      // ① 语法禁区 + 替代写法 + 自查手段。只写"别用"等于告诉模型"你不能干什么"，
      //    却不告诉它"那该怎么写"——它只能再猜一次。
      "本机 PowerShell 可能被安全策略压进**受限语言模式**：`[类型]::静态方法()` 与类型创建会被拒绝，改用 `-gt` / `-lt` 这类比较运算符，或用 if / switch 判断。当前模式可用 `$ExecutionContext.SessionState.LanguageMode` 查。",
      // ② 读取姿势（不是形状说明）。形状归 description —— C34 禁的是**同一句话两个家**，
      //    这里多给的是"因此该怎么读它"。
      "返回值是 stdout 与 stderr 合并后的文本（保持原有的先后顺序，不区分来源）：报错可能夹在输出中间，不要只看结尾。",
    ],
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
