// ============================================================
// web_fetch 工具定义 —— 编排与错误映射
// ============================================================
// 这一层**不碰网络细节**，只做三件事：
//   ① 参数校验（url 必填非空）
//   ② 编排：`fetcher/` 抓 → `render/` 判定类型 → `html-to-text/` 转换 → `render/` 排版
//   ③ 把失败翻译成模型看得懂的一句话（抛错，引擎会包成 isError 工具结果）
//
// ⚠️ 测试**不碰网络**：`fetch` 与 `lookup` 都是注入的。
// 这不是为了"好测"——`web_fetch` 的失败路径（被闸门拦、超时、类型不支持）
// 在真实网络上要么低频、要么有副作用（真去打云元数据地址），
// 所以真实环境里这两样本来就必须可替换（AGENTS 11.5 ②）。
//
// ⭐ 一条必须钉死的安全性质：**HTML 转换失败时，绝不把原始 HTML 兜给模型**。
// 那等于把 active markup（含 `<script>`）直接喂进上下文。宁可不给。
// ============================================================

import { describe, expect, it } from "vitest";
import { createWebFetchTool, type WebFetchToolDeps } from ".";

/** 假 DNS：只认表里的域名（同 `fetcher/index.test.ts` 的写法） */
function fakeLookup(table: Record<string, string[]>): WebFetchToolDeps["lookup"] {
  return async (hostname: string) => {
    const found = table[hostname];
    if (!found) throw new Error(`ENOTFOUND ${hostname}`);
    return found;
  };
}

/** 公网域名的假 DNS——真实抓取里 example.com 解析出的就是公网地址 */
const publicDns = fakeLookup({ "example.com": ["93.184.216.34"] });

/** 按 URL 返回预置响应，并记下请求过的地址 */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl: WebFetchToolDeps["fetch"] = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`stub 没有为 ${url} 配响应`);
    return route();
  };
  return { fetchImpl, calls };
}

