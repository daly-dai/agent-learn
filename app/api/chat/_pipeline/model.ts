// ============================================================
// _pipeline/model.ts —— 模型选择（E2 步骤 3 从 route.ts 拆出）
// ============================================================
// 适配层入口：上层 runAgentLoop 只依赖 TeachingModel 接口，
// 用哪个实现，在这里决定，引擎完全无感。
// provider 可扩展：config.provider 指向当前厂商（默认 deepseek），
// 换厂商 = 换 AI_PROVIDER + 在下面加分支（见 lib/config.ts PROVIDERS）。
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
