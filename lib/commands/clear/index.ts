// ============================================================
// lib/commands/clear/index.ts —— /clear 命令：清空当前会话
// ============================================================
// 抄谁、为什么抄：
//   - 动作型命令（DSH 型）：直接执行副作用，不走模型
//   - 复用 store.reset()（DELETE /api/chat 同款能力，2026-08-26 预留
//     "未来斜杠命令 /clear 等可复用"——现在是兑现的时候）
//   - 带参数报 USAGE ← DSH executeCompact 同款（/clear 不接受参数）
// 反馈：前端 runCommand 成功后 fetchHistory 会拿到空消息流
// （store.reset() 后 buildContext 为空）——"清空"本身即反馈，
// 文案只兜底无变化场景（与 /compact 同款三路反馈）。
// 目录结构（AGENTS.md 6.5）：实现 + 单测同目录，index.ts 当入口。
// ============================================================

import type { SlashCommand } from "../types";

/** /clear 命令定义（注册进 lib/commands 注册表） */
export function createClearCommand(): SlashCommand {
  return {
    name: "clear",
    description: "清空当前会话的历史消息",
    source: "builtin",
    handler: async (inv) => {
      if (inv.rawInput.trim().length > 0) {
        return { kind: "error", text: "用法: /clear（不接受参数）" };
      }
      await inv.api.store.reset();
      return { kind: "success", text: "会话已清空。" };
    },
  };
}
