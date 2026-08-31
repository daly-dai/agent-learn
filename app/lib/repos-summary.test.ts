// ============================================================
// app/lib/repos-summary.test.ts —— 更新总结分段解析（C15）
// ============================================================
// 覆盖：落盘日志全文 / 本次 summary.text / 缺段 / commit 提取
// 纯函数，node 环境可测（B8 ①）。
// ============================================================

import { describe, expect, it } from "vitest";
import { parseHighlights, parseSummary } from "./repos-summary";

// 落盘日志全文（LLM 生成的顺序：commit 列表 → 概览 → 重点标注）
const FULL_LOG = `# pi 更新日志（2026-08-31）

新增 2 条提交：

- abc1234 fix: something
- def5678 feat: new thing

---

## 更新概览
这一轮以修复为主。

### 修复
- 修了 X

## ⭐ 重点标注
1. **fix: something**
   值得学：XXX
`;

// 本次 summary.text（无 commit 段、无文件头）
const SUMMARY_TEXT = `## 更新概览
修复为主。

## ⭐ 重点标注
1. **修复 X**
   有借鉴价值。
`;

describe("parseSummary —— 更新总结分段", () => {
  it("落盘日志全文：拆出重点标注/概览/commit 列表", () => {
    const parsed = parseSummary(FULL_LOG);

    // 重点标注（含标题与内容）
    expect(parsed.highlights).toContain("## ⭐ 重点标注");
    expect(parsed.highlights).toContain("**fix: something**");
    // 概览（到 ⭐ 前截止，不含重点标注）
    expect(parsed.overview).toContain("## 更新概览");
    expect(parsed.overview).toContain("修了 X");
    expect(parsed.overview).not.toContain("重点标注");
    // commit 列表（去掉 "- " 前缀）
    expect(parsed.commits).toEqual([
      "abc1234 fix: something",
      "def5678 feat: new thing",
    ]);
  });

  it("本次 summary.text：无 commit 段，概览和重点标注正常拆", () => {
    const parsed = parseSummary(SUMMARY_TEXT);

    expect(parsed.highlights).toContain("**修复 X**");
    expect(parsed.overview).toContain("修复为主");
    expect(parsed.commits).toEqual([]);
  });

  it("只有重点标注：概览为 null", () => {
    const parsed = parseSummary("## ⭐ 重点标注\n1. **A**\n  说明");
    expect(parsed.highlights).toContain("**A**");
    expect(parsed.overview).toBeNull();
    expect(parsed.commits).toEqual([]);
  });

  it("空文本/无标记：全部为空", () => {
    const parsed = parseSummary("随便一段文字");
    expect(parsed.highlights).toBeNull();
    expect(parsed.overview).toBeNull();
    expect(parsed.commits).toEqual([]);
  });

  it("commit 提取：只收新增列表后的行，说明里的连字符不误收", () => {
    const text = `# 标题\n\n一些说明 - 不是提交\n\n新增 3 条提交：\n\n- aaa111 提交1\n- bbb222 提交2\n\n---\n\n## 更新概览\n正文`;
    const parsed = parseSummary(text);
    expect(parsed.commits).toEqual(["aaa111 提交1", "bbb222 提交2"]);
  });
});

describe("parseHighlights —— 重点标注 → 卡片条目", () => {
  const HIGHLIGHTS = `## ⭐ 重点标注
1. **fix: compact before post-tool (#8782)**
   直接关系到上下文管理。
   第二行说明也收进来。
2. **feat: new terminal caps**
   新能力说明。
`;

  it("解析出序号/标题（去 **）/说明（多行合并）", () => {
    const items = parseHighlights(HIGHLIGHTS);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      rank: 1,
      title: "fix: compact before post-tool (#8782)",
      detail: "直接关系到上下文管理。 第二行说明也收进来。",
    });
    expect(items[1]).toEqual({
      rank: 2,
      title: "feat: new terminal caps",
      detail: "新能力说明。",
    });
  });

  it("空段/无序号行 → 空数组（调用方降级整段渲染）", () => {
    expect(parseHighlights("")).toEqual([]);
    expect(parseHighlights("## ⭐ 重点标注\n没有编号的内容")).toEqual([]);
  });

  it("标题里没有 ** 也能解析（LLM 输出格式漂移时容错）", () => {
    const items = parseHighlights("## ⭐ 重点标注\n1. 纯文本标题\n   说明");
    expect(items[0].title).toBe("纯文本标题");
    expect(items[0].detail).toBe("说明");
  });

  it("无标题直接序号行也能解析（LLM 漏输出标题时——重点标注不能丢）", () => {
    // 2026-08-31 实测：LLM 偶发不输出 "## ⭐ 重点标注" 标题，直接给序号行
    const items = parseHighlights(
      "1. **fix: compact before post-tool (#8782)**\n   学习价值：值得学\n   使用价值：可借鉴\n2. **feat: new caps**\n   学习价值：新机制",
    );
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("compact before post-tool");
    expect(items[0].detail).toContain("学习价值");
    expect(items[0].detail).toContain("使用价值");
    expect(items[1].title).toContain("new caps");
  });

  it("整块 markdown 混入概览/commit 不误抓（commit 是 - 开头，概览是 ### 开头）", () => {
    const mixed = `## 更新概览\n修复为主。\n\n### 新功能\n- feat: something\n\n## ⭐ 重点标注\n1. **值得学的点**\n   学习价值：A\n   使用价值：B\n\n新增 3 条提交：\n- abc111 提交1\n- def222 提交2`;
    const items = parseHighlights(mixed);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("值得学的点");
  });
});
