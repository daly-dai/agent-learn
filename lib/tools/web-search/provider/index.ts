// ============================================================
// web_search provider —— DeepSeek 的 **Anthropic 兼容**端点
// ============================================================
// 搜索**不是**我们自己的搜索引擎，而是"用服务端工具让模型替我搜一次"：
// 往 Anthropic 格式的 Messages 端点发一次请求，带上原生
// `web_search_20250305` 服务端工具，响应里的 `web_search_tool_result` 块
// 就是结果。一次搜索 = 一次模型调用（要花钱、要等），这是它的代价。
//
// ⚠️ **两个端点绝不能混**（照 DSH `web-search-deepseek/src/provider.ts:29-35`）：
//   主循环  https://api.deepseek.com               /chat/completions   （OpenAI 兼容）
//   搜索    https://api.deepseek.com/anthropic/v1  /messages           （Anthropic 兼容）
// `chat/completions` **没有**服务端搜索（Reasonix 明确排除过这条路）。
//
// ⭐ 所以本模块**自己不读 config**：端点、模型、各项上限全由工具层
// （`lib/tools/web-search/index.ts`）从 `config` 取好、当参数喂进来。
// 为什么不像 `deepseekModel` 那样在模块顶层读 config：
//   那个是**我们唯一的**模型适配器，读 config 无所谓；
//   这里是「一个通用接口（`WebSearchProvider`）+ 一个实现」，将来接
//   Kimi/千问就是再写一个实现同一个接口的文件——让实现去读**本项目的**
//   config，等于把接口弄脏，第二个实现也得跟着读。代价是多一层传参，
//   换来的是适配器可以脱离 config 单独测（现有 25 条用例就是这么测的）。
//
// ⭐ 最容易写错的一步：**snippet 不在 `web_search_result` 条目上**。
// 那个条目只有 url / title / page_age；真正的摘录在**另一个 `text` block 的
// `citations[]` 里，按 url 索引**。所以要**两遍走**：先建 `url → cited_text`
// 表，再把它接到源上。
// ⚠️ 写错了**不会报错**——只会静默地少给信息（snippet 永远 undefined），
// 所以 `index.test.ts` 第一组用例专门钉这件事。
//
// ⭐ 第二条纪律：**没有 `web_search_tool_result` 块就抛错**。
// 绝不退回去"从模型的散文里刮搜索结果"——那时候模型其实没搜到，
// 把它的猜测当搜索结果返回就是**假装搜到了**。
//
// 本模块只在 provider 层出现 DeepSeek 的 wire format；
// 上层（工具定义）只看到 `WebSearchResult`。将来接 Kimi/千问/GLM =
// 再写一个实现同一个 `WebSearchProvider` 接口的文件，工具层零改动。
// ============================================================

/** 一条可引用的来源 */
export type WebSearchSource = {
  url: string;
  /**
   * 标题 / 摘录 / 时间**都可以缺**：不是每家后端都给，
   * 逼 adapter 编一个出来会让这一层说谎（DSH `web/src/types.ts:44-49`）。
   */
  title?: string;
  snippet?: string;
  /** 发布或抓取时间，后端原样给的字符串（Anthropic 叫 `page_age`） */
  publishedAt?: string;
};

/** 归一化的搜索结果——上层只认这个形状 */
export type WebSearchResult = {
  sources: WebSearchSource[];
  /** 是否因为上限砍过来源 */
  truncated: boolean;
};

/**
 * 搜索后端。第一版只有一个实现（DeepSeek），
 * 但接口留着：加国内模型 = 加一个实现文件，工具和引擎不动。
 *
 * ⚠️ 刻意**没有** `available()`：那属于"多 provider 选择"的机器，
 * 单 provider 时它没有消费者。等真出现第二家再加（AGENTS §10.8：
 * 一个 adapter = 假设的 seam）。key 缺失在 `search()` 里直接报错。
 */
export interface WebSearchProvider {
  /** 稳定标识；将来多 provider 时靠它区分 */
  readonly id: string;
  search(query: string, signal?: AbortSignal): Promise<WebSearchResult>;
}

export type DeepSeekSearchProviderOptions = {
  /** DeepSeek API key（复用主模型那把；本模块不读 config，由工具层喂） */
  apiKey: string;
  /** 注入点：测试用桩，真实环境用全局 fetch */
  fetch?: typeof globalThis.fetch;
  /**
   * 端点 base；`/messages` 会被追加。**不是** chat/completions 那个。
   * 值来自 `config.provider.search.baseUrl`。
   */
  baseUrl: string;
  /** 搜索模型。值来自 `config.provider.search.model`——**不是**主模型那个字段 */
  model: string;
  /** 生成 token 上限；值来自 `config.web.search.maxTokens` */
  maxTokens: number;
  /** 一次请求内允许用几次服务端搜索；值来自 `config.web.search.maxUses` */
  maxUses: number;
  /** 返回来源数上限；超了砍掉并置 `truncated` */
  maxResults: number;
  /** `anthropic-version` 头（DeepSeek 官方会忽略它，但代理可能要看） */
  apiVersion?: string;
};

export const DEEPSEEK_PROVIDER_ID = "deepseek";

/**
 * `anthropic-version` 头的默认值。
 *
 * ⭐ 这一条**留在代码里**、不进 config：它是**我们写解析时对着的 wire format
 * 版本**，属于协议契约，不是运维参数（DeepSeek 官方本来就会忽略它）。
 * 其余五项（端点 / 模型 / 三个上限）才进 config——它们的判据是
 * 「换个厂商会不会变」或「是不是我们允许它做多少」。
 */
export const DEFAULT_API_VERSION = "2023-06-01";

