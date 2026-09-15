// ============================================================
// web_search provider（DeepSeek Anthropic 兼容端点）—— 单测
// ============================================================
// 分两段测：
//   ① **映射**（纯函数，夹具是真实响应形状）——不需要 fetch
//   ② **请求**（注入 fetch）—— 断言发出去的那一发长什么样
//
// ⭐ 本文件最要紧的一条：**snippet 不在 `web_search_result` 条目上**。
// Anthropic 那个条目只有 url / title / page_age；真正的摘录在**另一个
// `text` block 的 `citations[]` 里，按 url 索引**。不知道这件事就会写出
// "snippet 永远是空的"的实现——而且它**不会报错**，只会静默地少给信息。
// 出处：DSH `web-search-deepseek/src/provider.ts:112-132`。
//
// ⚠️ 夹具说明（AGENTS 11.5 ②）：下面的 `REAL_SHAPE` **不是编的**，
// 是 2026-09-14 用户本地实测那次响应的块序列：
//     thinking, server_tool_use, web_search_tool_result, thinking, text
// 真实响应里 `web_search_result` 条目确实**没有** snippet 字段——
// 这正是第 ① 组用例存在的理由。
// ============================================================

import { describe, expect, it } from "vitest";
import {
  citationSnippets,
  createDeepSeekSearchProvider,
  mapAnthropicResponse,
  type DeepSeekSearchProviderOptions,
} from ".";

/** 真实的响应块序列（见文件头：实测得来） */
const REAL_SHAPE = [
  { type: "thinking", thinking: "我需要搜一下。" },
  {
    type: "server_tool_use",
    id: "srvtoolu_01",
    name: "web_search",
    input: { query: "DeepSeek V4 上下文窗口" },
  },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_01",
    content: [
      {
        type: "web_search_result",
        url: "https://a.example/v4",
        title: "A 站：V4 发布说明",
        page_age: "2026-08-01",
      },
      {
        type: "web_search_result",
        url: "https://b.example/ctx",
        title: "B 站：上下文窗口对比",
      },
    ],
  },
  { type: "thinking", thinking: "够了。" },
  {
    type: "text",
    text: "根据搜索结果，DeepSeek V4 的上下文窗口是 1M。",
    citations: [
      {
        type: "web_search_result_location",
        url: "https://a.example/v4",
        cited_text: "DeepSeek V4 的上下文窗口为 1,000,000 token。",
      },
    ],
  },
];

// ------------------------------------------------------------
// ① 映射：响应 → 归一化结果
// ------------------------------------------------------------

describe("citationSnippets —— 摘录在 text block 的 citations 里", () => {
  it("从 citations 建出 url → 摘录 的表", () => {
    const snippets = citationSnippets(REAL_SHAPE);
    expect(snippets.get("https://a.example/v4")).toBe(
      "DeepSeek V4 的上下文窗口为 1,000,000 token。",
    );
  });

  it("同一个 url 出现多次时取**第一次**（后面的多是重复引用）", () => {
    const snippets = citationSnippets([
      {
        type: "text",
        text: "第一次",
        citations: [{ url: "https://a.example/", cited_text: "先说的" }],
      },
      {
        type: "text",
        text: "第二次",
        citations: [{ url: "https://a.example/", cited_text: "后说的" }],
      },
    ]);
    expect(snippets.get("https://a.example/")).toBe("先说的");
  });

  it("没有 citations 的 text block 不会造出空条目", () => {
    expect(citationSnippets([{ type: "text", text: "没有引用" }]).size).toBe(0);
  });
});

