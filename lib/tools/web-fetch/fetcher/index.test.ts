// ============================================================
// fetcher.test.ts —— web_fetch 的抓取核心
// ============================================================
// 这个模块只做四件事：**过闸门 → 发请求（含重定向）→ 读限额 → 返回原文**。
// HTML→Markdown 是下一步（html-to-text），不在这里。
//
// ⚠️ 测试不碰网络：`fetch` 与 `lookup` 都是注入的。
// 真实场景（AGENTS 11.5 ②）：注入不是为了"好测"，而是因为**真实环境里
// 这两样本来就该被替换**——`web_fetch` 的三种失败（解析不出、超时、过大）
// 在真实网络上都是低频事件，靠真网跑测不出来。
//
// ⭐ 本文件最要紧的一条：**重定向必须逐跳重新过闸门**。
// 如果图省事用 `redirect: "follow"`，一个公网 URL 只要 302 到
// `http://169.254.169.254/`，整个 SSRF 闸门就形同虚设——
// 这是最经典的 SSRF 绕过之一，所以它必须有用例钉死。
// ============================================================

import { describe, expect, it } from "vitest";
import {
  decoderForCharset,
  fetchUrl,
  parseCharset,
  type FetchDeps,
} from ".";

/** 假 DNS：只认表里的域名 */
function fakeLookup(table: Record<string, string[]>): FetchDeps["lookup"] {
  return async (hostname: string) => {
    const found = table[hostname];
    if (!found) throw new Error(`ENOTFOUND ${hostname}`);
    return found;
  };
}

/** 记录每次请求，并按 URL 返回预置响应 */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl: FetchDeps["fetch"] = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`stub 没有为 ${url} 配响应`);
    return route();
  };
  return { fetchImpl, calls };
}

/** 公网域名的通用假 DNS */
const publicDns = fakeLookup({
  "example.com": ["93.184.216.34"],
  "www.example.com": ["93.184.216.34"],
  "other.example.com": ["93.184.216.34"],
});

