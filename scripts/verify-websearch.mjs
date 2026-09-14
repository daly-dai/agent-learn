// ============================================================
// A5 端点验证（一次性脚本，不进产品代码）
// ============================================================
// 验什么：DeepSeek 的 **Anthropic 兼容端点** + `web_search_20250305`
// 服务端工具，对**我们自己的 key** 是否可用。
//
// 为什么必须本地跑：**沙箱没有外网**（2026-09-14 实测），而这一步是 A5
// 整条搜索路线的前提——端点不可用就得改道（DDG 免费后端 / 第三方搜索 API）。
//
// 用法：
//   node scripts/verify-websearch.mjs
//   node scripts/verify-websearch.mjs            （默认模型 deepseek-v4-flash）
//   $env:A5_MODEL="deepseek-chat"; node scripts/verify-websearch.mjs
//
// key 来源：`.env.local` 里未注释的 DEEPSEEK_API_KEY，或同名环境变量。
//
// ⚠️ 刻意用**原生 fetch（undici）**而不是 `https.request` + 自定义 lookup：
// 上次 A5 就是卡在自定义 lookup 上（Node v22 的 Happy Eyeballs 会以
// `all: true` 调 lookup，回调必须返回 `[{address, family}]` 数组）。
// 这次第一笔就从原生 fetch 开始，先把那条死路绕开。
// ============================================================

import { readFileSync } from "node:fs";

function loadKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    // 没有 .env.local 就走环境变量分支
  }
  return "";
}

const key = loadKey();
if (!key) {
  console.error(
    "❌ 找不到 DEEPSEEK_API_KEY：.env.local 里没有未注释的该变量，环境变量也没有。",
  );
  process.exit(2);
}

const model = process.env.A5_MODEL ?? "deepseek-v4-flash";
const endpoint = "https://api.deepseek.com/anthropic/v1/messages";

const body = {
  model,
  max_tokens: 512,
  messages: [
    {
      role: "user",
      content: "Perform a web search for the query: DeepSeek V4 上下文窗口多大",
    },
  ],
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
};

console.log(`→ POST ${endpoint}`);
console.log(`  model=${model}`);

const started = Date.now();
let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
} catch (error) {
  console.error(`❌ 请求发不出去（原生 fetch 就失败了）：${error.message}`);
  console.error("   这本身就是一条重要信息——先解决网络，再谈 A5。");
  process.exit(1);
}

const text = await res.text();
console.log(`  HTTP ${res.status}   ${Date.now() - started}ms`);

if (!res.ok) {
  console.log("\n--- 响应前 800 字 ---");
  console.log(text.slice(0, 800));
  console.log("\n结论：❌ 端点不可用 → 搜索方案要改道（DDG 免费后端 / 第三方搜索 API）。");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.log("响应不是 JSON：", text.slice(0, 400));
  process.exit(1);
}

const blocks = payload.content ?? [];
console.log(`  content 块类型：${blocks.map((b) => b.type).join(", ") || "(空)"}`);

const searchResult = blocks.find((b) => b.type === "web_search_tool_result");
if (!searchResult) {
  console.log("\n⚠️ 端点通了，但**没有 web_search_tool_result 块**。");
  console.log("   可能是：模型名不对（试 A5_MODEL=...）/ 该 key 没开通搜索 / 工具名变了。");
  console.log("\n--- 响应前 800 字 ---");
  console.log(text.slice(0, 800));
  process.exit(1);
}

const items = Array.isArray(searchResult.content) ? searchResult.content : [];
console.log(`\n✅ 拿到 web_search_tool_result，${items.length} 条结果：`);
for (const item of items.slice(0, 3)) {
  console.log(`   - ${item.title ?? "(无标题)"}`);
  console.log(`     ${item.url ?? ""}`);
}
console.log("\n结论：✅ 端点可用 —— A5 搜索方案照原样开工（复用现有 key，零新增配置）。");