describe("mapAnthropicResponse —— 归一化", () => {
  it("⭐ 把 citations 里的摘录接到 web_search_result 条目上", () => {
    // 这是整个 provider 最容易写错的一步：条目本身**没有** snippet，
    // 不做这个 join，sources[].snippet 就永远是 undefined（而且不报错）。
    const result = mapAnthropicResponse({ content: REAL_SHAPE }, 8);
    const first = result.sources.find((s) => s.url === "https://a.example/v4");
    expect(first?.snippet).toBe("DeepSeek V4 的上下文窗口为 1,000,000 token。");
  });

  it("带出 url / title / publishedAt（page_age）", () => {
    const result = mapAnthropicResponse({ content: REAL_SHAPE }, 8);
    const first = result.sources.find((s) => s.url === "https://a.example/v4");
    expect(first).toMatchObject({
      url: "https://a.example/v4",
      title: "A 站：V4 发布说明",
      publishedAt: "2026-08-01",
    });
  });

  it("没有引用它的 text block 时，snippet 缺省而不是编一个", () => {
    // "缺省"必须能被表达出来——DSH 的接口注释写得很清楚：
    // 逼 adapter 编造 title/snippet 会让这层说谎。
    const result = mapAnthropicResponse({ content: REAL_SHAPE }, 8);
    const second = result.sources.find((s) => s.url === "https://b.example/ctx");
    expect(second?.url).toBe("https://b.example/ctx");
    expect(second?.snippet).toBeUndefined();
  });

  it("按 url 去重（max_uses > 1 时同一条会在多次搜索里重复出现）", () => {
    const result = mapAnthropicResponse(
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "https://same.example/" },
              { type: "web_search_result", url: "https://same.example/" },
            ],
          },
        ],
      },
      8,
    );
    expect(result.sources).toHaveLength(1);
  });

  it("多个 result block 会合并（一次请求内搜了多次）", () => {
    const result = mapAnthropicResponse(
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [{ type: "web_search_result", url: "https://one.example/" }],
          },
          {
            type: "web_search_tool_result",
            content: [{ type: "web_search_result", url: "https://two.example/" }],
          },
        ],
      },
      8,
    );
    expect(result.sources.map((s) => s.url)).toEqual([
      "https://one.example/",
      "https://two.example/",
    ]);
  });

  it("超过 maxResults → 砍掉并置 truncated", () => {
    const result = mapAnthropicResponse(
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "https://1.example/" },
              { type: "web_search_result", url: "https://2.example/" },
              { type: "web_search_result", url: "https://3.example/" },
            ],
          },
        ],
      },
      2,
    );
    expect(result.sources).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("没超上限 → truncated 是 false", () => {
    const result = mapAnthropicResponse({ content: REAL_SHAPE }, 8);
    expect(result.truncated).toBe(false);
  });

  it("⭐ 没有 web_search_tool_result 块 → 抛错，绝不拿 text 当搜索结果", () => {
    // fail-closed：模型没真的搜（或端点不支持服务端搜索）时，
    // 那段 text 只是模型的散文——把它当搜索结果返回就是**假装搜到了**。
    expect(() =>
      mapAnthropicResponse(
        { content: [{ type: "text", text: "我猜 V4 的窗口是 1M。" }] },
        8,
      ),
    ).toThrow(/web_search_tool_result/);
  });

  it("空响应也只抛错这一种处理（没有别的兜底）", () => {
    expect(() => mapAnthropicResponse({}, 8)).toThrow(/web_search_tool_result/);
  });

  it("url 为空的条目跳过（不是合法的引用来源）", () => {
    const result = mapAnthropicResponse(
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "" },
              { type: "web_search_result", url: "https://ok.example/" },
            ],
          },
        ],
      },
      8,
    );
    expect(result.sources.map((s) => s.url)).toEqual(["https://ok.example/"]);
  });
});

// ------------------------------------------------------------
// ② 请求：发出去的那一发长什么样
// ------------------------------------------------------------

/** 记录请求的 fetch 桩 */
function stubFetch(respond: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { fetchImpl, calls };
}

