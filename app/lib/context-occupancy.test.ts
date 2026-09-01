// ============================================================
// context-occupancy.test.ts —— 上下文占用纯函数（抄 DSH spec 用例）
// ============================================================
// 用例直接对齐 DSH `ui-conversation/tests/context-meter.client.spec.tsx`：
// projected 优先 / 无 projected 用当前 / 无分子 null / 超窗封顶。
// ============================================================

import { describe, expect, it } from "vitest";
import { contextOccupancy } from "./context-occupancy";

describe("contextOccupancy —— 上下文占用计算（DSH 同款）", () => {
  it("有 projectedTokens 时优先于 pressureTokens（预测占用）", () => {
    expect(
      contextOccupancy({
        pressureTokens: 32_000,
        projectedTokens: 6_000,
        contextWindow: 128_000,
      }),
    ).toEqual({ percent: 5, usedTokens: 6_000, contextWindow: 128_000 });
  });

  it("无 projectedTokens 时用当前 pressureTokens", () => {
    expect(
      contextOccupancy({
        pressureTokens: 32_000,
        contextWindow: 128_000,
      }),
    ).toEqual({ percent: 25, usedTokens: 32_000, contextWindow: 128_000 });
  });

  it("只有容量没有分子 → null（组件不渲染）", () => {
    expect(contextOccupancy({ contextWindow: 128_000 })).toBeNull();
  });

  it("分子超过窗口 → percent 封顶 100（不爆表）", () => {
    expect(
      contextOccupancy({
        pressureTokens: 300_000,
        contextWindow: 128_000,
      }),
    ).toEqual({ percent: 100, usedTokens: 300_000, contextWindow: 128_000 });
  });

  it("pressure 未定义 → null", () => {
    expect(contextOccupancy(undefined)).toBeNull();
  });
});
