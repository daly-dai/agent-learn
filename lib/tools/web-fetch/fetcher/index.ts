// ============================================================
// fetcher —— web_fetch 的抓取核心
// ============================================================
// 只做四件事：**过闸门 → 发请求（含重定向）→ 读限额 → 返回原文**。
// HTML→Markdown 是下一步（`html-to-text/`），不在这里。
//
// ⭐ 一条契约（2026-09-14 拍板，照 DSH）：**非 2xx 不算失败**。
// 状态码是**资源的事实**，和状态码一起回来的正文也是内容——上层排版时会写成
// `Fetched <url> (HTTP <status>)`。`http-error` 只留给"协议层面坏掉的响应"
// （3xx 却没有 Location 头）——理由见读正文那一段前的说明。
//
// ⭐ 为什么重定向必须**逐跳重新过闸门**（而不是 `redirect: "follow"`）：
// `follow` 会把重定向完全交给 fetch——一个公网 URL 只要 302 到
// `http://169.254.169.254/`，`ssrf/` 那道闸门就**形同虚设**。
// 所以这里用 `redirect: "manual"`，自己读 Location、自己判、自己跟。
//
// ⚠️ 一个**实测出来的实现细节**（2026-09-14，本地 302 服务实测）：
// Fetch 规范说 `redirect: "manual"` 应返回「不透明重定向」（status 0、头读不到），
// 但 **Node 22 的 undici 并不这么做**——它返回真实的 3xx 响应，
// `status=302 / type=basic / location="/target"` 全都读得到。
// 我们的逐跳校验正是建立在这一点上。**若将来 Node 改成合规**，我们会拿到
// status 0 → 下面 `isRedirect` 不认 → 落到 `http-error`，即**fail-closed**；
// 为了让那次变更不至于变成一个看不懂的 `HTTP 0`，这里专门给了它一条明确的错误。
//
// ⚠️ 诚实边界：本模块不做 DNS 钉连接（见 `ssrf/` 头部说明），
// 所以理论上仍有 DNS rebinding 的 TOCTOU 窗口。本期刻意接受。
// ============================================================

import { guardUrl, type BlockedReason, type Lookup } from "../ssrf";
import { config } from "../../../config";

export type FetchFailureReason =
  | "blocked" // 闸门拒绝（含"重定向到内网"）
  | "too-many-redirects"
  | "timeout"
  | "http-error" // 协议层面坏掉的响应（3xx 却没有 Location 头）；⚠️ **非 2xx 不在此列**
  | "unsupported-charset" // 页面声明的字符集解不了（宁可报错，也不返回乱码）
  | "network";

