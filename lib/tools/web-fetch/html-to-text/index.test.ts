// ============================================================
// html-to-text.test.ts —— HTML → Markdown（web_fetch 的最后一步清洗）
// ============================================================
// 这一层**不是我们的轮子**：转换引擎是 turndown + GFM 插件（用户 08-26 拍板）。
// 我们的活是外面那圈：**深度守卫 + 输出限额 + 失败兜底**。
//
// ⭐ 深度守卫的依据是**实测**，不是照抄（2026-09-14，本地探针）：
//   depth  10 → 0.9ms ｜ 100 → 2.4ms ｜ 500 → 14.4ms ｜ 1000 → 42.4ms
//   depth 2000 → 抛 RangeError ｜ 4000 → 抛 ｜ 8000 → 700ms 后抛
// 所以：
//   - DSH 说的"能卡死同步转换"**在我们这个版本上不成立**——它是**快失败**（抛错），不是挂死；
//   - 守卫仍然值得留，但理由改成「**别先花掉一百多毫秒、再抛一个看不懂的 RangeError**」；
//   - 门槛取 512：实测 500 层只要 14ms，离抛出点（2000）有 4 倍余量，而真实网页极少超过几十层。
// ============================================================

import { describe, expect, it } from "vitest";
import { htmlToText, measureTagDepth } from ".";

describe("measureTagDepth —— 嵌套深度粗扫", () => {
  it("平铺的 HTML 深度是 1", () => {
    expect(measureTagDepth("<div>a</div><div>b</div>")).toBe(1);
  });

  it("嵌套 3 层 → 3", () => {
    expect(measureTagDepth("<div><section><p>x</p></section></div>")).toBe(3);
  });

  it("void 元素不计深（<br> / <img> 没有闭合标签）", () => {
    expect(measureTagDepth("<div><br><img src='x'><hr></div>")).toBe(1);
  });

  it("自闭合写法不计深（<br/> / <div/>）", () => {
    expect(measureTagDepth("<div><br/><span/>text</div>")).toBe(1);
  });

  it("注释里的标签不计（<!-- <div> --> 不是真标签）", () => {
    expect(measureTagDepth("<div><!-- <div><div><div> --></div>")).toBe(1);
  });

  it("⭐ script 里的字符串不当标签（<script>var s = '<div>'</script>）", () => {
    // 真实场景：页面内联脚本里出现 HTML 字符串是常态。
    // 深度 = **2**（div > script）；漏判的话会数成 **5** —— 把字符串里那三个
    // `<div>` 也当真标签。所以这条断言的区别度是 2 vs 5。
    expect(
      measureTagDepth("<div><script>var s = '<div><div><div>';</script></div>"),
    ).toBe(2);
  });

  it("属性里的 > 不会截断标签（<a title='a>b'>）", () => {
    expect(measureTagDepth("<div><a title='a>b'>x</a></div>")).toBe(2);
  });

  it("未闭合的标签不炸、也不虚报", () => {
    expect(measureTagDepth("<div><div>没闭合")).toBe(2);
  });

  it("深嵌套能数准（守卫要靠它）", () => {
    const html = "<div>".repeat(400) + "x" + "</div>".repeat(400);
    expect(measureTagDepth(html)).toBe(400);
  });
});

