// ============================================================
// html-to-text —— HTML → Markdown
// ============================================================
// 转换引擎是 **turndown + GFM 插件**（轮子用库，用户 08-26 拍板）；
// 本模块负责外面那圈**能出事的活**：
//
//   ① **深度守卫**——超深嵌套早退，给出明确原因（见下面"实测依据"）
//   ② **输出限额**——不能把整篇正文灌进模型上下文
//   ③ **失败兜底**——转换器抛错必须变成明确失败，不能漏给上层
//   ④ **丢弃不可见内容**——见下面那一段
//
// ⭐ 为什么"丢弃不可见内容"是必需品（不是锦上添花，2026-09-14 补）：
//
//   **turndown 默认会保留元素的文字内容**——它只认标签语义，不认这些内容
//   在浏览器里根本看不见。而真实网页里"看不见但有文字"的东西极多：
//   给 SEO / 屏幕阅读器准备的文本、折叠起来的评论区、cookie 弹窗、
//   内联样式藏起来的整块内容。这些**全都会被转成 Markdown 塞进模型上下文**，
//   把真正要读的正文挤走。
//
//   ⚠️ 这一条**是抄 DSH 的**（`tool-web/src/fetch.ts` 的 `removeNonVisibleContent`
//   规则）——而且是一次**补抄**：我们当初抄了它的 turndown 配置
//   （headingStyle / codeBlockStyle / bulletListMarker / GFM 插件），
//   却把紧跟在下面这条规则整个漏了（见详案 §7.14）。
//   原来我们只有 `remove(["script","style","noscript"])` 三个标签，比它粗得多。
//
//   ⚠️ 没抄它的另一半：DSH 的规则里只判"不可见"，**没有**删 nav / footer / aside。
//   opencode 的 `webfetch.ts` 也只删 `script/style/meta/link`。
//   **两个成熟项目都不按标签删导航**——那是有风险的（正文可能就住在里面），
//   所以我们也不做（曾提过，撤回，理由记在详案 §7.14）。
//
// ⭐ 深度守卫的**实测依据**（2026-09-14 本地探针，不是照抄 DSH）：
//
//     depth    100 →   2.4ms     2000 →  RangeError（56~82ms 后抛）
//     depth    500 →  14.4ms    10000 →  RangeError（0.9~1.1s 后抛）
//     depth   1000 → 17~41ms    20000 →  RangeError（**3.3~4.4s** 后抛！）
//
//   - DSH 说"domino 树遍历是超线性的、恶意页面能**卡死**同步转换"——
//     严格讲**不准确**：它是**抛错**（RangeError），不是挂死。但**照样致命**：
//     20000 层正好落在我们 1MiB 抓取上限之内，它要**同步跑 3~4 秒**才抛，
//     在 Next.js 服务端 = **阻塞事件循环 3~4 秒**。这就是守卫真正的理由。
//   - ⚠️ **抛出点随栈大小变**：主线程实测 ~2000 层就抛，而 vitest 的 worker
//     线程栈更大、3000 层仍能转完。所以别把"2000"当成常量记。
//   - 门槛取 512：实测 500 层只要 14ms、1000 层也才 17~41ms，离风险区很远，
//     而真实网页极少超过几十层 → 既不会误伤真页面，又能**在 0ms 就拒掉**病态输入。
//
// ⚠️ 守卫是**字符串级粗扫**（`measureTagDepth`），会低估真实嵌套（比如标签由
//   脚本动态拼出来）。所以 `turndown` 那一步**必须**包 try/catch——守卫是优化，
//   兜底才是保证。
// ============================================================

import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

const DEFAULT_MAX_CHARS = 200_000; // 抄 DSH 的 DEFAULT_FETCH_MAX_OUTPUT_CHARS
const DEFAULT_MAX_DEPTH = 512; // 见文件头"实测依据"

/** HTML 里没有闭合标签、不占栈深的元素（省得把 <br> 当成一层） */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 内容是**原始文本**、里面的 `<div>` 只是字符串的元素（不按标签扫） */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/**
 * 文字**看得见但对人没用**的标签——连内容一起整块丢掉。
 * `nodeName` 在 HTML 文档里是大写（domino 与浏览器一致），见 `isNonVisible`。
 */
const NON_VISIBLE_ELEMENTS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED",
]);

export type HtmlToTextDeps = {
  /** 注入点：HTML→Markdown 转换器（默认 turndown + GFM）。
   *  为什么留这个口子：下面那条 try/catch 是**兜底**，而它要防的
   *  "转换器抛错"**没法用真实 HTML 稳定复现**——实测抛出点随栈大小变
   *  （主线程 2000 层，vitest worker 里 3000 层还不抛）。环境相关的测试
   *  比没有测试更糟：它给人虚假的覆盖感。所以让测试直接注入一个会抛的转换器。 */
  convert?: (html: string) => string;
  maxChars?: number;
  maxDepth?: number;
};

export type HtmlToTextResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: "too-deep" | "convert-failed"; detail: string };

// 转换器建一次就复用（建实例要装规则，不便宜）。
// 实测复用不改变行为，而且更快（1000 层：fresh 40.6ms → cached 16.9ms）。
let cachedService: TurndownService | undefined;

