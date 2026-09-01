// ============================================================
// config.test.ts —— 配置模块（2026-08-25）
// ============================================================
// 测两块：① shouldCompact 的触发阈值逻辑（对齐 pi：接近窗口上限才压）
// ② provider 结构可扩展（不同厂商不同窗口，压缩阈值随 provider 走）。
// 环境变量不在这里测（读取逻辑简单，且 process.env 污染测试难清理）。
// ============================================================

import { describe, expect, it } from "vitest";
import { config, shouldCompact, type ProviderConfig } from "./index";

/** 构造一个"小窗口"的测试 provider（模拟 128K 窗口的某家模型） */
function smallWindowProvider(): ProviderConfig {
  return {
    label: "test-provider",
    baseUrl: "https://example.com",
    model: "test-model",
    contextWindow: 128_000,
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
    keepRecentMessages: 8,
  };
}

describe("shouldCompact —— 压缩触发阈值（对齐 pi：窗口 - 预留）", () => {
  it("未接近窗口上限不触发（DeepSeek 1M 窗口，几轮对话远够不着）", () => {
    // 教学场景几十轮也才几千 token，远小于 1M - 16K → 不压缩
    expect(shouldCompact(50_000, config.provider)).toBe(false);
  });

  it("接近窗口上限才触发（> 窗口 - 预留）", () => {
    // 用 128K 窗口的小 provider：超过 128K - 16K = 112K 才触发
    const provider = smallWindowProvider();
    expect(shouldCompact(110_000, provider)).toBe(false); // 未到阈值
    expect(shouldCompact(115_000, provider)).toBe(true); // 超过 112K → 触发
  });

  it("不同 provider 不同阈值（1M 窗口 vs 128K 窗口）", () => {
    const small = smallWindowProvider();
    // 同一个 token 数，大窗口不触发、小窗口触发
    const tokens = 120_000;
    expect(shouldCompact(tokens, config.provider)).toBe(false); // 1M 窗口：远未到
    expect(shouldCompact(tokens, small)).toBe(true); // 128K 窗口：超了
  });
});

describe("config.provider —— provider 可扩展结构", () => {
  it("默认 provider 是 deepseek（1M 窗口，对齐官方）", () => {
    expect(config.provider.label).toBe("deepseek");
    expect(config.provider.contextWindow).toBe(1_000_000);
  });

  // B18：原「每个 provider 自带压缩参数」测试已删除——它断言的是测试自己
  // 构造的 smallWindowProvider() 字面量（16_384 > 0 恒真），测自己造的数据
  // 没有失败可能，是无效断言。结构完备性已由 shouldCompact 的行为测试
  // （上面第二个 it：110K 不触发 / 115K 触发）间接覆盖——能驱动判断才是真的完备。
});
