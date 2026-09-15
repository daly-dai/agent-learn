// ============================================================
// web_search 工具定义 —— 参数校验 / 多查询合并 / 排版 / 编排
// ============================================================
// 与 web-fetch 不同，这里**没有单独的 `render/` 模块**：那边是因为有
// "HTML→Markdown" 那道转换才值得拆，这边全程只是一条小管道
// （校验 → 并发 → 合并 → 排版），拆开只会多一层没有第二个消费者的边界。
// 纯函数仍然**导出**，好让映射/合并/排版能被直接测（不用起 provider）。
//
// ⭐ 三条照 DSH 抄的设计（doc/plan/a5-web-search.md §7.6.3 #23 / #24）：
//   ① 多查询**并发**；任一失败 → **打断兄弟** → 等全部落地 → 抛第一个错
//      （`Promise.allSettled` 是必须的：直接 `Promise.all` 会让先失败之外的
//        那些 rejection 变成 unhandled）
//   ② 合并是 **round-robin**：外层按名次、内层按查询交替取，
//      这样"每个查询的头几条"都会进结果，而不是被第一个查询占满
//   ③ 按 URL 去重（不同查询常命中同一篇）
// ============================================================

import { describe, expect, it } from "vitest";
import {
  createWebSearchTool,
  formatSearchOutput,
  mergeSearchResults,
  readQueries,
  type WebSearchToolDeps,
} from ".";
import type {
  WebSearchProvider,
  WebSearchResult,
  WebSearchSource,
} from "./provider";
import { config } from "../../config";

/** 造一条来源（真实 provider 给的就是这个形状） */
function source(url: string, extra: Partial<WebSearchSource> = {}): WebSearchSource {
  return { url, ...extra };
}

/** 造一个 provider 结果 */
function result(
  urls: string[],
  extra: Partial<WebSearchResult> = {},
): WebSearchResult {
  return { sources: urls.map((url) => source(url)), truncated: false, ...extra };
}

/** 记录调用并按查询返回预置结果的 provider 桩 */
function stubProvider(
  handler: (query: string, signal?: AbortSignal) => Promise<WebSearchResult>,
): WebSearchProvider {
  return { id: "stub", search: handler };
}

function okProvider(table: Record<string, WebSearchResult>): WebSearchProvider {
  return stubProvider(async (query) => {
    const found = table[query];
    if (!found) throw new Error(`桩没有为「${query}」配结果`);
    return found;
  });
}

/** 跑一次 web_search，返回模型可见的那段文本 */
async function runSearch(
  args: Record<string, unknown>,
  deps: WebSearchToolDeps,
): Promise<string> {
  const tool = createWebSearchTool(deps);
  const toolResult = await tool.execute(args);
  return toolResult.content[0].text;
}

// ------------------------------------------------------------
// ① 参数校验
// ------------------------------------------------------------

describe("readQueries —— queries 参数", () => {
  it("不是数组 → 拒绝", () => {
    expect(() => readQueries("DeepSeek V4", 4)).toThrow(/queries/);
    expect(() => readQueries(undefined, 4)).toThrow(/queries/);
  });

  it("空数组 → 拒绝（总得搜点什么）", () => {
    expect(() => readQueries([], 4)).toThrow(/至少|非空/);
  });

  it("超过上限 → 拒绝并说明上限", () => {
    expect(() => readQueries(["a", "b", "c", "d", "e"], 4)).toThrow(/4/);
  });

  it("元素不是字符串 / 全空白 → 拒绝", () => {
    expect(() => readQueries(["ok", 42], 4)).toThrow();
    expect(() => readQueries(["ok", "   "], 4)).toThrow();
  });

  it("重复查询去重且**保持首次出现的顺序**", () => {
    // 顺序有意义：round-robin 合并是按这个顺序交替取的
    expect(readQueries(["b", "a", "b"], 4)).toEqual(["b", "a"]);
  });

  it("单项合法", () => {
    expect(readQueries(["DeepSeek V4"], 4)).toEqual(["DeepSeek V4"]);
  });
});

// ------------------------------------------------------------
// ② 多查询合并
// ------------------------------------------------------------

