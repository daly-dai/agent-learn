// ============================================================
// app/lib/repos-summary.ts —— 更新总结分段解析（C15）
// ============================================================
// 用户阅读优先级（2026-08-31 拍板）：⭐ 重点标注 → 更新概览 → 更新日志。
// 但落盘的 markdown（LLM 生成）顺序是：commit 列表 → 概览 → 重点标注。
// 本模块把整块 markdown 拆成三段，前端按优先级重排渲染。
//
// 输入两种：
//   1. 落盘日志全文（workspace/更新日志/<日期>-<项目>.md）：
//      "# pi 更新日志…\n新增 N 条提交：\n- xxx\n---\n## 更新概览…\n## ⭐ 重点标注…"
//   2. 本次更新的 summary.text（无 commit 段、无标题）：
//      "## 更新概览…\n## ⭐ 重点标注…"
// 输出统一为三段，缺的段为 null/空。
// ============================================================

export type ParsedSummary = {
  /** ⭐ 重点标注 段（含标题，如 "## ⭐ 重点标注\n1. …"）；没有则 null */
  highlights: string | null;
  /** 更新概览 + 分节（新功能/修复/重构）；没有则 null */
  overview: string | null;
  /** commit 列表行（从"新增 N 条提交"提取，如 ["abc1234 msg", …]）；没有则空 */
  commits: string[];
};

/** 从文本中截取 [startMarker, endMarker) 区间；找不到返回 null */
function sliceSection(
  text: string,
  startMarker: string,
  endMarkers: string[],
): string | null {
  const start = text.indexOf(startMarker);
  if (start === -1) return null;
  let end = text.length;
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker, start + startMarker.length);
    if (idx !== -1 && idx < end) end = idx;
  }
  return text.slice(start, end).trim();
}

/** 从"新增 N 条提交：\n- xxx\n- yyy"段提取 commit 行 */
function extractCommits(text: string): string[] {
  // 匹配 "新增 N 条提交：" 后面的 "- " 列表（直到 --- 或 ## 标题）
  const start = text.indexOf("新增");
  if (start === -1) return [];
  const section = sliceSection(text.slice(start), "新增", ["---", "## "]);
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

/**
 * 拆解更新总结 markdown → 三段（重点标注/概览/commit 列表）。
 * 纯函数，可单测（B8 ①）。
 */
export function parseSummary(markdown: string): ParsedSummary {
  const highlights = sliceSection(markdown, "## ⭐ 重点标注", []);
  const overview = sliceSection(markdown, "## 更新概览", ["## ⭐"]);
  const commits = extractCommits(markdown);
  return { highlights, overview, commits };
}

// ------------------------------------------------------------
// 重点标注 → 卡片条目（页面签名元素的数据基础）
// ------------------------------------------------------------

/** 一条重点标注（卡片渲染用） */
export type HighlightItem = {
  /** 序号（LLM 按重要程度排序，1 最重要） */
  rank: number;
  /** 标题（去掉 ** 加粗标记后的纯文本） */
  title: string;
  /** 说明正文（多行合并，保留 markdown 格式给 <Markdown> 渲染） */
  detail: string;
};

/**
 * 把更新总结 markdown 解析成重点标注卡片条目。
 * LLM 输出格式（summarize.ts 的 prompt 规定）：
 *   ## ⭐ 重点标注
 *   1. **标题**\n   说明
 *   2. **标题**\n   说明
 *
 * 直接扫整块 markdown 的 "N. " 行，**不依赖标题定位**（2026-08-31 修：
 * LLM 偶发不输出 "## ⭐ 重点标注" 标题——缺 ⭐/层级变体，精确匹配会失败 →
 * 重点标注消失 → 降级成原始 markdown，用户看到"鬼"）。
 * 安全：commit 行是 "- xxx"、概览分节是 "### xxx"、"### 新功能\n- xxx"，
 * 都不会误匹配 ^\d+\.\s+；只有真正的序号条目会被捕获。
 * 没有序号行 → 空数组（调用方降级整块渲染）。
 */
export function parseHighlights(markdown: string): HighlightItem[] {
  const lines = markdown.split("\n");
  const items: HighlightItem[] = [];
  let current: { rank: number; title: string; detail: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const match = /^(\d+)\.\s+(.*)$/.exec(line.trim());
    if (match) {
      // 新条目开始：先把上一条收尾
      if (current) {
        items.push({
          rank: current.rank,
          title: current.title,
          detail: current.detail.join(" ").trim(),
        });
      }
      current = {
        rank: Number(match[1]),
        title: match[2].replace(/\*\*/g, "").trim(),
        detail: [],
      };
    } else if (current) {
      // 续行：说明正文（空行/缩进行都收，最后 join 时 trim）
      current.detail.push(line.trim());
    }
  }
  // 收尾最后一条
  if (current) {
    items.push({
      rank: current.rank,
      title: current.title,
      detail: current.detail.join(" ").trim(),
    });
  }
  return items;
}
