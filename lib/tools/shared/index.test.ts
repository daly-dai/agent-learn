// ============================================================
// shared.test.ts —— 工具共享纯函数
// ============================================================

import { describe, expect, it } from "vitest";
import { countOccurrences, escapeRegExp, truncate } from ".";

describe("truncate —— 长文本截断", () => {
  it("短文本原样返回", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("恰好等于上限不截断", () => {
    expect(truncate("abcdef", 6)).toBe("abcdef");
  });

  it("超限截断并提示差额", () => {
    expect(truncate("abcdef", 3)).toBe("abc\n... [截断 3 字符]");
  });
});

describe("countOccurrences —— 非重叠计数", () => {
  it("无匹配返回 0", () => {
    expect(countOccurrences("abc", "x")).toBe(0);
  });

  it("单次匹配", () => {
    expect(countOccurrences("abc", "b")).toBe(1);
  });

  it("多次匹配", () => {
    expect(countOccurrences("a-b-a", "a")).toBe(2);
  });

  it("重叠不计（'aa' 在 'aaa' 中只算 1 次）", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1);
  });
});

describe("escapeRegExp —— 正则特殊字符转义", () => {
  it("点号被转义", () => {
    expect(escapeRegExp("a.b")).toBe("a\\.b");
  });

  it("星号被转义", () => {
    expect(escapeRegExp("a*b")).toBe("a\\*b");
  });

  it("组合特殊字符", () => {
    expect(escapeRegExp("(x)[y]{z}?")).toBe("\\(x\\)\\[y\\]\\{z\\}\\?");
  });

  it("普通文本不受影响", () => {
    expect(escapeRegExp("hello")).toBe("hello");
  });
});
