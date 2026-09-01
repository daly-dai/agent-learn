// ============================================================
// _pipeline/model.ts —— 模型选择（转发层，实现已下沉 lib/selectModel.ts）
// ============================================================
// C15（2026-08-31）：selectModel 从本文件移到 lib/selectModel.ts——
// lib/repos/summarize.ts 也要用它，lib 依赖 app 是反向依赖。
// 本文件保留转发，chat route 的既有 import 不受影响。
//
// selectModelSafe：把"选择失败 → 抛错"包成 Result 风格返回值——
// route.ts POST 与 command route 都要"缺 key 时返回 400 而非崩服务端"，
// 两处重复 try/catch，抽到这里统一。
// ============================================================

import { selectModel } from "@/lib/selectModel";
import type { TeachingModel } from "@/lib/model";

/** 模型选择结果（safe 版）：失败不抛错，返回 error 文案让 route 转 400 */
export type SelectModelResult =
  | { ok: true; model: TeachingModel; label: string }
  | { ok: false; error: string };

/** 选模型（safe）：MOCK_MODE 用离线 Mock，否则真实 DeepSeek；缺 key → error */
export function selectModelSafe(): SelectModelResult {
  try {
    const selected = selectModel();
    return { ok: true, model: selected.model, label: selected.label };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
