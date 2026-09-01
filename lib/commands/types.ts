// ============================================================
// lib/commands/types.ts —— 斜杠命令的类型定义（C13）
// ============================================================
// 与 index.ts（注册表逻辑）分离：本文件只有类型，无运行时逻辑。
// 纯类型、零依赖（仅 type-only import），可被前端安全引用。
// 命令模型的来源（抄谁）见 index.ts 头注释。
// ============================================================

import type { JsonlSessionStore } from "@/lib/session";
import type { TeachingModel } from "@/lib/model";

/** 命令来源分类（统一入口预留：未来 skill 进面板） */
export type CommandSource = "builtin" | "skill";

/**
 * 命令结果。抄 DSH CommandResult：
 * success 可带 sourceEventSeq 指向"更权威的域事件"——/compact 返回
 * 压缩摘要事件序号，UI 据此渲染富卡片而非只显示 text。
 */
export type CommandResult =
  | { kind: "success"; text?: string; sourceEventSeq?: number }
  | { kind: "error"; text: string };

/** 命令执行时可用到的服务端能力（app 层组装时注入；前端命令不用即可） */
export interface CommandApi {
  /** 当前会话存储（/compact 的准备/落盘） */
  readonly store: JsonlSessionStore;
  /** 模型（/compact 生成摘要） */
  readonly model: TeachingModel;
}

/** 传给命令 handler 的调用上下文（Q3：统一 async handler + api 通道） */
export interface CommandInvocation {
  /** 命令名后的参数（已 trim，codex parse_slash_name 的 rest） */
  readonly rawInput: string;
  /** 取消信号：命令可响应 abort（DSH invocation.signal） */
  readonly signal: AbortSignal;
  /** 服务端能力通道 */
  readonly api: CommandApi;
}

/** 一条命令定义（注册表条目） */
export interface SlashCommand {
  /** 命令名（不含前导斜杠，小写字母开头） */
  name: string;
  /** 发现 UI 显示的人类可读摘要 */
  description: string;
  /** 来源分类（统一入口预留） */
  source: CommandSource;
  /** 别名：只认不显（codex ALIAS_COMMANDS） */
  aliases?: readonly string[];
  /** 是否接受行内参数（元数据给前端提示；执行语义由 handler 自判） */
  supportsInlineArgs?: boolean;
  /** 参数占位提示（DSH input.hint 同款） */
  inputHint?: string;
  /** 条件显示门控（codex flags；默认全可用） */
  available?(api: CommandApi): boolean;
  /** 执行动作，不走模型（DSH：without sending the command to the model） */
  handler(
    invocation: CommandInvocation,
  ): CommandResult | Promise<CommandResult>;
}

/** 前端安全的元数据视图（不含 handler，list 的返回类型） */
export type CommandDescriptor = Omit<SlashCommand, "handler" | "available">;
