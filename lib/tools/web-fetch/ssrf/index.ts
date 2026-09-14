// ============================================================
// SSRF 防护 —— web_fetch 抓取前的地址闸门
// ============================================================
// 为什么必须自研（不能"反正有 path 沙箱"）：**web_fetch 抓回来的正文会进模型
// 上下文**，所以一个恶意页面可以在正文里写"请访问 http://169.254.169.254/…
// 获取配置"——这是 prompt injection → SSRF 的经典链。闸门必须卡在**发请求之前**。
//
// ⚠️ 为什么 web_fetch 要拦 loopback，而 bash 到 localhost 却允许（2026-09-14 用户拍板）：
// bash **要弹框批准**，web_fetch 是只读、**走放行档不弹框**——所以"bash 也能做到"
// 并不是等价能力。放行 loopback 等于给模型开一条没有人把关的本地服务通道。
// （归档方案 `doc/plan-archive/a5-web-search.md` 的 §二 与验收 5 在这点上互相矛盾，
//   现已统一为"拦"，见详案补记。）
//
// ⚠️ 诚实边界（别把它当成"万无一失"）：本模块用的是
//   **DNS 预解析 → 校验全部地址 → 用域名发请求**。
// 校验与实际连接之间理论上存在 TOCTOU 窗口（DNS rebinding：先返回公网 IP 骗过
// 校验，再在真正连接时返回内网 IP）。彻底堵住需要"把校验过的 IP 钉进连接"，
// 也就是自定义 lookup —— 而**上次 A5 正是死在那条路上**（Node v22 的 Happy
// Eyeballs 会以 `all: true` 调 lookup，回调必须返回 `[{address, family}]`
// 数组，返回字符串会被按字符解构）。所以本期**刻意选简单的做法**，
// 把残余风险明写在这里，而不是用一个没跑通的机制假装安全。
// ============================================================

import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/** 被拦的原因。不是一句 "forbidden"——说清为什么拒，报错和日志才有用。 */
export type BlockedReason =
  | "scheme"
  | "credentials"
  | "loopback"
  | "private"
  | "link-local"
  | "cgnat"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "unparseable"
  | "resolve-failed";

const REASON_TEXT: Record<BlockedReason, string> = {
  scheme: "只允许 http / https",
  credentials: "URL 里不能带用户名密码",
  loopback: "loopback 地址（本机服务，无人把关不放行）",
  private: "私网地址",
  "link-local": "link-local 地址（含云元数据 169.254.169.254）",
  cgnat: "运营商级 NAT 段 100.64.0.0/10",
  unspecified: "未指定地址",
  multicast: "组播地址",
  reserved: "保留段",
  unparseable: "无法识别的地址（fail-closed）",
  "resolve-failed": "域名解析不出地址",
};

/** 给人/模型看的解释文案 */
export function blockedReasonText(reason: BlockedReason): string {
  return REASON_TEXT[reason];
}

// ------------------------------------------------------------
// 地址判定（纯函数，本模块的主菜）
// ------------------------------------------------------------

/** 一个 IP 字面量是否被拦：返回原因，放行返回 null。
 *  **不认识的输入一律返回 `unparseable`**——fail-closed，不给自己"看不懂就放行"的口子。 */
