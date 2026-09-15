// ============================================================
// render —— 把一次抓取变成「模型可见文本」
// ============================================================
// 输入是**已经转换好的正文**，输出是给模型看的那一整段字符串。
// 本模块**不做网络、不做 HTML 转换**——那两件事分别在 `fetcher/` 和
// `html-to-text/`，各自有单测。这里只剩纯字符串变换，所以它 0 依赖：
// 没有 fetch 桩、没有临时目录、没有网络。
//
// ⭐ 排版规则（照 DSH，出处见 doc/plan/a5-web-search.md §7.6.3 #16 / #17）：
//
//     Fetched <最终地址> (HTTP <状态码>)
//
//     <不可信声明>
//
//     <正文>
//     [+ 截断提示]
//
//   - **截断时 footer 必须保住**：它是"下一步怎么办"的提示，比正文尾部更值钱
//   - `truncated` 是**有效截断**（含上游的字节截断、转换截断），
//     不是"抓取层的 truncated"——否则给模型看的文本和报出去的标志会对不上
//
// ⚠️ 诚实边界：`EXTERNAL_CONTENT_NOTICE` 是**标注，不是隔离**。
// 它只是拼进给模型的一段话，没有任何强制力；模型听不听我们管不住。
// 别把它当安全机制汇报（DSH 对 prompt injection 的全部机制也就是这一行字，
// 见其 `tool-web/src/trust.ts` 全文 7 行）。
// ============================================================

import { EXTERNAL_CONTENT_NOTICE } from "../../shared";

/** 这段响应能当文本用吗；能的话走哪个转换器 */
export type ContentKind = "html" | "text" | "unsupported";

/**
 * 判定 content-type 属于哪一类。
 *
 * 判据是「**能不能解码成文本**」，不是「能不能下载」——所以图片、PDF
 * 直接判不支持，不做"反正字节也拿到了，凑合塞给模型"的将就。
 * （DSH `web-fetch-http/src/policy.ts:78-84` 同款白名单。）
 */
export function classifyContentType(contentType: string): ContentKind {
  // 先剥掉 `; charset=utf-8` 这类参数。**这一行最容易写漏**：
  // 真实站点绝大多数都带参数，不剥的话带参数的 text/html 会掉进
  // unsupported，于是几乎所有正常网页都抓不了。
  // （不用正则：`split(";", 1)` 一眼看得出是"取分号前那一段"。）
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();

  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("text/")) return "text";
  // `+json` / `+xml` 是结构化文本的**后缀约定**（application/vnd.api+json、
  // application/atom+xml …），这一类列举不完，只能靠后缀认。
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  ) {
    return "text";
  }
  return "unsupported";
}

/** 截断提示。截断时它比正文尾部更该留下：它告诉模型下一步怎么办。 */
const TRUNCATION_FOOTER =
  "\n\n（内容已截断。要读全文，请抓一个更具体的 URL，或换一个内容更集中的页面。）";

export type RenderFetchInput = {
  /** **最终**地址（重定向之后），不是模型给的那个 */
  url: string;
  status: number;
  /** 已按 kind 转换好的正文（html → Markdown；text → 原文） */
  body: string;
  /** 上游任一环节已经截断过（抓取的字节上限 / HTML→Markdown 的字符上限） */
  bodyTruncated: boolean;
  /** 完整输出（头 + 声明 + 正文 + footer）的字符上限 */
  maxChars: number;
};

export function renderFetchOutput(input: RenderFetchInput): {
  text: string;
  truncated: boolean;
} {
  const header =
    `Fetched ${input.url} (HTTP ${input.status})\n\n` +
    `${EXTERNAL_CONTENT_NOTICE}\n\n`;
  const prefix = `${header}${input.body}`;

  // `prefix.length > maxChars` 也必须算截断。漏掉它的话，"整体超限"
  // 这条路径会在下面拼 footer 时把内容挤掉，而 `truncated` 还是 false——
  // 报出去的标志就和模型看到的文本对不上了。
  const truncated = input.bodyTruncated || prefix.length > input.maxChars;
  const full = `${prefix}${truncated ? TRUNCATION_FOOTER : ""}`;

  if (full.length <= input.maxChars) return { text: full, truncated };

  // 上限比 footer 还小时，拼 footer 只会把正文挤没。此时宁可**只切、不给提示**，
  // 至少让模型看到开头。（DSH `tool-web/src/fetch.ts:335` 同款分支。）
  if (input.maxChars < TRUNCATION_FOOTER.length) {
    return { text: full.slice(0, input.maxChars), truncated };
  }
  return {
    text: `${prefix.slice(0, input.maxChars - TRUNCATION_FOOTER.length)}${TRUNCATION_FOOTER}`,
    truncated,
  };
}