describe("htmlToText —— 转换、清洗、限额", () => {
  it("标题/粗体/链接转成 Markdown", () => {
    const result = htmlToText("<h1>标题</h1><p>正文 <strong>粗</strong> <a href='https://a.com'>链接</a></p>");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("# 标题");
      expect(result.text).toContain("**粗**");
      expect(result.text).toContain("[链接](https://a.com)");
    }
  });

  it("GFM 插件生效：表格转成管道表", () => {
    const result = htmlToText("<table><tr><td>甲</td><td>乙</td></tr></table>");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("| 甲");
  });

  it("script / style / noscript 被丢掉（不把代码当正文喂给模型）", () => {
    const result = htmlToText(
      "<div><style>.a{color:red}</style><script>alert(1)</script><p>正文</p></div>",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("正文");
      expect(result.text).not.toContain("alert");
      expect(result.text).not.toContain("color:red");
    }
  });

  it("同一个实例连续转两次结果一致（复用是安全的）", () => {
    const first = htmlToText("<p>同一段</p>");
    const second = htmlToText("<p>同一段</p>");
    expect(first.ok && second.ok && first.text === second.text).toBe(true);
  });

  it("超过 maxChars → 截断并标记（不能把整篇正文灌进上下文）", () => {
    const result = htmlToText(`<p>${"x".repeat(5000)}</p>`, { maxChars: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(100);
    }
  });

  it("⭐ 嵌套超过门槛 → 早退，且说明是几层（不交给转换器去抛 RangeError）", () => {
    const html = "<div>".repeat(1000) + "x" + "</div>".repeat(1000);
    const result = htmlToText(html, { maxDepth: 512 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-deep");
      expect(result.detail).toContain("1000");
    }
  });

  it("⭐ 守卫低估时兜底：转换器抛错要变成明确失败，不能漏出去", () => {
    // 真实场景：守卫是**字符串级粗扫**，可能低估真实嵌套（标签被动态拼出来等）。
    // 为什么**注入**抛错的转换器、而不是喂一段超深 HTML：实测"多深才抛"**随栈大小变**
    // （主线程 ~2000 层就抛，vitest 的 worker 线程里 3000 层还能转完）——
    // 环境相关的测试比没有测试更糟，它给人虚假的覆盖感。
    const result = htmlToText("<div>x</div>", {
      convert: () => {
        throw new RangeError("Maximum call stack size exceeded");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("convert-failed");
      // 报错要带错误类型——RangeError 和 TypeError 指向的问题完全不同
      expect(result.detail).toContain("RangeError");
    }
  });

  it("空 HTML → 空字符串（不报错）", () => {
    const result = htmlToText("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("");
  });
});

describe("htmlToText —— 丢弃不可见内容（抄 DSH 的 removeNonVisibleContent）", () => {
  // ⚠️ 这一组的前提：**turndown 默认会保留元素的文字**，它只认标签语义、
  // 不认这些内容在浏览器里根本看不见。所以"看不见"的每一种表达方式都得自己判。
  // 每条用例的夹具都注明了「这个状态为什么真的会发生」（AGENTS 11.5 ②）。

  it("script / style 之外的隐形标签也要丢（template / iframe）", () => {
    // 真实场景：站点把**未渲染的模板片段**和**内嵌框架**留在 HTML 里，
    // 它们的文字会原样被 turndown 转出来。
    const result = htmlToText(
      "<div><template>模板文字</template><iframe>框架文字</iframe><p>正文</p></div>",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("正文");
      expect(result.text).not.toContain("模板文字");
      expect(result.text).not.toContain("框架文字");
    }
  });

  it("hidden 属性 → 整块丢掉", () => {
    // 真实场景：折叠面板、按条件渲染但已经进了 DOM 的区块。
    const result = htmlToText(
      '<div hidden>折叠里的补充说明</div><p>正文</p>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("正文");
      expect(result.text).not.toContain("折叠里的补充说明");
    }
  });

  it('aria-hidden="true" → 整块丢掉（大小写不敏感）', () => {
    // 真实场景：图标字体的文字、屏幕阅读器专用标签（"跳到主内容"之类）。
    const result = htmlToText(
      '<span aria-hidden="TRUE">图标字</span><p>正文</p>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("正文");
      expect(result.text).not.toContain("图标字");
    }
  });

  it("⭐ 内联 display:none → 整块丢掉（真实网页里量最大的一类）", () => {
    // 真实场景：SEO 隐藏文本、折叠的评论区、cookie 弹窗——全靠它藏起来。
    const result = htmlToText(
      '<div style="display:none">给搜索引擎看的堆词</div><p>正文</p>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("正文");
      expect(result.text).not.toContain("堆词");
    }
  });

  it("内联样式的写法不规整也认（!important / 大小写 / 多余空格）", () => {
    // 真实场景：站点内联样式就是这么写的，不是每处都规整。
    // ⚠️ 夹具里同时给了 color 声明——它**必须不触发**丢块，否则说明我们
    // 把"整个 style 属性里有分号"当成了隐藏。
    const result = htmlToText(
      '<div style="COLOR: red ; DISPLAY : NONE !important">藏起来的</div><p>正文</p>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("正文");
      expect(result.text).not.toContain("藏起来的");
    }
  });

  it("visibility:hidden 丢；visibility:visible 不误伤", () => {
    // 真实场景：`visibility` 控制显隐同样常见，而 `visible` 是它的默认值写法。
    // 两条断言必须成对——只测 hidden 的话，"把带 visibility 的全删"也会绿。
    const result = htmlToText(
      '<div style="visibility:hidden">不可见</div><div style="visibility:visible">可见</div>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("可见");
      expect(result.text).not.toContain("不可见");
    }
  });

  it("⭐ 对照：普通可见内容一个都不能少", () => {
    // 没有这条的话，把 `isNonVisible` 改成 `return true`（全删）
    // 能让上面每一条的"不包含"断言全部通过——**那是最危险的一种假绿**。
    const result = htmlToText(
      '<p>甲</p><div style="display:block">乙</div><span>丙</span>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("甲");
      expect(result.text).toContain("乙");
      expect(result.text).toContain("丙");
    }
  });
});
