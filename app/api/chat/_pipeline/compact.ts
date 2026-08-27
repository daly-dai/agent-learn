// ============================================================
// _pipeline/compact.ts —— 上下文压缩触发（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 三步走，对齐 pi 的 prepareCompaction → compact → 落盘：
//   ① 纯计算准备（切点/待压消息/旧摘要，不碰模型）
//   ② 调模型生成结构化摘要（MOCK 或失败 → 降级拼贴，保信息）
//   ③ 落盘 compaction entry（成为新叶子）
// 阈值按 provider 的上下文窗口算（DeepSeek V4 是 1M 窗口，
// 几十上百轮才触发）；经济性检查（Reasonix D6）：要压的区域
// 太小（低于 config 阈值）就不压——省下的 token 不够抵消一次
// 摘要 API 调用的成本。
// ============================================================

import type { JsonlSessionStore } from "@/lib/session";
import { summarizeEntries } from "@/lib/session";
import { generateSummary } from "@/lib/summarize";
import type { TeachingModel } from "@/lib/model";
import { config, compactKeepRecent } from "@/lib/config";

export async function maybeCompact(params: {
  store: JsonlSessionStore;
  model: TeachingModel;
  signal: AbortSignal;
  onCompacting: (tokensBefore: number) => void;
}): Promise<void> {
  const prep = params.store.prepareCompaction(
    config.provider.contextWindow - config.provider.reserveTokens,
    compactKeepRecent(),
  );
  if (!prep || prep.tokensToSummarize < config.agent.minCompactTokens) {
    return;
  }

  // 压缩开始：先推 compacting 帧，让前端知道"后端在忙压缩"，不是卡死。
  // 压缩（尤其调模型生成摘要）耗时几秒~几十秒，这段时间 SSE 无其他帧。
  params.onCompacting(prep.tokensBefore);
  let summary: string;
  if (config.modelSecrets.mockMode) {
    // 离线教学：不调模型，拼贴降级（信息还在，只是不省 token）
    summary = summarizeEntries(prep.messagesToSummarize);
  } else {
    // 真实模型：结构化摘要；失败降级拼贴（压缩是"防爆窗"，失败不能拖垮对话）
    summary =
      (await generateSummary(params.model, prep.messagesToSummarize, {
        previousSummary: prep.previousSummary,
        signal: params.signal,
      })) ?? summarizeEntries(prep.messagesToSummarize);
  }
  await params.store.commitCompaction(prep, summary);
}