export type FetchDeps = {
  /** 注入点：测试用桩，真实环境用全局 fetch */
  fetch?: typeof globalThis.fetch;
  /** 注入点：DNS 解析（透传给 ssrf 的闸门） */
  lookup?: Lookup;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export type FetchSuccess = {
  ok: true;
  /** **最终**地址（重定向之后），不是入参那个 */
  url: string;
  status: number;
  contentType: string;
  body: string;
  /** 实际读进来的字节数 */
  bytes: number;
  /** 是否因为超过 maxBytes 被截断 */
  truncated: boolean;
};

export type FetchFailure = {
  ok: false;
  reason: FetchFailureReason;
  detail: string;
  /** 闸门拒绝时把原始原因带出来（上层做分类/展示用） */
  blockedReason?: BlockedReason;
};

export type FetchResult = FetchSuccess | FetchFailure;

// ⭐ 三个上限来自 config.web.fetch（照 `bash-runner` 的写法：
//    `const DEFAULT_X = config.<段>.<字段>`）。原来是本文件里的字面量——
//    全项目只有联网这一批没跟上这个约定（2026-09-14 收口）。
//    仍然保留 `??` 兜底：这三个是可注入的，测试要能单独调小它们。
const DEFAULT_TIMEOUT_MS = config.web.fetch.timeoutMs;
const DEFAULT_MAX_BYTES = config.web.fetch.maxBytes; // 默认 1 MiB（抄 Reasonix）
const DEFAULT_MAX_REDIRECTS = config.web.fetch.maxRedirects;

// 为什么带 UA：不少站点对空 UA 直接 403。写一个诚实的自述，不伪装成浏览器。
const USER_AGENT = "agent-learn/0.1 (web_fetch; +https://github.com/)";
const ACCEPT = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8";

export async function fetchUrl(
  raw: string,
  deps: FetchDeps = {},
): Promise<FetchResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const lookup = deps.lookup;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = raw;

  // hop 从 0 数到 maxRedirects：允许跟 maxRedirects 次，第 maxRedirects+1 次进不来
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const guarded = await guardUrl(current, lookup);
    if (!guarded.ok) {
      return {
        ok: false,
        reason: "blocked",
        detail: guarded.detail,
        blockedReason: guarded.reason,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(guarded.url.href, {
        method: "GET",
        redirect: "manual", // ⭐ 绝不交给 fetch 自己跟——那样重定向就绕过闸门了
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: ACCEPT },
      });

      // 环境变了：规范版的不透明重定向（status 0）。明确报出来，别让它变成一个
      // 看不懂的 `HTTP 0`——这条分支现在是死代码，但它是给未来的 Node 准备的。
      if (response.status === 0) {
        return fail(
          "network",
          "拿到一个不透明响应（status 0）——多半是运行环境的 fetch 开始按规范" +
            "过滤重定向了，`redirect: manual` 不再返回可读的 Location，" +
            "逐跳校验需要换实现（见 fetcher/index.ts 头部说明）。",
        );
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return fail("http-error", `HTTP ${response.status} 但响应里没有 Location 头`);
        }
        // Location 可以是相对路径，用**当前**地址解析成绝对地址
        current = new URL(location, guarded.url).href;
        continue; // 下一跳会重新过闸门
      }

      // ⭐ 非 2xx **不算失败**（2026-09-14 拍板，照 DSH `web/src/types.ts:68-73`）。
      //
      // 原来的写法是 `if (!response.ok) return fail("http-error", ...)`——
      // 那是把"资源的状态码"错当成了"我们的抓取失败"。两个后果：
      //   ① 错误页的正文拿不到，而它常常就是最有用的信息
      //      （403 的"需要登录"、429 的"慢一点"、404 页里的"你是不是要找…"）
      //   ② 上层那个 `Fetched <url> (HTTP <status>)` 头就没意义了——
      //      只有当非 2xx 也能走到排版那一步，才需要把状态码写出来
      //
      // 所以这里**不做状态码判断**，把状态码和正文一起交给上层。
      // ⭐ 解码器要在**读正文之前**建好：字符集认不出来就早退——
      // 既不白下一整篇正文，也不会把乱码当成"抓到的内容"交出去。
      let decoder: TextDecoder;
      try {
        decoder = decoderForCharset(
          parseCharset(response.headers.get("content-type")),
        );
      } catch (error) {
        return fail("unsupported-charset", errorMessage(error));
      }

      const { text, bytes, truncated } = await readCapped(
        response,
        maxBytes,
        decoder,
      );
      return {
        ok: true,
        url: guarded.url.href,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: text,
        bytes,
        truncated,
      };
    } catch (error) {
      if (isAbortError(error)) {
        return fail("timeout", `请求超过 ${timeoutMs}ms 未完成：${guarded.url.href}`);
      }
      return fail("network", `请求失败：${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return fail("too-many-redirects", `重定向超过 ${maxRedirects} 跳：${raw}`);
}

// ------------------------------------------------------------
// 内部
// ------------------------------------------------------------

function fail(reason: FetchFailureReason, detail: string): FetchFailure {
  return { ok: false, reason, detail };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

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

/**
 * 从 `Content-Type` 里取 `charset` 参数，小写；没有就 `undefined`。
 *
 * ⚠️ 只看**响应头**，不去嗅探 HTML 里的 `<meta charset>`——和 DSH 一样。
 * 代价：只在 `<meta>` 里声明字符集的页面仍然会乱码。这是**已知边界**，
 * 不是遗漏（真实中文站点绝大多数会在头里声明，实测 ofweek 那篇就是）。
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "");
  return match?.[1]?.trim().toLowerCase();
}

/**
 * 按声明的字符集建解码器；没声明就 UTF-8。
 *
 * ⭐ **认不出的字符集直接抛错**，不回退 UTF-8——照 DSH 那句注释：
 * *"better to fail loudly than return mojibake"*。
 * 回退看着"更稳健"，实际是把一个明确的失败换成一片看不懂的 `�`：
 * 模型拿到乱码只会瞎猜，用户也查不出到底哪一步错了。
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder("utf-8");
  try {
    return new TextDecoder(charset);
  } catch {
    throw new Error(
      `页面声明的字符集「${charset}」解不了（不猜，直接报错，免得返回乱码）`,
    );
  }
}

/**
 * 边读边数，到上限就停。
 * 为什么不 `await response.text()` 再截断：那样一个 1GB 的响应会被**整个下载**
 * 才被扔掉——限额就失去了意义。
 *
 * @param decoder 由调用方按 `Content-Type` 的 charset 建好（见 `decoderForCharset`）
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  decoder: TextDecoder,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    // 没有流（204/304 之类）：**先按字节截，再解码**——顺序反了会把多字节字符切坏
    const all = new Uint8Array(await response.arrayBuffer());
    const truncated = all.byteLength > maxBytes;
    const kept = truncated ? all.subarray(0, maxBytes) : all;
    return { text: decoder.decode(kept), bytes: kept.byteLength, truncated };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    const remaining = maxBytes - bytes;
    if (value.byteLength >= remaining) {
      chunks.push(value.subarray(0, remaining));
      bytes += remaining;
      truncated = true;
      await reader.cancel().catch(() => undefined); // 主动断开，别把剩下的下完
      break;
    }

    chunks.push(value);
    bytes += value.byteLength;
  }

  // ⚠️ 必须**流式**解码（`{stream:true}`）：分块边界随时可能切开一个多字节
  // 字符，stream 模式会把那半截留到下一块，最后那次无参 `decode()` 才收尾。
  // 一次性 `Buffer.concat(...).toString(编码)` 做不到这件事——它会把每一块
  // 都当成独立的完整文本，于是多字节字符**在块边界上无处不错位**。
  //
  // ⚠️ 被字节上限切开时，尾部仍会变成一个替换字符（U+FFFD）。这是刻意的：
  // 宁可尾部有个乱码，也不要为了"对齐字符"多读一堆字节。
  let text = "";
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();

  return { text, bytes, truncated };
}