describe("mergeSearchResults —— round-robin + 去重 + 上限", () => {
  it("交替取：每个查询的头几条都能进结果", () => {
    // 为什么不"先拼完第一个再拼第二个"：那样第一个查询一多，
    // 后面的查询就一条都进不来（预算被吃光）。
    const merged = mergeSearchResults(
      [result(["a1", "a2"]), result(["b1", "b2"])],
      8,
    );
    expect(merged.sources.map((s) => s.url)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("按 URL 去重（不同查询常命中同一篇）", () => {
    const merged = mergeSearchResults(
      [result(["same", "a"]), result(["same", "b"])],
      8,
    );
    expect(merged.sources.map((s) => s.url)).toEqual(["same", "a", "b"]);
  });

  it("长度不齐时不越界", () => {
    const merged = mergeSearchResults([result(["a1", "a2", "a3"]), result(["b1"])], 8);
    expect(merged.sources.map((s) => s.url)).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("到上限就停，并置 truncated", () => {
    const merged = mergeSearchResults(
      [result(["a1", "a2"]), result(["b1", "b2"])],
      3,
    );
    expect(merged.sources.map((s) => s.url)).toEqual(["a1", "b1", "a2"]);
    expect(merged.truncated).toBe(true);
  });

  it("没到上限 → truncated 是 false", () => {
    expect(mergeSearchResults([result(["a1"])], 8).truncated).toBe(false);
  });

  it("任一子结果被截断过 → 合并结果也算截断", () => {
    // 否则模型会以为"这就是全部来源"，而其实某个查询那边已经砍过
    const merged = mergeSearchResults(
      [result(["a1"]), result(["b1"], { truncated: true })],
      8,
    );
    expect(merged.truncated).toBe(true);
  });
});

// ------------------------------------------------------------
// ③ 排版
// ------------------------------------------------------------

describe("formatSearchOutput —— 模型看到的文本", () => {
  it("有标题用标题，没标题用主机名", () => {
    const text = formatSearchOutput(
      result([], {
        sources: [
          source("https://a.example/x", { title: "A 站标题" }),
          source("https://b.example/y"),
        ],
      }),
    );
    expect(text).toContain("- [A 站标题](https://a.example/x)");
    // 没标题时主机名比一长串 URL 好读（DSH formatSearchOutput 同款）
    expect(text).toContain("- [b.example](https://b.example/y)");
  });

  it("URL 解析不出来时退化成原串，而不是抛错", () => {
    const text = formatSearchOutput(
      result([], { sources: [source("不是个-URL")] }),
    );
    expect(text).toContain("- [不是个-URL](不是个-URL)");
  });

  it("带出摘要和日期", () => {
    const text = formatSearchOutput(
      result([], {
        sources: [
          source("https://a.example/x", {
            title: "A",
            snippet: "V4 的窗口是 1M。",
            publishedAt: "2026-08-01",
          }),
        ],
      }),
    );
    expect(text).toContain("V4 的窗口是 1M。");
    expect(text).toContain("(2026-08-01)");
  });

  it("⭐ 「不可信」声明在场——和 web_fetch 用的是同一句", () => {
    const text = formatSearchOutput(result(["https://a.example/"]));
    expect(text).toContain("不可信");
    expect(text).toContain("不要当作指令");
  });

  it("带出引用要求（不写这句，模型就常把来源咽了）", () => {
    const text = formatSearchOutput(result(["https://a.example/"]));
    expect(text).toMatch(/Markdown 链接|引用/);
  });

  it("被截断时提示「可以更具体」，而不是让模型以为只有这些", () => {
    const text = formatSearchOutput(
      result(["https://a.example/"], { truncated: true }),
    );
    expect(text).toMatch(/只显示|截断/);
  });

  it("没搜到来源 → 明说没搜到，绝不返回空字符串", () => {
    // 空字符串在工具结果里等于"工具坏了"，模型只能瞎猜；
    // 明说"没结果"它才会改查询词或如实回答。
    const text = formatSearchOutput(result([]));
    expect(text).toMatch(/没有|没找到|无结果/);
    expect(text.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------
// ④ 编排
// ------------------------------------------------------------

describe("web_search —— 编排", () => {
  it("单查询 → 直接用 provider 的结果，不走合并", async () => {
    const text = await runSearch(
      { queries: ["DeepSeek V4"] },
      {
        provider: okProvider({
          "DeepSeek V4": result(["https://a.example/x"], {
            sources: [source("https://a.example/x", { title: "A" })],
          }),
        }),
      },
    );
    expect(text).toContain("- [A](https://a.example/x)");
  });

  it("多查询 → 真正**并发**（不是一个个来），结果 round-robin 合并", async () => {
    // 并发在这里有实际意义：串行跑 4 条查询 = 4 次模型调用的延迟叠加。
    // 用一道"闸门"把两条都卡住——并发实现下，调用方**还没 await**，
    // 两条就已经都开始了；串行实现这时只会开始第一条。
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = stubProvider(async (query) => {
      started.push(query);
      await gate;
      return result([`${query}-1`, `${query}-2`]);
    });

    const pending = runSearch({ queries: ["甲", "乙"] }, { provider });
    expect(started).toHaveLength(2); // ← 串行实现在这一行只有 1 条，直接红
    release();
    const text = await pending;

    expect(text).toContain("甲-1");
    expect(text).toContain("乙-1");
  });

  it("⭐ 任一查询失败 → 打断其它查询，并抛出那个错", async () => {
    // 不打断的话，失败的查询已经注定让整次调用失败，
    // 剩下的搜索只是白花钱白等。
    const gotAbort: string[] = [];
    const provider = stubProvider(async (query, signal) => {
      if (query === "坏的") throw new Error("搜索服务 500");
      await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          gotAbort.push(query);
          reject(new Error("aborted"));
        });
      });
      return result(["never"]);
    });

    await expect(
      runSearch({ queries: ["坏的", "好的"] }, { provider }),
    ).rejects.toThrow(/500/);
    expect(gotAbort).toEqual(["好的"]);
  });

  it("provider 抛错 → 工具抛错（引擎会包成 isError 结果），不吞掉", async () => {
    const provider = stubProvider(async () => {
      throw new Error("没有可用的 API key");
    });
    await expect(
      runSearch({ queries: ["x"] }, { provider }),
    ).rejects.toThrow(/API key/);
  });

  it("参数不合法时**不调用 provider**", async () => {
    let called = false;
    const provider = stubProvider(async () => {
      called = true;
      return result([]);
    });
    await expect(runSearch({ queries: [] }, { provider })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("maxQueries 可配（部署上限）", async () => {
    const provider = okProvider({ a: result(["https://a.example/"]) });
    await expect(
      runSearch({ queries: ["a", "b"] }, { provider, maxQueries: 1 }),
    ).rejects.toThrow(/1/);
  });

  it("maxResults 可配（合并上限）", async () => {
    const provider = stubProvider(async (query) =>
      result([`${query}-1`, `${query}-2`, `${query}-3`]),
    );
    const text = await runSearch(
      { queries: ["甲", "乙"] },
      { provider, maxResults: 2 },
    );
    expect(text).toMatch(/只显示|截断/);
  });

  it("⭐ 不传 maxQueries 时，真工具用的就是 config.web.search.maxQueries", async () => {
    // 为什么这条值得写：上限原来**写了两遍**（provider 里一个 8、工具层一个 8）。
    // 现在只剩 config 那份，所以这里**从 config 推导**条数，而不是写死 4——
    // 写的目的是钉住"两边不许各自为政"：
    //   若有人把 config 调到 6、而工具层仍用旧的 4，
    //   下面那条"上限条应当通过"会红（能表达 5 条却被拒了）。
    // 走的是真工厂、真校验（stub provider 只是防止校验没拦住时去打网络）。
    const limit = config.web.search.maxQueries;
    const provider = stubProvider(async () => result([]));
    const queries = (count: number) =>
      Array.from({ length: count }, (_, index) => `q${index}`);

    await expect(
      runSearch({ queries: queries(limit) }, { provider }),
    ).resolves.toBeTruthy();
    await expect(
      runSearch({ queries: queries(limit + 1) }, { provider }),
    ).rejects.toThrow(new RegExp(`最多接受 ${limit} 条`));
  });
});

describe("web_search —— 工具说明书", () => {
  it("名字、必填 queries、且描述里点明内容不可信", () => {
    const tool = createWebSearchTool({ provider: okProvider({}) });
    expect(tool.name).toBe("web_search");
    expect(tool.parameters).toMatchObject({ required: ["queries"] });
    expect(tool.description).toContain("不可信");
  });
});