// 写一个诚实的自述 UA，不伪装成浏览器
const USER_AGENT = "agent-learn/0.1 (web_search)";

// ------------------------------------------------------------
// provider 侧类型：DeepSeek/Anthropic 的 wire format 只在本文件可见
// ------------------------------------------------------------

/** `text` block 里的一条引用（摘录就在这里，按 url 找） */
export type AnthropicCitation = {
  url?: string;
  cited_text?: string;
};

/** `web_search_tool_result` 块里的一条结果 */
export type AnthropicSearchResultItem = {
  type: string;
  url: string;
  title?: string;
  /** 发布时间，Anthropic 的字段名 */
  page_age?: string;
};

export type AnthropicContentBlock = {
  type: string;
  text?: string;
  citations?: AnthropicCitation[];
  content?: AnthropicSearchResultItem[];
};

export type AnthropicResponse = {
  content?: AnthropicContentBlock[];
};

// ------------------------------------------------------------
// 映射（纯函数，可单独测）
// ------------------------------------------------------------

/**
 * 从所有 `text` block 的 `citations[]` 建出 `url → 摘录` 表。
 *
 * 为什么要这么绕：Anthropic 的 `web_search_result` 条目**通常不带摘录**，
 * 只在模型引用某条来源时，把引用文本挂在那个 `text` block 的 citation 上。
 * 同一个 url 被引多次时取**第一次**（后面多是重复引用，取哪个都一样）。
 */
export function citationSnippets(
  blocks: readonly AnthropicContentBlock[],
): Map<string, string> {
  const snippets = new Map<string, string>();
  for (const block of blocks) {
    if (block.type !== "text") continue;
    for (const citation of block.citations ?? []) {
      const url = citation.url;
      const cited = citation.cited_text;
      if (!url || !cited) continue;
      if (!snippets.has(url)) snippets.set(url, cited);
    }
  }
  return snippets;
}

/**
 * 响应 → 归一化结果。
 *
 * @param maxResults 来源数上限；超了砍掉并置 `truncated`
 * @throws 响应里**没有** `web_search_tool_result` 块时抛错（见文件头第二条纪律）
 */
export function mapAnthropicResponse(
  payload: AnthropicResponse,
  maxResults: number,
): WebSearchResult {
  const blocks = payload.content ?? [];
  const resultBlocks = blocks.filter((block) => block.type === "web_search_tool_result");
  if (resultBlocks.length === 0) {
    throw new Error(
      "web_search 没有拿到 web_search_tool_result 块——这次请求没有真正触发服务端搜索。",
    );
  }

  // 第一遍：摘录表。第二遍：遍历结果条目，把摘录接上（按 url）。
  const snippets = citationSnippets(blocks);
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];

  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item.type !== "web_search_result") continue;
      if (item.url.length === 0 || seen.has(item.url)) continue;
      seen.add(item.url);
      sources.push({
        url: item.url,
        // 缺什么就不给什么——不编造字段（见 WebSearchSource 的注释）
        ...(item.title ? { title: item.title } : {}),
        ...(item.page_age ? { publishedAt: item.page_age } : {}),
        ...(snippets.has(item.url) ? { snippet: snippets.get(item.url) } : {}),
      });
    }
  }

  const truncated = sources.length > maxResults;
  return {
    sources: truncated ? sources.slice(0, maxResults) : sources,
    truncated,
  };
}

// ------------------------------------------------------------
// provider
// ------------------------------------------------------------

export function createDeepSeekSearchProvider(
  options: DeepSeekSearchProviderOptions,
): WebSearchProvider {
  return {
    id: DEEPSEEK_PROVIDER_ID,

    async search(query, signal) {
      const apiKey = options.apiKey.trim();
      if (apiKey.length === 0) {
        // fail-closed 且**不发请求**：没有 key 就没什么可试的
        throw new Error(
          "web_search 没有可用的 API key（DEEPSEEK_API_KEY 未配置）。" +
            "搜索复用主模型那把 key；如果你知道目标地址，也可以改用 web_fetch。",
        );
      }
      if (signal?.aborted) throw new Error("web_search 已中止。");

      const fetchImpl = options.fetch ?? globalThis.fetch;
      const baseUrl = options.baseUrl.replace(/\/+$/, "");
      const endpoint = `${baseUrl}/messages`;
      const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;

      const body = {
        model: options.model,
        max_tokens: options.maxTokens,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Perform a web search for the query: ${query}` }],
          },
        ],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: options.maxUses,
          },
        ],
      };

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          // 搜索是一次性请求，没有理由跟重定向——跟了只会多一跳不确定的地址
          redirect: "error",
          headers: {
            // 官方端点认 `x-api-key`，兼容代理可能只认 Bearer——两个都发，
            // 哪边认哪个都行（照 DSH provider.ts:229-232）
            "x-api-key": apiKey,
            authorization: `Bearer ${apiKey}`,
            "anthropic-version": apiVersion,
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": USER_AGENT,
          },
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          throw new Error("web_search 已中止。");
        }
        throw new Error(
          `web_search 请求失败（${endpoint}）：${errorMessage(error)}`,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `web_search 请求失败：HTTP ${response.status} ${response.statusText}` +
            `${detail ? `：${truncate(detail, 300)}` : ""}（端点 ${endpoint}）`,
        );
      }

      let payload: AnthropicResponse;
      try {
        payload = (await response.json()) as AnthropicResponse;
      } catch (error) {
        throw new Error(
          `web_search 的响应不是可解析的 JSON（端点 ${endpoint}）：${errorMessage(error)}`,
        );
      }

      return mapAnthropicResponse(payload, options.maxResults);
    },
  };
}

// ------------------------------------------------------------
// 内部
// ------------------------------------------------------------

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}… [截断]`;
}
