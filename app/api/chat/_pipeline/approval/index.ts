// ============================================================
// _pipeline/approval.ts —— 工具审批决策纯函数（E2 步骤 2）
// ============================================================
// 从 route.ts handleToolApproval 提炼：把"决策"和"副作用"分开。
//   - decideToolCall(call, ctx) → ToolDecision：纯决策（同输入必同输出）
//   - 副作用（推确认帧、写审批日志）留在 route 壳 / approve 接口
//
// 为什么外部依赖全注入 ctx（不直接 import）：
//   记忆判定碰文件（isPersistApproved）、审批模式是模块状态
//   （getApprovalMode）——直接 import 会让函数依赖全局，不可测。
//   注入后函数纯，单测传 stub 即可（E1 误报教训的解药：
//   决策逻辑从"组装层不可测"变成"决策层可测"）。
// ============================================================

import type { ToolCallContent } from "@/lib/types";
import type { ToolDecision } from "@/lib/agent";

/** 用户在弹框里的选择：前三种都是"允许"，只是信任期限不同（类型住 lib，这里转出给路由用） */
export type { ApprovalOutcome } from "@/lib/permission/approval-outcome";

/**
 * decideToolCall 的返回类型：ToolDecision 三选一（allow/block/rewrite）+ request。
 * request = "需要人工确认"——副作用（推帧/日志）由调用方执行，
 * 因为 request 不是引擎能理解的结果，引擎只见最终三选一。
 */
export type ApprovalDecision =
  | ToolDecision
  // request 无 reason：调用方（route 壳）自己知道要做什么副作用
  | { action: "request" };

/** 需要人工确认的工具：全部写/改/删操作 + bash（已确认：全量弹框） */
const TOOLS_NEEDING_CONFIRM = [
  "write_note",
  "write_file",
  "edit_file",
  "delete_file",
  "bash",
] as const;

/** decideToolCall 的外部依赖（注入，测试传 stub） */
export type ApprovalContext = {
  sessionId: string;
  sessionDir: string;
  getApprovalMode: () => "suggest" | "bypass" | "never";
  isReadOnlyBash: (command: string) => boolean;
  isPersistApproved: (dir: string, toolName: string) => Promise<boolean>;
  isSessionApproved: (sessionId: string, toolName: string) => boolean;
};

/**
 * 纯决策：一次工具调用该放行/拦截/弹框/改写。
 * 不推帧、不写日志、不碰全局——副作用留给调用方。
 *
 * 这里只做**编排**：三条分支各有一件事、各有一个名字（硬性策略 /
 * 分级模式 / 人工确认），细节在下面那几个小函数里。
 */
export async function decideToolCall(
  call: ToolCallContent,
  ctx: ApprovalContext,
): Promise<ApprovalDecision> {
  // --- 硬性策略：secret/秘密 永不弹框，直接拦 ---
  const secretBlock = blockSecretWrite(call);
  if (secretBlock) return secretBlock;

  // --- 分级模式（抄 pi defaultProjectTrust / CodeWhale approval_mode）---
  const needsConfirm = (TOOLS_NEEDING_CONFIRM as readonly string[]).includes(
    call.name,
  );
  const approvalMode = ctx.getApprovalMode();
  if (approvalMode === "bypass") {
    // YOLO：除硬性策略外全部放行（没有"人机确认"过程，不记日志）
    return { action: "allow" };
  }
  if (approvalMode === "never" && needsConfirm) {
    return {
      action: "block",
      reason: "当前审批模式为 never：需人工确认的工具直接拒绝。",
    };
  }

  // --- 人工确认（suggest 默认）---
  if (needsConfirm) return confirmOrRequest(call, ctx);

  return applyDefaultArguments(call);
}

/**
 * 硬性策略：写文件类工具的目标里出现 secret/秘密 → 永不弹框，直接拦。
 * 不需要拦时返回 undefined，调用方继续往下走。
 */
function blockSecretWrite(call: ToolCallContent): ApprovalDecision | undefined {
  if (call.name !== "write_note" && call.name !== "write_file") {
    return undefined;
  }

  // 取要检查的路径：write_note 用 fileName，write_file 用 path。
  // 不用嵌套三元——两层 ? : 叠在一起难读，if/else 直白。
  let target = "";
  if (typeof call.arguments.fileName === "string") {
    target = call.arguments.fileName;
  } else if (typeof call.arguments.path === "string") {
    target = call.arguments.path;
  }

  if (!/secret|秘密/i.test(target)) return undefined;

  return {
    action: "block",
    reason: "权限策略：不允许写入包含 secret/秘密 的文件。",
  };
}

/**
 * 需人工确认的工具（suggest 模式）：能证明安全就放行，否则弹框。
 * 判定顺序 = 信任强度从高到低：只读 bash → 持久记忆 → 会话记忆 → 弹框。
 */
async function confirmOrRequest(
  call: ToolCallContent,
  ctx: ApprovalContext,
): Promise<ApprovalDecision> {
  // 只读命令放行：bash 静态分析证明只读 → 不弹框直接执行。
  if (call.name === "bash") {
    const command =
      typeof call.arguments.command === "string" ? call.arguments.command : "";
    if (ctx.isReadOnlyBash(command)) {
      return { action: "allow" };
    }
  }

  // 记忆放行：一直允许（磁盘规则）→ 本会话允许（内存记忆）。
  if (await ctx.isPersistApproved(ctx.sessionDir, call.name)) {
    return { action: "allow" };
  }
  if (ctx.isSessionApproved(ctx.sessionId, call.name)) {
    return { action: "allow" };
  }

  // 需要弹框：返回 request，由调用方推帧 + 等用户决定
  return { action: "request" };
}

/** 无需确认的工具：list_files 缺 path 时补默认值，其余直接放行 */
function applyDefaultArguments(call: ToolCallContent): ApprovalDecision {
  // list_files 没有 path 参数时补齐默认值
  if (call.name === "list_files" && typeof call.arguments.path !== "string") {
    return {
      action: "rewrite",
      args: { ...call.arguments, path: "." },
      reason: "补齐默认目录参数。",
    };
  }

  return { action: "allow" };
}