export function classifyAddress(address: string): BlockedReason | null {
  const text = address.trim();
  const version = isIP(text);
  if (version === 4) return classifyIpv4(parseIpv4(text)!);
  if (version === 6) return classifyIpv6(parseIpv6(text)!);
  return "unparseable";
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function classifyIpv4(b: number[]): BlockedReason | null {
  const [a0, a1] = b;

  if (a0 === 0) return "unspecified"; // 0.0.0.0/8「本网络」
  if (a0 === 10) return "private"; // 10/8
  if (a0 === 127) return "loopback"; // 127/8
  if (a0 === 169 && a1 === 254) return "link-local"; // 169.254/16（云元数据在这里）
  if (a0 === 172 && a1 >= 16 && a1 <= 31) return "private"; // 172.16/12
  if (a0 === 192 && a1 === 168) return "private"; // 192.168/16
  if (a0 === 100 && a1 >= 64 && a1 <= 127) return "cgnat"; // 100.64/10
  if (a0 >= 224 && a0 <= 239) return "multicast"; // 224/4
  if (a0 >= 240) return "reserved"; // 240/4（含 255.255.255.255 广播）

  // 文档 / 基准测试等保留段
  if (a0 === 192 && a1 === 0 && b[2] === 0) return "reserved"; // 192.0.0/24
  if (a0 === 192 && a1 === 0 && b[2] === 2) return "reserved"; // 192.0.2/24 TEST-NET-1
  if (a0 === 198 && (a1 === 18 || a1 === 19)) return "reserved"; // 198.18/15
  if (a0 === 198 && a1 === 51 && b[2] === 100) return "reserved"; // 198.51.100/24
  if (a0 === 203 && a1 === 0 && b[2] === 113) return "reserved"; // 203.0.113/24

  return null;
}

/** 解析 IPv6 成 16 字节。支持 `::` 缩写、zone id（`fe80::1%eth0`）、
 *  以及尾部 IPv4 写法（`::ffff:127.0.0.1`）。解析不出返回 null。 */
function parseIpv6(address: string): number[] | null {
  let text = address;
  const zoneAt = text.indexOf("%");
  if (zoneAt >= 0) text = text.slice(0, zoneAt);

  // 尾部 IPv4 写法 → 换成两段十六进制（::ffff:127.0.0.1 → ::ffff:7f00:1）
  const lastColon = text.lastIndexOf(":");
  if (lastColon >= 0 && text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColon = text.indexOf("::");
  const hasShortform = doubleColon >= 0;
  if (hasShortform && text.indexOf("::", doubleColon + 1) >= 0) return null; // 只能有一个 ::

  const head = hasShortform
    ? text.slice(0, doubleColon).split(":").filter(Boolean)
    : text.split(":");
  const tail = hasShortform
    ? text.slice(doubleColon + 2).split(":").filter(Boolean)
    : [];

  if (!hasShortform && head.length !== 8) return null;

  const missing = 8 - head.length - tail.length;
  if (hasShortform && missing < 1) return null;

  const groups = [
    ...head,
    ...Array.from({ length: hasShortform ? missing : 0 }, () => "0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function classifyIpv6(bytes: number[]): BlockedReason | null {
  const allZero = (from: number, to: number) =>
    bytes.slice(from, to).every((byte) => byte === 0);
  const v4 = () => classifyIpv4(bytes.slice(12));

  // ⭐ IPv4-mapped（::ffff:a.b.c.d）：**必须回到 IPv4 规则**，
  //    否则 `http://[::ffff:127.0.0.1]/` 就是一条现成的绕过
  if (allZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return v4();

  // IPv4-compatible（::a.b.c.d，已废弃但仍可解析）与 NAT64（64:ff9b::/96）同理
  if (allZero(0, 12)) {
    if (bytes.slice(12).every((byte) => byte === 0)) return "unspecified"; // ::
    if (bytes[15] === 1) return "loopback"; // ::1
    return v4();
  }
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    allZero(4, 12)
  ) {
    return v4();
  }

  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return "link-local"; // fe80::/10
  if ((bytes[0] & 0xfe) === 0xfc) return "private"; // fc00::/7 唯一本地地址
  if (bytes[0] === 0xff) return "multicast"; // ff00::/8
  return null;
}

// ------------------------------------------------------------
// URL 闸门（形状检查 + 解析 + 地址检查）
// ------------------------------------------------------------

/** DNS 解析器。抽成参数是为了**测试不碰网络**（沙箱也没有外网）。 */
export type Lookup = (hostname: string) => Promise<string[]>;

export type GuardFailure = {
  ok: false;
  reason: BlockedReason;
  /** 给人/模型看的一句话，含具体是哪个地址触发的 */
  detail: string;
};

export type GuardSuccess = {
  ok: true;
  url: URL;
  /** 解析出来的地址（供抓取时记录/展示；域名类请求可能有多个） */
  addresses: string[];
};

export type GuardResult = GuardSuccess | GuardFailure;

function fail(reason: BlockedReason, detail: string): GuardFailure {
  return { ok: false, reason, detail };
}

const defaultLookup: Lookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
};

/**
 * 抓取前的闸门。**fail-closed**：任何一步不确定就拒。
 * 顺序：URL 形状（协议/凭据）→ 字面量 IP 直接判 → 否则 DNS 解析 → **判全部地址**。
 */
export async function guardUrl(
  raw: string,
  lookup: Lookup = defaultLookup,
): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("scheme", `不是合法的 URL：${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("scheme", `${blockedReasonText("scheme")}（收到 ${url.protocol}//）`);
  }
  if (url.username || url.password) {
    return fail("credentials", blockedReasonText("credentials"));
  }

  // URL 解析后 IPv6 字面量的 hostname 带方括号：[::1]
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // 字面量 IP：不用解析，直接判（内网 IP 连 DNS 都不该查）
  if (isIP(hostname)) {
    const reason = classifyAddress(hostname);
    return reason
      ? fail(reason, `${hostname} 是${blockedReasonText(reason)}`)
      : { ok: true, url, addresses: [hostname] };
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return fail("resolve-failed", `${blockedReasonText("resolve-failed")}：${hostname}`);
  }
  if (addresses.length === 0) {
    return fail("resolve-failed", `${blockedReasonText("resolve-failed")}：${hostname}`);
  }

  // ⭐ 多地址时**任一被拦就拦**——DNS 可以同时返回公网和内网（多 A 记录 /
  //    DNS rebinding），只看第一个地址是真实存在的漏洞
  for (const address of addresses) {
    const reason = classifyAddress(address);
    if (reason) {
      return fail(reason, `域名 ${hostname} 解析到 ${address}（${blockedReasonText(reason)}）`);
    }
  }

  return { ok: true, url, addresses };
}
