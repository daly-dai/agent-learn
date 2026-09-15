// ============================================================
// 无类型第三方模块的本地声明
// ============================================================
// 为什么手写而不是装 `@types/*`（2026-09-14 定）：
//   ① `turndown` 和 `@joplin/turndown-plugin-gfm` **都不发类型**（package.json
//      里没有 `types`/`typings`），tsconfig 又是 `strict` → 撞 TS7016；
//   ② gfm 插件那个包在 DefinitelyTyped 上**基本不存在**——就算给 turndown 装了
//      `@types`，插件这一半还是得手写，不如两个都自己做，少一个依赖。
//
// ⚠️ **只声明我们真正用到的面**（不预挖）。哪天要用别的成员，tsc 会直接报
//    "属性不存在"——那是提醒你在这里补一行，而不是让你去猜。
// ============================================================

declare module "turndown" {
  export type TurndownOptions = {
    /** `# 标题`（atx）还是下划线式（setext） */
    headingStyle?: "setext" | "atx";
    /** 代码块用 ``` 围栏（fenced）还是缩进（indented） */
    codeBlockStyle?: "indented" | "fenced";
    bulletListMarker?: "-" | "+" | "*";
  };

  /**
   * 一条转换规则：`filter` 决定管哪些元素，`replacement` 给出替换后的文本。
   *
   * ⭐ 返回**空串 = 整块丢掉**（连同它里面的文字）——这正是"丢弃不可见内容"
   * 要的效果。turndown 默认**会保留**元素文字，所以"看不见"必须靠规则自己判，
   * 不能指望它自动跳过（见 `html-to-text/index.ts` 头部）。
   */
  export type TurndownRule = {
    filter: string | string[] | ((node: HTMLElement) => boolean);
    replacement: (content: string, node: HTMLElement) => string;
  };

  /** 插件形态：拿到 service 后调它的 `addRule` 等方法 */
  export type TurndownPlugin = (service: TurndownService) => void;

  export default class TurndownService {
    constructor(options?: TurndownOptions);
    /** 转换 HTML → Markdown（同步；深嵌套会抛 RangeError，见 html-to-text 头部） */
    turndown(html: string): string;
    /** 装插件（我们只用了 gfm） */
    use(plugin: TurndownPlugin): TurndownService;
    /** 加一条规则（我们用来丢"不可见内容"） */
    addRule(key: string, rule: TurndownRule): TurndownService;
  }
}

declare module "@joplin/turndown-plugin-gfm" {
  import type { TurndownPlugin } from "turndown";

  /** 一次装上表格 / 删除线 / 任务列表（我们只用这一个） */
  export const gfm: TurndownPlugin;
}
