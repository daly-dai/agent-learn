// ============================================================
// lib/commands/compact/index.ts —— /compact 命令 + 手动压缩共享逻辑
// ============================================================
// 抄谁、为什么抄：
//   - compactNow ← DSH command-compact（packages/compaction/command-compact）：
//     "Human-facing /compact command"——手动压缩无条件切点（maxTokens=0，
//     用户主动要求，不走自动路径的阈值/经济性判断）
//   - 摘要+落盘抽 summarizeAndCommit 共享 ← maybeCompact（自动）与
//     compactNow（手动）同一套"调模型生成摘要/失败降级拼贴/落盘"，
//     避免两处重复（对齐 DSH compactIfNeeded / compactNow 共享底层）
//   - 带参数报 USAGE ← DSH executeCompact：`invocation.rawInput.trim().length > 0`
//     → error（/compact 不接受参数）
//   - 无可压历史返回 success（不报错）← DSH：`result === null`
//     → "No compactable history yet."
// 目录结构（AGENTS.md 6.5）：实现 + 单测同目录，index.ts 当入口
// （对齐 lib/tools/ 每工具一目录先例）。
// ============================================================

import { config, compactKeepRecent } from "@/lib/config";
import {
  summarizeEntries,
  type CompactionEntry,
  type CompactionPreparation,
  type JsonlSessionStore,
} from "@/lib/session";
import { generateSummary } from "@/lib/summarize";
import type { TeachingModel } from "@/lib/model";
import type { SlashCommand } from "../types";

/**
 * 共享：生成摘要（MOCK/失败降级拼贴）+ 落盘 compaction entry。
 * maybeCompact（自动）与 compactNow（手动）共用——摘要逻辑只有一份。
 */
export async function summarizeAndCommit(
  store: JsonlSessionStore,
  model: TeachingModel,
  prep: CompactionPreparation,
  signal: AbortSignal,
): Promise<CompactionEntry> {
  let summary: string;
  if (config.modelSecrets.mockMode) {
    // 离线教学：不调模型，拼贴降级（信息还在，只是不省 token）
    summary = summarizeEntries(prep.messagesToSummarize);
  } else {
    // 真实模型：结构化摘要；失败降级拼贴（压缩是"防爆窗"，失败不能拖垮）
    summary =
      (await generateSummary(model, prep.messagesToSummarize, {
        previousSummary: prep.previousSummary,
        signal,
      })) ?? summarizeEntries(prep.messagesToSummarize);
  }
  return store.commitCompaction(prep, summary);
}

/** 手动压缩的结果（命令文案 + 前端卡片用） */
export type CompactOutcome = {
  entry: CompactionEntry;
  /** 被压进摘要的消息条数 */
  summarizedCount: number;
  /**
   * 本次压掉的 token 数（待压区 token，不是压缩前上下文总数）。
   * 对齐 DSH shadowedTokenCount：文案说"本次压了多少"，
   * 不能拿 tokensBefore（整个上下文含历史摘要）误导用户。
   */
  tokensSummarized: number;
};

/**
 * 手动压缩一次（无条件切点）：准备 → 摘要 → 落盘。
 * @returns 无可压历史（空会话 / 待压区为空）时返回 null——
 *   待压区为空 = 上次压缩后没有新消息，再压是空转（压 0 条），
 *   应报"没有可压缩的历史"而不是执行一次空压缩。
 */
export async function compactNow(
  store: JsonlSessionStore,
  model: TeachingModel,
  signal: AbortSignal,
): Promise<CompactOutcome | null> {
  // maxTokens=0：任何非空上下文都超过阈值 → 无条件压（手动语义）
  const prep = store.prepareCompaction(0, compactKeepRecent());
  if (prep === undefined || prep.messagesToSummarize.length === 0) return null;
  const entry = await summarizeAndCommit(store, model, prep, signal);
  return {
    entry,
    summarizedCount: prep.messagesToSummarize.length,
    tokensSummarized: prep.tokensToSummarize,
  };
}

/** /compact 命令定义（注册进 lib/commands 注册表） */
export function createCompactCommand(): SlashCommand {
  return {
    name: "compact",
    description: "手动压缩当前会话的历史消息",
    source: "builtin",
    handler: async (inv) => {
      if (inv.rawInput.trim().length > 0) {
        return { kind: "error", text: "用法: /compact（不接受参数）" };
      }
      const outcome = await compactNow(inv.api.store, inv.api.model, inv.signal);
      if (outcome === null) {
        return { kind: "success", text: "没有可压缩的历史。" };
      }
      return {
        kind: "success",
        text: `已压缩 ${outcome.summarizedCount} 条消息（本次压掉约 ${outcome.tokensSummarized} tokens）。`,
      };
    },
  };
}
