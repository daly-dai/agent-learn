// ============================================================
// approval-log.ts —— 审批日志（审计 + 复盘）
// ============================================================
// 抄 CodeWhale approval_log.rs 的核心设计：
//   - 一次审批 = asked（问了）+ decided（答了）两条 receipt
//   - JSONL append-only 追加（崩溃安全：写到哪算哪，不修改历史）
//   - 成对校验（ApprovalReplay）：asked 必须有唯一匹配 decided、
//     无重复 ask、approvalId == toolCallId——日志损坏能发现，不静默
//
// 不做的（方案记录）：锁文件——单进程追加无并发写竞争，
// CodeWhale 的多线程竞争场景我们用不上。
// ============================================================

import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

export type ApprovalPhase = "asked" | "decided";

/** 用户决定（B1-④ 扩展：单次 / 本会话 / 一直允许 都是"允许"的不同信任档） */
export type ApprovalOutcome =
  | "approved" // 单次允许
  | "approved-session" // 本会话允许（内存记忆）
  | "approved-persist" // 一直允许（持久化规则）
  | "denied"
  | "timeout";

/** 一条审批记录：asked（问了）或 decided（答了） */
export type ApprovalReceipt = {
  phase: ApprovalPhase;
  /** 关联 id（== toolCallId，抄 CodeWhale 的关联设计） */
  approvalId: string;
  toolCallId: string;
  toolName: string;
  /** decided 时才有：用户怎么决定的 */
  outcome?: ApprovalOutcome;
  createdAt: string; // ISO 时间
};

/** 日志文件路径：<dir>/<sessionId>.approval.jsonl */
export function approvalLogPath(dir: string, sessionId: string): string {
  return join(dir, `${sessionId}.approval.jsonl`);
}

/** 成对校验结果（抄 CodeWhale ApprovalReplay） */
export type ApprovalReplayResult = {
  completed: { ask: ApprovalReceipt; decided: ApprovalReceipt }[];
  unmatchedAsks: ApprovalReceipt[]; // 问了还没答（中断/进行中，不算错）
  errors: string[]; // 日志损坏证据（重复 ask / 孤儿 decided / id 不匹配）
};

/**
 * 纯函数：对一批 receipt 做成对校验。
 * 规则（抄 CodeWhale ApprovalReplay::from_receipts）：
 *   - approvalId 与 toolCallId 非空且相等
 *   - asked：toolName 非空；不重复（open 或 closed 里已存在 → 错）
 *   - decided：必须有唯一 open 的 ask（没有 → 孤儿决定，错）
 */
export function replayApprovalReceipts(
  receipts: ApprovalReceipt[],
): ApprovalReplayResult {
  const open = new Map<string, ApprovalReceipt>();
  const closed = new Set<string>();
  const completed: ApprovalReplayResult["completed"] = [];
  const errors: string[] = [];

  for (const receipt of receipts) {
    const id = receipt.approvalId;
    if (!id || !receipt.toolCallId || id !== receipt.toolCallId) {
      errors.push(`approval '${id}' 的 approvalId 与 toolCallId 不匹配`);
      continue;
    }
    if (receipt.phase === "asked") {
      if (!receipt.toolName || receipt.toolName.trim().length === 0) {
        errors.push(`approval ask '${id}' 缺 toolName`);
        continue;
      }
      if (closed.has(id) || open.has(id)) {
        errors.push(`approval '${id}' 被问了多次`);
        continue;
      }
      open.set(id, receipt);
    } else {
      const ask = open.get(id);
      if (!ask) {
        errors.push(`approval 决定 '${id}' 没有匹配的 ask`);
        continue;
      }
      // decided 必须带 outcome——outcome 是审计的核心信息（用户怎么答的），
      // 缺了说明日志不完整（fail-closed）
      if (!receipt.outcome) {
        errors.push(`approval 决定 '${id}' 缺 outcome`);
        continue;
      }
      open.delete(id);
      closed.add(id);
      completed.push({ ask, decided: receipt });
    }
  }

  return { completed, unmatchedAsks: [...open.values()], errors };
}

/** 读回一个会话的全部审批记录（文件不存在 → 空数组） */
export async function loadApprovalReceipts(
  dir: string,
  sessionId: string,
): Promise<ApprovalReceipt[]> {
  try {
    const content = await readFile(approvalLogPath(dir, sessionId), "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ApprovalReceipt);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/**
 * 追加一条审批记录（JSONL append-only）。
 * 追加前先校验"现有 + 新记录"能通过成对校验——损坏的日志会被拒绝
 * 写入而不是静默累积（抄 CodeWhale append 前的 replay 校验）。
 */
export async function appendApprovalReceipt(
  dir: string,
  sessionId: string,
  receipt: ApprovalReceipt,
): Promise<void> {
  const existing = await loadApprovalReceipts(dir, sessionId);
  const { errors } = replayApprovalReceipts([...existing, receipt]);
  if (errors.length > 0) {
    throw new Error(`approval log: ${errors[0]}`);
  }
  await mkdir(dir, { recursive: true });
  await appendFile(
    approvalLogPath(dir, sessionId),
    `${JSON.stringify(receipt)}\n`,
    "utf8",
  );
}
