# doc/plan/phase-4 —— Phase 4 终端运行（施工补记）

> 来源：PLAN.md 第六章 Phase 4 段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**（含 2026-08-26 受限语言模式乱码根治），保留作施工历史。

## 目标

- 新增 `bash` 工具 + `BashRunner`（`node:child_process`）。
- 能力：执行命令 → 流式吐 stdout/stderr → 超时/终止（Ctrl-C）→ 退出码。
- 安全：命令白名单或确认机制、限制工作目录、禁止交互式 TTY（前期）。
- 对应 pi：`packages/coding-agent/src/core/bash-executor.ts` 和 `exec.ts`。
- 注意：`route.ts` 需 `export const runtime = "nodejs"`（已有）。

## 实现前补记（AGENTS.md：先想清楚再动手）

- **BashRunner**（`lib/tools/bash/bash-runner.ts`）：`spawn(command, { cwd, shell: true, stdio: ["ignore","pipe","pipe"] })`。stdout/stderr 的 `data` 事件逐块清理（去 ANSI 色码/`\r`/二进制垃圾）→ `onChunk` 流式回调 + 滚动缓冲（超 64KB 丢最旧）；`close` 事件拿退出码。**两级终止**：超时（已确认默认 30 秒）或 AbortSignal → `SIGTERM` → 5 秒后 `SIGKILL`。
- **工具签名扩展**：`ToolExecutor` 加可选 `options?: { signal?, onChunk? }`（`lib/tools/types.ts`）——其他 8 个工具零改动。
- **引擎只透传**：`RunAgentLoopOptions` 加 `onToolOutput?`，`executeToolCall` 原样递 signal + onChunk。引擎不理解 onChunk，只搬运。
- **`tool_output` 是旁路帧，不是 AgentEvent**：工具 → route.ts → SSE → 前端实时显示；不进引擎事件流、不进 trace（避免一条 `npm install` 几千块把黑匣子淹掉）。最终输出仍在 `tool_execution_end` 的 result 里带一份（截断后）。
- **run 级取消**：`lib/runControl.ts`（挂 globalThis 的 `Map<runId, AbortController>`，同 `toolApprovals` 模式）；POST /api/chat 创建 controller 注册（同时传给 `complete` 和工具 execute），finally 清理；新接口 `POST /api/chat/stop { runId }` → `abort()`。
- **审批**（已确认）：bash 加入 `TOOLS_NEEDING_CONFIRM` 全量弹框；`cwd` 锁 workspace；`stdin: "ignore"` 天然禁交互式 TTY。
- **诚实边界**：bash 执行任意字符串，`cd ..` 一行就出围栏——**bash 的安全不靠沙箱靠确认**，与文件工具本质不同（规划时已向用户说明）。
- **Windows**：`shell: true` 走 cmd.exe；提示词引导用 Windows 兼容命令，避免 `ls` 等 Unix 专属命令。
- 暂缓：交互式 TTY/pty、命令白名单免确认、Windows 进程树击杀（`taskkill /T`，先单层）、远程执行（SSH/容器）、输出写临时文件全量保留（pi 的 fullOutputPath）。

## 2026-08-26 更新：受限语言模式乱码根治

- **症状**：Windows Smart App Control / WDAC 把 pwsh 压进 ConstrainedLanguage，`.NET 类型创建`被禁 → 旧 preamble 双 pin（`[System.Text.UTF8Encoding]::new()`）整行失败 → 输出仍 GBK → 乱码。
- **正解**：`cmd /c "chcp 65001 >nul & pwsh -NoProfile -EncodedCommand <base64>"`——chcp 是 cmd 内建不碰 .NET，pwsh 启动时读到 65001；base64 传命令避开 cmd 引号解析。详情见 `lib/tools/bash/bash-runner.ts` 文件头注释。
