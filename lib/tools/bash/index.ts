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
import { readPwshErrors, stripPwshClixml } from "../../process-output";

/**
 * 把子进程的原始输出整理成**给模型看**的正文（C36 T2，纯函数）。
 *
 * 判据只有一条：**只信 stderr**。CLIXML 的样文我们自己的文档里就抄着
 * （`doc/plan/phase-4-bash.md` 第二节），模型一条 `Get-Content` 就会把它打到
 * **stdout** 上 —— 若按"合并输出里出现 `#< CLIXML`"判定，就会把一份**正常读出来的
 * 文档**当成报错并**改写**它（把正文换成"[pwsh 报错 ×20]"）。
 * 所以：报错只看 `stderr`（CLIXML 的家），而摘掉机器话则要动合并输出那一份。
 *
 * 摘掉的理由（不是洁癖）：真样本是**同一条报错写 20 遍**，它把信号埋了；
 * 解出来的那一句 + "×20"才是信息。
 *
 * 顺带把条数交出来（T3 的判据要用）——同一个 `stderr` 不解析两遍。
 */
export function cleanBashOutput(
  output: string,
  stderr: string,
): { text: string; pwshErrorCount: number } {
  const errors = readPwshErrors(stderr);
  if (!errors) return { text: output, pwshErrorCount: 0 };

  const body = stripPwshClixml(output).trim();
  return {
    text: body.length > 0 ? `${body}\n\n${errors.summary}` : errors.summary,
    pwshErrorCount: errors.count,
  };
}

export type BashStatusInput = {
  /** 退出码；被终止时为 null */
  exitCode: number | null;
  cancelled: boolean;
  /** 从 stderr 解出来的 pwsh 报错条数（0 = 没有） */
  pwshErrorCount: number;
};

/**
 * 工具结果尾部的**标记**（C36 T3，纯函数）——三个断点里最阴的那个：
 * **退出码只反映最后一条语句**。真样本里 `ForEach-Object` 自己跑完了
 * （错在它执行的脚本块里）⇒ 整条管道算成功、退出码 0、工具回「成功」，
 * 而 20 个文件一个都没处理。
 *
 * **为什么加标记而不是抛错**（抄 DSH 的形状，五家对照见详案第四节结论 3）：
 *   ① 抛错会误伤"退出码 1 但完全正常"的 `grep 无匹配`
 *   ② 抛错会改掉模型看到的形状（`isError` 通道），回归面比它修的病大
 *   ⇒ 修的是**延长既有的标记机制**，不是换机制。
 *
 * 四格：被终止 → 终止；非 0 → 退出码；**0 但有报错 → 点明"退出码是 0"**；
 * 0 且干净 → 什么都不加（别把正常输出弄噪）。两个信号都有时只报退出码 ——
 * 报错正文已经（以"×N + 人话"的形式）在正文里了，同一件事不说两遍。
 */
export function bashStatusNote({
  exitCode,
  cancelled,
  pwshErrorCount,
}: BashStatusInput): string {
  if (cancelled) return "\n[命令被终止：超时或用户取消]";
  if (exitCode !== 0) return `\n[命令退出码：${exitCode}]`;
  if (pwshErrorCount > 0) {
    return `\n[退出码为 0，但 stderr 有 ${pwshErrorCount} 条报错]`;
  }
  return "";
}

/** 命令自己合并流的两写法：`2>&1`（stderr → 成功流）、`*>&1`（所有流 → 成功流） */
const SELF_MERGED_STREAM_RE = /(?:2|\*)\s*>\s*&\s*1/;

/**
 * 命令自己把 stderr 并进 stdout 时的提示（2026-09-21 加，复盘时当场撞出的边界）。
 *
 * 为什么非提示不可：走**真实路径**（`cmd /c chcp 65001 & pwsh -EncodedCommand`，
 * stdio 形状与 `BashRunner` 一致）实测 —— pwsh 会把错误记录**并进成功流**，而成功流
 * 写到非控制台的管道时这些记录**被丢弃**：`stdout` 与 `stderr` **双双 0 字节**，
 * 报错文本整个消失（`… 2>&1 | Out-File` 也是 0 字节）。
 *
 * 于是上面那条判据（只信 `stderr`）在这里**必然失效**：退出码 0、两路皆空 ⇒ 判成"成功"。
 * 方向正好和 C36 T2 相反 —— T2 说"判来源不判形状"，这条说"**来源会被命令自己搬走**"。
 * 而**丢掉的文本救不回来**（它根本没出来，不是藏起来了）⇒ 只能挡在发生之前：
 * 这一句提示 + `guidelines` 里那条规矩（规矩归工具文件，C34）。
 *
 * 误报可接受：命令里恰好"写着"这串字符（例如让 `Get-Content` 打一份含它的文档）
 * 也会多这一句 —— 它只是提示，不改正文、不动 `isError` 通道。
 */
export function selfMergedStreamNote(command: string): string {
  if (!SELF_MERGED_STREAM_RE.test(command)) return "";
  return (
    "\n[命令里用了 2>&1：本工具返回的本来就是 stdout 与 stderr 合并后的文本；" +
    "自己合并会让 pwsh 把报错记录丢弃（实测两路都是 0 字节），报错收不回来 —— 要留下报错，去掉它]"
  );
}

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
      // ③ 一条**反向**的边界（2026-09-21）：上面两条教它"怎么读"，这条教它"别把报错弄丢"。
      //    住这里而不是只藏在判据里，是因为**模型就是写命令的那个人** —— 它不写，
      //    这件事就不会发生；判据只能事后提示（而且那时文本已经没了）。
      "不要在命令里自己写 `2>&1`（或 `*>&1`）：本工具返回的本来就是 stdout 与 stderr 合并后的文本。自己合并会让 pwsh 把错误记录并进成功流，而成功流写到管道时这些记录会被丢弃 —— 报错文本会**整个消失**（实测两路都是 0 字节），我们也判不出来。",
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

      // 给人看的正文：CLIXML 解成人话、同一条报错的 20 遍收成「×20」（T2）
      const view = cleanBashOutput(result.output, result.stderr);

      // 尾部标记：退出码 + "其实有报错"这条判据（T3）
      const statusNote = bashStatusNote({
        exitCode: result.exitCode,
        cancelled: result.cancelled,
        pwshErrorCount: view.pwshErrorCount,
      });

      // 反方向的边界：命令自己合并流 ⇒ 报错可能已经消失（判据判不出来，只能提示）
      const mergeNote = selfMergedStreamNote(command);

      return {
        content: [
          text(
            view.text.length > 0
              ? `${view.text}${statusNote}${mergeNote}`
              : `(无输出)${statusNote}${mergeNote}`,
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