/** 造一个真实形状的响应（正文 + content-type 由站点决定，这里模拟它） */
function page(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

/** 跑一次 web_fetch，返回模型可见的那段文本 */
async function runFetch(
  args: Record<string, unknown>,
  deps: WebFetchToolDeps,
): Promise<string> {
  const result = await createWebFetchTool(deps).execute(args);
  return result.content[0].text;
}

const PAGE_URL = "https://example.com/page";

describe("web_fetch —— 参数校验", () => {
  it("缺 url → 抛错并说清要什么", async () => {
    await expect(
      createWebFetchTool({}).execute({}),
    ).rejects.toThrow(/url/);
  });

  it("url 是空串 / 全空白 → 同样拒绝（不发请求）", async () => {
    const { fetchImpl, calls } = stubFetch({});
    const tool = createWebFetchTool({ fetch: fetchImpl, lookup: publicDns });
    await expect(tool.execute({ url: "   " })).rejects.toThrow(/url/);
    expect(calls).toEqual([]);
  });

  it("url 不是字符串 → 拒绝（模型偶尔会传数字）", async () => {
    await expect(
      createWebFetchTool({}).execute({ url: 42 }),
    ).rejects.toThrow(/url/);
  });
});

describe("web_fetch —— 按内容类型分流", () => {
  it("抓 HTML → 转成 Markdown，带抓取头", async () => {
    const { fetchImpl } = stubFetch({
      [PAGE_URL]: () =>
        page("<html><body><h1>标题</h1><p>正文</p></body></html>", "text/html; charset=utf-8"),
    });
    const text = await runFetch(
      { url: PAGE_URL },
      { fetch: fetchImpl, lookup: publicDns },
    );
    expect(text).toContain(`Fetched ${PAGE_URL} (HTTP 200)`);
    expect(text).toContain("# 标题");
    expect(text).toContain("正文");
    // 转换过的证据：原始标签不该出现在给模型的文本里
    expect(text).not.toContain("<h1>");
  });

  it("抓纯文本 → 原样带出，不做 HTML 转换", async () => {
    // 用带 `<` 的正文当探针：如果它被当成 HTML 送进 turndown，
    // 输出就会变形——这一步能区分"走了 text 分支"和"走了 html 分支"。
    const body = "a < b && c > d";
    const { fetchImpl } = stubFetch({
      [PAGE_URL]: () => page(body, "text/plain"),
    });
    const text = await runFetch(
      { url: PAGE_URL },
      { fetch: fetchImpl, lookup: publicDns },
    );
    expect(text).toContain(body);
  });

  it("JSON 也当文本带出（API 返回同样是可读内容）", async () => {
    const { fetchImpl } = stubFetch({
      [PAGE_URL]: () => page('{"ok":true}', "application/json"),
    });
    const text = await runFetch(
      { url: PAGE_URL },
      { fetch: fetchImpl, lookup: publicDns },
    );
    expect(text).toContain('{"ok":true}');
  });

  it("二进制类型 → 抛错并说明不支持", async () => {
    const { fetchImpl } = stubFetch({
      [PAGE_URL]: () => page("\x89PNG", "image/png"),
    });
    await expect(
      runFetch({ url: PAGE_URL }, { fetch: fetchImpl, lookup: publicDns }),
    ).rejects.toThrow(/image\/png/);
  });

  it("非 200 是**结果不是错误**（404 页面本身就是内容）", async () => {
    // 照 DSH 的定性（web/src/types.ts:68-73）：成功抓到非 2xx 响应，
    // 状态码是资源的事实。查"这个链接还在不在"正是靠它。
    const { fetchImpl } = stubFetch({
      [PAGE_URL]: () => page("<p>Not Found</p>", "text/html", 404),
    });
    const text = await runFetch(
      { url: PAGE_URL },
      { fetch: fetchImpl, lookup: publicDns },
    );
    expect(text).toContain(`Fetched ${PAGE_URL} (HTTP 404)`);
  });
});

describe("web_fetch —— 安全", () => {
  it("云元数据地址被拦（169.254.169.254）", async () => {
    const { fetchImpl, calls } = stubFetch({});
    await expect(
      runFetch(
        { url: "http://169.254.169.254/latest/meta-data/" },
        { fetch: fetchImpl, lookup: publicDns },
      ),
    ).rejects.toThrow(/link-local/);
    // 闸门在**发请求之前**生效——绝不能让请求出去再拦
    expect(calls).toEqual([]);
  });

  it("loopback 被拦（放行档下没有人把关，见详案 §7.3）", async () => {
    const { fetchImpl, calls } = stubFetch({});
    await expect(
      runFetch({ url: "http://127.0.0.1:8080/admin" }, { fetch: fetchImpl, lookup: publicDns }),
    ).rejects.toThrow(/loopback/);
    expect(calls).toEqual([]);
  });

  it("非 http/https 被拦（file: / javascript:）", async () => {
    const { fetchImpl, calls } = stubFetch({});
    await expect(
      runFetch({ url: "file:///etc/passwd" }, { fetch: fetchImpl, lookup: publicDns }),
    ).rejects.toThrow(/http/);
    expect(calls).toEqual([]);
  });

  it("⭐ HTML 转换失败时不把原始 HTML 兜给模型", async () => {
    // 600 层嵌套 -> 过不了 html-to-text 的深度守卫（上限 512）。
    // 这是**真实会发生的状态**：病态页面与攻击载荷就长这样。
    const deepHtml = `<div>${"<div>".repeat(599)}深${"</div>".repeat(600)}`;
    const { fetchImpl } = stubFetch({
      [PAGE_URL]: () => page(deepHtml, "text/html"),
    });
    const text = await runFetch(
      { url: PAGE_URL },
      { fetch: fetchImpl, lookup: publicDns },
    );
    expect(text).toMatch(/省略|无法安全转换/);
    // 安全性质：原始标签一个都不许漏出去
    expect(text).not.toContain("<div>");
  });
});

describe("web_fetch —— 失败翻译成人话", () => {
  it("超时 → 抛错里说明是超时", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const fetchImpl: WebFetchToolDeps["fetch"] = async () => {
      throw aborted;
    };
    await expect(
      runFetch({ url: PAGE_URL }, { fetch: fetchImpl, lookup: publicDns }),
    ).rejects.toThrow(/超时/);
  });

  it("网络错误 → 抛错里说明网络失败", async () => {
    const fetchImpl: WebFetchToolDeps["fetch"] = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      runFetch({ url: PAGE_URL }, { fetch: fetchImpl, lookup: publicDns }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("web_fetch —— 工具说明书", () => {
  it("名字、必填参数、且描述里点明内容不可信", () => {
    const tool = createWebFetchTool({});
    expect(tool.name).toBe("web_fetch");
    expect(tool.parameters).toMatchObject({ required: ["url"] });
    expect(tool.description).toContain("不可信");
  });
});
