// ============================================================
// lib/commands/export/index.ts —— /export 命令：导出当前会话（门面模式）
// ============================================================
// 抄 DSH `/export`（session-log-export/src/index.ts:74-95）门面样板：
//   handler 只校验参数返回 success（"下载已请求"），实际下载走独立
//   GET route（?sessionId= 查询参数）——命令不产文件，文件走 HTTP 层
//   （可鉴权/可 Content-Disposition），职责分离。
// 我们对应：handler 校验后返回 success，前端 pickCommand 收到
//   sourceEventSeq/result 后触发 GET /api/chat/export?sessionId=xxx
//   （浏览器下载）。handler 不碰文件系统。
// 目录结构（AGENTS.md 6.5）：实现 + 单测同目录，index.ts 当入口。
// ============================================================

import type { SlashCommand } from "../types";

/** /export 命令定义（注册进 lib/commands 注册表） */
export function createExportCommand(): SlashCommand {
  return {
    name: "export",
    description: "导出当前会话（下载 JSONL 文件）",
    source: "builtin",
    handler: async (inv) => {
      if (inv.rawInput.trim().length > 0) {
        return { kind: "error", text: "用法: /export（不接受参数）" };
      }
      // 空会话无可导出内容（buildContext 空 = 连一条消息都没有）。
      // 用户在验收时指出："0 条会话你导出啥"——空文件没有价值，直接报错
      // 比导出一个只有 header 的 JSONL 更诚实（前端据 error 不触发下载）。
      if (inv.api.store.buildContext().length === 0) {
        return { kind: "error", text: "会话为空，没有可导出的内容。" };
      }
      // 门面：真正的下载由前端调 GET /api/chat/export 完成。
      // success 文本是"执行了"的确认，不是下载内容本身。
      return { kind: "success", text: "导出已请求，浏览器将下载会话文件。" };
    },
  };
}
