// ============================================================
// lib/selectModel.ts —— 模型选择（E2 步骤 3 从 route.ts 拆出，C15 下沉到 lib）
// ============================================================
// 适配层入口：上层 runAgentLoop 只依赖 TeachingModel 接口，
// 用哪个实现，在这里决定，引擎完全无感。
// provider 可扩展：config.provider 指向当前厂商（默认 deepseek），
// 换厂商 = 换 AI_PROVIDER + 在下面加分支（见 lib/config.ts PROVIDERS）。
//
// 为什么在 lib 不在 app（2026-08-31 C15 下沉）：
//   模型选择是内核职责（适配层入口），但原来放在 app/api/chat/_pipeline/
//   下。C15 的 lib/repos/summarize.ts 也要用 selectModel——lib 依赖 app
//   是反向依赖。下沉到 lib/ 后，chat route 和 repo updater 都能用。
//   原 _pipeline/model.ts 保留为转发（不破坏既有 import）。
// ============================================================

import { MockModel } from "@/lib/mockModel";
import { DeepSeekModel } from "@/lib/deepseekModel";
import type { TeachingModel } from "@/lib/model";
import { config } from "@/lib/config";

export function selectModel(): { model: TeachingModel; label: string } {
  if (config.modelSecrets.mockMode) {
    return { model: new MockModel(), label: "mock" };
  }

  const apiKey = config.modelSecrets.apiKey;

  if (!apiKey || apiKey === "sk-your-key-here") {
    throw new Error(
      "未配置 DEEPSEEK_API_KEY。请在 .env.local 填入真实 key 并把 MOCK_MODE 改为 false，或保持 MOCK_MODE=true 使用离线教学模式。",
    );
  }

  const model = new DeepSeekModel({
    apiKey,
    baseUrl: config.provider.baseUrl,
    model: config.provider.model,
  });

  return { model, label: config.provider.label };
}