function getService(): TurndownService {
  if (!cachedService) {
    const service = new TurndownService({
      headingStyle: "atx", // # 标题，不是下划线式
      codeBlockStyle: "fenced", // ``` 代码块，不是缩进式
      bulletListMarker: "-",
    });
    service.use(gfm); // 表格 / 删除线 / 任务列表
    // 整块丢掉不可见内容。**不能只用 `service.remove(["script","style"])`**：
    // turndown 默认保留元素的文字，而"看不见"还有另外三种表达方式
    // （`hidden` 属性 / `aria-hidden` / 内联样式），它们都要一起判。
    service.addRule("removeNonVisibleContent", {
      filter: isNonVisible,
      replacement: () => "",
    });
    cachedService = service;
  }
  return cachedService;
}

/**
 * 这个元素是不是**整块不可见**——是的话连它的文字一起丢掉。
 *
 * 四类判据，缺一不可（真实页面里这四种写法都在用）：
 *   ① 标签本身就不可见：`<script>` / `<style>` / `<template>` / `<iframe>` …
 *   ② `hidden` 属性：折叠面板、按条件渲染但已进了 DOM 的区块
 *   ③ `aria-hidden="true"`：屏幕阅读器专用文本、图标字体、装饰性元素
 *   ④ **内联样式 `display:none` / `visibility:hidden`**：SEO 隐藏文本、
 *      折叠的评论区、cookie 弹窗——**这一类在真实网页里量最大**
 *
 * ⚠️ 与 DSH 的一处**刻意差异**：它的规则里还判 `input[type=hidden]`，
 *    我们**没抄这一条**——`<input>` 没有文本内容，turndown 对它本来就不输出，
 *    那个分支在我们这儿是**永远不会改变结果的死代码**。
 *    （AGENTS §10.8：没有消费者的机制不搬。）
 */
function isNonVisible(node: HTMLElement): boolean {
  if (NON_VISIBLE_ELEMENTS.has(node.nodeName)) return true;
  if (node.hasAttribute("hidden")) return true;
  if (node.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;
  return hasHiddenStyle(node.getAttribute("style"));
}

/** 内联样式里有没有 `display:none` / `visibility:hidden|collapse`（含 `!important`） */
function hasHiddenStyle(style: string | null): boolean {
  if (!style) return false;

  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue; // 没有冒号就不是一条声明，跳过

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration
      .slice(separator + 1)
      .trim()
      .toLowerCase()
      .replace(/\s*!important\s*$/, ""); // 去掉 !important 再比

    if (property === "display" && value === "none") return true;
    if (property === "visibility" && (value === "hidden" || value === "collapse")) {
      return true;
    }
  }
  return false;
}

function defaultConvert(html: string): string {
  return getService().turndown(html);
}

export function htmlToText(
  html: string,
  deps: HtmlToTextDeps = {},
): HtmlToTextResult {
  const convert = deps.convert ?? defaultConvert;
  const maxChars = deps.maxChars ?? DEFAULT_MAX_CHARS;
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;

  const depth = measureTagDepth(html);
  if (depth > maxDepth) {
    return {
      ok: false,
      reason: "too-deep",
      detail:
        `HTML 嵌套 ${depth} 层，超过上限 ${maxDepth}。` +
        `深嵌套几乎只出现在异常页面或攻击载荷里，直接拒绝转换。`,
    };
  }

  let markdown: string;
  try {
    markdown = convert(html).trim();
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "convert-failed",
      detail: `HTML→Markdown 转换失败（${name}）：${message}`,
    };
  }

  const truncated = markdown.length > maxChars;
  return {
    ok: true,
    text: truncated ? markdown.slice(0, maxChars) : markdown,
    truncated,
  };
}

/**
 * 粗扫 HTML 里**标签的嵌套深度**（取最大值）。
 *
 * 为什么不用正则一把梭：属性里可以出现 `>`（`<a title='a>b'>`）、注释和
 * `<script>` 里可以出现任意 `<div>` 字符串——正则既容易漏也容易回溯爆炸。
 * 这里手写一遍扫描，**只求"够用且在病态输入上不会更糟"**：
 * 真页面深度只有几十层，就算数歪一点也离 512 很远。
 */
export function measureTagDepth(html: string): number {
  const lower = html.toLowerCase();
  let depth = 0;
  let maxDepth = 0;
  let index = 0;

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) break;

    // 注释：整段跳过（里面的标签不算）
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    // 声明 / 处理指令（<!DOCTYPE …> / <?xml …?>）：不是元素，跳过
    if (html.startsWith("<!", open) || html.startsWith("<?", open)) {
      const end = html.indexOf(">", open);
      index = end < 0 ? html.length : end + 1;
      continue;
    }

    // 找标签的收尾 `>`，途中跳过引号里的内容
    let cursor = open + 1;
    let quote: string | null = null;
    while (cursor < html.length) {
      const char = html[cursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      cursor += 1;
    }
    if (cursor >= html.length) break; // 尾部没闭合，忽略

    const raw = html.slice(open + 1, cursor);
    const isClosing = raw.startsWith("/");
    const name = raw.replace(/^\//, "").split(/[\s/>]/, 1)[0].toLowerCase();
    const selfClosing = raw.endsWith("/");

    if (isClosing) {
      if (depth > 0) depth -= 1;
    } else if (name && !selfClosing && !VOID_ELEMENTS.has(name)) {
      depth += 1;
      if (depth > maxDepth) maxDepth = depth;
    }

    index = cursor + 1;

    // 原始文本元素：内容一路跳到它的闭合标签，避免把里面的字符串当标签
    if (!isClosing && RAW_TEXT_ELEMENTS.has(name)) {
      const closeAt = lower.indexOf(`</${name}`, index);
      if (closeAt < 0) break;
      index = closeAt;
    }
  }

  return maxDepth;
}