function okResponse(blocks: unknown[] = REAL_SHAPE): Response {
  return new Response(JSON.stringify({ content: blocks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// 五项必填全部显式给出——适配器**不再自带默认值**（默认值搬进了 config）。
// 这本身就是「调用方必须表态」那条纪律的体现：少给一项就编译不过。
const BASE_OPTIONS: DeepSeekSearchProviderOptions = {
  apiKey: "sk-test",
  baseUrl: "https://search.example/anthropic/v1",
  model: "deepseek-v4-flash",
  maxTokens: 4096,
  maxUses: 5,
  maxResults: 8,
};

/** 这次请求发出去的 body（只声明我们真正要断言的那几个字段） */
type SentBody = {
  model: string;
  max_tokens: number;
  messages: Array<{ content: Array<{ text: string }> }>;
  tools: Array<{ type: string; name: string; max_uses: number }>;
};

/** 取出这次请求发出的 JSON body */
function sentBody(call: { init: RequestInit | undefined }): SentBody {
  return JSON.parse(String(call.init?.body)) as SentBody;
}

describe("DeepSeek 搜索 provider —— 请求形状", () => {
  it("端点 = baseUrl + /messages（**不是** chat/completions 那个 baseUrl）", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    await createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search(
      "DeepSeek V4",
    );
    expect(calls[0].url).toBe("https://search.example/anthropic/v1/messages");
  });

  it("body 带 web_search_20250305 服务端工具 + max_uses", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    await createDeepSeekSearchProvider({
      ...BASE_OPTIONS,
      fetch: fetchImpl,
      maxUses: 3,
    }).search("DeepSeek V4");

    const body = sentBody(calls[0]);
    expect(body.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ]);
    expect(body.messages[0].content[0].text).toContain("DeepSeek V4");
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("同时发 x-api-key 和 authorization（官方端点 + 兼容代理都能用）", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    await createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search("q");

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.authorization).toBe("Bearer sk-test");
  });

  it("⭐ redirect 必须是 error（搜索请求没有理由跟重定向）", async () => {
    // ⚠️ 这条**必须直接断言**：fetch 桩会无视 `redirect`，所以把它改成
    // "follow" 或删掉，别的用例**一条都不会红**——fetcher 那次就是这么漏的
    // （stub 不看 redirect，于是 manual→follow 的突变全绿）。DSH 原话：
    // provider.ts:227 `redirect: 'error'`。
    const { fetchImpl, calls } = stubFetch(okResponse);
    await createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search("q");
    expect(calls[0].init?.redirect).toBe("error");
  });

  it("maxTokens / maxUses 原样发出——适配器不自己改数", async () => {
    // 这条守的是「适配器不再自带默认值」这件事的另一面：既然上限由调用方给，
    // 那它必须**照发**。如果哪天有人图省事在适配器里写死一个值，
    // 从 config 调上限就会静默失效——这条会红。
    const { fetchImpl, calls } = stubFetch(okResponse);
    await createDeepSeekSearchProvider({
      ...BASE_OPTIONS,
      fetch: fetchImpl,
      maxTokens: 1234,
      maxUses: 7,
    }).search("q");
    const body = sentBody(calls[0]);
    expect(body.max_tokens).toBe(1234);
    expect(body.tools[0].max_uses).toBe(7);
  });
});

describe("DeepSeek 搜索 provider —— 失败路径", () => {
  it("没有 apiKey → 抛错且**不发请求**", async () => {
    const { fetchImpl, calls } = stubFetch(okResponse);
    await expect(
      createDeepSeekSearchProvider({
        ...BASE_OPTIONS,
        apiKey: "",
        fetch: fetchImpl,
      }).search("q"),
    ).rejects.toThrow(/apiKey|API key|密钥|DEEPSEEK_API_KEY/i);
    expect(calls).toEqual([]);
  });

  it("HTTP 错误 → 抛错里带状态码和服务端说明", async () => {
    const { fetchImpl } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
        }),
    );
    await expect(
      createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search("q"),
    ).rejects.toThrow(/401/);
  });

  it("网络错误 → 抛错并把原因带出来", async () => {
    const fetchImpl: typeof globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search("q"),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("已中止的 signal → 抛错，不装作拿到了结果", async () => {
    const { fetchImpl } = stubFetch(okResponse);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search(
        "q",
        controller.signal,
      ),
    ).rejects.toThrow(/中止|abort/i);
  });

  it("响应不是 JSON → 抛错（不是静默返回空结果）", async () => {
    const { fetchImpl } = stubFetch(
      () => new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    );
    await expect(
      createDeepSeekSearchProvider({ ...BASE_OPTIONS, fetch: fetchImpl }).search("q"),
    ).rejects.toThrow();
  });
});

describe("DeepSeek 搜索 provider —— 接口形状", () => {
  it("有一个稳定的 id（将来多 provider 时靠它区分）", () => {
    expect(createDeepSeekSearchProvider(BASE_OPTIONS).id).toBe("deepseek");
  });

  it("正常的搜索返回归一化结果（不暴露 wire format）", async () => {
    const { fetchImpl } = stubFetch(okResponse);
    const result = await createDeepSeekSearchProvider({
      ...BASE_OPTIONS,
      fetch: fetchImpl,
    }).search("DeepSeek V4");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });
});