describe("fetchUrl —— 闸门、重定向、限额", () => {
  it("正常 HTML → 返回状态/类型/正文，url 是最终地址", async () => {
    const { fetchImpl } = stubFetch({
      "https://example.com/": () =>
        new Response("<html><body>hi</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });

    const result = await fetchUrl("https://example.com/", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.contentType).toContain("text/html");
      expect(result.body).toBe("<html><body>hi</body></html>");
      expect(result.url).toBe("https://example.com/");
      expect(result.truncated).toBe(false);
    }
  });

  it("⭐ 闸门在发请求之前：被拦的 URL 连 fetch 都不该调", async () => {
    const { fetchImpl, calls } = stubFetch({});

    const result = await fetchUrl("http://169.254.169.254/latest/meta-data/", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("blocked");
    expect(calls).toEqual([]); // 一次请求都没发出去
  });

  it("⭐ 重定向到内网被拦（用 redirect:follow 的话闸门就是摆设）", async () => {
    const { fetchImpl, calls } = stubFetch({
      "https://example.com/go": () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
    });

    const result = await fetchUrl("https://example.com/go", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("blocked");
      expect(result.detail).toContain("169.254.169.254");
    }
    // 只发了第一跳，内网那一跳根本没发
    expect(calls).toEqual(["https://example.com/go"]);
  });

  it("重定向到另一个公网地址 → 跟随，并返回最终 URL", async () => {
    const { fetchImpl, calls } = stubFetch({
      "https://example.com/": () =>
        new Response(null, {
          status: 301,
          headers: { location: "https://www.example.com/" },
        }),
      "https://www.example.com/": () => new Response("final", { status: 200 }),
    });

    const result = await fetchUrl("https://example.com/", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://www.example.com/");
    expect(calls.length).toBe(2);
  });

  it("重定向打转 → 超过跳数上限就停（不是无限跟）", async () => {
    const { fetchImpl } = stubFetch({
      "https://example.com/a": () =>
        new Response(null, { status: 302, headers: { location: "https://example.com/b" } }),
      "https://example.com/b": () =>
        new Response(null, { status: 302, headers: { location: "https://example.com/a" } }),
    });

    const result = await fetchUrl("https://example.com/a", {
      fetch: fetchImpl,
      lookup: fakeLookup({ "example.com": ["93.184.216.34"] }),
      maxRedirects: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-many-redirects");
  });

  it("相对路径的 Location 也能解析（Location 不一定是绝对 URL）", async () => {
    const { fetchImpl } = stubFetch({
      "https://example.com/a": () =>
        new Response(null, { status: 302, headers: { location: "/b" } }),
      "https://example.com/b": () => new Response("ok", { status: 200 }),
    });

    const result = await fetchUrl("https://example.com/a", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/b");
  });

  it("响应超过大小上限 → 截断并标记 truncated（不能把 1GB 全下下来）", async () => {
    const big = "x".repeat(5000);
    const { fetchImpl } = stubFetch({
      "https://example.com/big": () => new Response(big, { status: 200 }),
    });

    const result = await fetchUrl("https://example.com/big", {
      fetch: fetchImpl,
      lookup: publicDns,
      maxBytes: 1000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      expect(result.bytes).toBe(1000);
      expect(result.body.length).toBe(1000);
    }
  });

  it("超时 → 明确报 timeout（不是笼统的失败）", async () => {
    const fetchImpl: FetchDeps["fetch"] = (_input, init) =>
      new Promise((_resolve, reject) => {
        // 忠实模拟真实 fetch：signal 一 abort 就拒绝
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });

    const result = await fetchUrl("https://example.com/slow", {
      fetch: fetchImpl,
      lookup: publicDns,
      timeoutMs: 30,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  it("HTTP 404 → **算成功**：状态码与正文一起带出来", async () => {
    // ⭐ 2026-09-14 拍板（照 DSH `web/src/types.ts:68-73`）：非 2xx 是**结果**，
    // 不是"抓取失败"。状态码是资源的事实，而错误页的正文常常就是最有用的
    // 信息（403 的"需要登录"、429 的"慢一点"）。
    // 这条以前钉的是「404 → http-error」，方向反了，随语义一起改。
    const { fetchImpl } = stubFetch({
      "https://example.com/missing": () => new Response("nope", { status: 404 }),
    });

    const result = await fetchUrl("https://example.com/missing", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(404);
      expect(result.body).toBe("nope");
    }
  });

  it("3xx 却没有 Location 头 → http-error（协议坏了，不是资源状态）", async () => {
    // 非 2xx 放行之后，`http-error` 只剩这一条路径，所以必须有用例兜着，
    // 否则它就是一段没人测过的代码。真实会发生的状态：反代/网关返回
    // 302 但没带 Location（配置错误），或者中途被剥掉了头。
    const { fetchImpl } = stubFetch({
      "https://example.com/broken": () => new Response(null, { status: 302 }),
    });

    const result = await fetchUrl("https://example.com/broken", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("http-error");
      expect(result.detail).toContain("302");
    }
  });

  it("网络层异常 → 报 network（区分于超时和 HTTP 错误）", async () => {
    const fetchImpl: FetchDeps["fetch"] = async () => {
      throw new Error("ECONNREFUSED");
    };

    const result = await fetchUrl("https://example.com/x", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("network");
  });

  it("⭐ redirect 必须是 manual（否则 302 到内网就绕过了闸门）", async () => {
    // 为什么单独立一条：上面的桩**不实现重定向**，所以就算有人把 manual 改成
    // follow，那些用例照样全绿——而线上 `follow` 会让整个 ssrf 闸门失效。
    // 安全性质的选项得**直接钉住**，不能靠间接行为去推。
    const seen: RequestInit[] = [];
    const fetchImpl: FetchDeps["fetch"] = async (_input, init) => {
      seen.push(init ?? {});
      return new Response("ok", { status: 200 });
    };

    await fetchUrl("https://example.com/", { fetch: fetchImpl, lookup: publicDns });

    expect(seen[0]?.redirect).toBe("manual");
  });
});

// ------------------------------------------------------------
// 字符集：非 UTF-8 页面不能变乱码
// 背景：2026-09-14 用户真机验收时，抓一篇中文文章得到一整片 `�`
// （ASCII 的 `Sora`、数字活下来，中文全变 U+FFFD）——那正是
// "GBK 字节被当 UTF-8 解"的指纹。这一组就是那次的回归。
// ------------------------------------------------------------

describe("parseCharset —— 从 Content-Type 里取字符集", () => {
  it("取出 charset，大小写和引号都认", () => {
    expect(parseCharset("text/html; charset=gbk")).toBe("gbk");
    expect(parseCharset('text/html; charset="GBK"')).toBe("gbk");
    expect(parseCharset("text/html;charset=UTF-8")).toBe("utf-8");
  });

  it("没有 charset → undefined（由调用方决定默认值）", () => {
    expect(parseCharset("text/html")).toBeUndefined();
    expect(parseCharset(null)).toBeUndefined();
  });
});

describe("decoderForCharset —— 认不出就抛错", () => {
  it("没声明 → UTF-8", () => {
    expect(decoderForCharset(undefined).encoding).toBe("utf-8");
  });

  it("认得的非 UTF-8 字符集能建出解码器", () => {
    expect(decoderForCharset("gbk").encoding).toBe("gbk");
  });

  it("认不出的 → 抛错（宁可报错，也不返回乱码）", () => {
    // DSH 那句注释就是这条的理由：better to fail loudly than return mojibake
    expect(() => decoderForCharset("x-not-a-real-charset")).toThrow(
      /x-not-a-real-charset/,
    );
  });
});

describe("fetchUrl —— 按声明的字符集解码", () => {
  it("⭐ GBK 页面解出正确中文（真机故障的回归用例）", async () => {
    // 夹具说明（AGENTS 11.5 ②）：`d6 d0 ce c4` 就是「中文」两个字的 **GBK 字节**，
    // 不是我编的输入——真实那篇 ofweek 文章就是这么被解坏的。
    // 这四字节被当 UTF-8 解时会变成 4 个 U+FFFD，正是截图里那一片 `�`。
    const gbkBytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    const { fetchImpl } = stubFetch({
      "https://example.com/gbk": () =>
        new Response(gbkBytes, {
          status: 200,
          headers: { "content-type": "text/html; charset=gbk" },
        }),
    });

    const result = await fetchUrl("https://example.com/gbk", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("中文");
      expect(result.body).not.toContain("\uFFFD");
    }
  });

  it("没声明字符集 → 按 UTF-8 解（绝大多数页面）", async () => {
    const { fetchImpl } = stubFetch({
      "https://example.com/utf8": () =>
        new Response("中文", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });

    const result = await fetchUrl("https://example.com/utf8", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe("中文");
  });

  it("认不出的字符集 → 明确失败，不是悄悄返回乱码", async () => {
    const { fetchImpl } = stubFetch({
      "https://example.com/weird": () =>
        new Response("x", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=x-not-a-real-charset",
          },
        }),
    });

    const result = await fetchUrl("https://example.com/weird", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unsupported-charset");
      expect(result.detail).toContain("x-not-a-real-charset");
    }
  });

  it("⭐ 多字节字符被**分块边界**切开也要对（必须流式解码）", async () => {
    // 真实网络里分块边界是任意的，「中」(d6 d0) 完全可能被切成两块到达。
    // ⚠️ 上面那些用例都是**单块**响应，测不出这件事——非流式解码
    // （每块独立 decode）在它们那里照样全绿。所以这里手工造一个两块流。
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xd6]));
        controller.enqueue(new Uint8Array([0xd0]));
        controller.close();
      },
    });
    const { fetchImpl } = stubFetch({
      "https://example.com/split": () =>
        new Response(split, {
          status: 200,
          headers: { "content-type": "text/html; charset=gbk" },
        }),
    });

    const result = await fetchUrl("https://example.com/split", {
      fetch: fetchImpl,
      lookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("中");
      expect(result.body).not.toContain("\uFFFD");
    }
  });

  it("多字节字符被字节上限切开时只坏尾部，不整体错位", async () => {
    // 「中文好」= d6d0 cec4 bac3，上限截到 5 字节 → 第三字只剩半个
    const gbkBytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xba, 0xc3]);
    const { fetchImpl } = stubFetch({
      "https://example.com/cut": () =>
        new Response(gbkBytes, {
          status: 200,
          headers: { "content-type": "text/html; charset=gbk" },
        }),
    });

    const result = await fetchUrl("https://example.com/cut", {
      fetch: fetchImpl,
      lookup: publicDns,
      maxBytes: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      // 关键是**前面的字没错位**——流式解码必须把半截字符留到最后
      expect(result.body.startsWith("中文")).toBe(true);
    }
  });
});
