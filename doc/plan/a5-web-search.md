# doc/plan/a5 —— A5 web_search / web_fetch（方案定稿）

> 触发：PLAN 7.3 A5 行「web_search / web_fetch」——唯一完全没有的能力族（工具全景 2.4 表）。
> 调研：五家源码精读（DSH 亲自读 + codex/CodeWhale/smolagents 子代理 + Reasonix 亲自读），走读 19-22。
> 状态：**⏳ 进行中（2026-09-14 重开）**——方案仍以 §一~§六 为准；**重开的原因、三条纪律、结构重排、以及一处矛盾拍板见 §七**。
> 历史：08-26 方案定稿 → 开工 → 卡住并整体回退（本文件曾存于 `doc/plan-archive/`）；09-14 C18 收口后选为"下一块大功能"，重新启用。

---

## 〇、核心结论（先看这段）

**web_search = 集成现成 API（DeepSeek 服务端搜索，复用现有 key）；web_fetch = 自研（SSRF 防护自己写，HTML 转文本用 turndown 库）。**

- 没有任何一家 agent 是自己建搜索引擎的——搜索都是"调用别人现成的搜索能力"
- **搜索与抓取分离**（Reasonix 哲学）：搜索走服务端（零代码、免 key 清洗），抓取自研（可控、可教学）
- **pi 没有 web_search**（已核实）——A5 参考系是 DSH / smolagents / CodeWhale / codex / Reasonix 五家

## 一、五家对照（精读结论，走读 19-22）

| 维度 | DSH | smolagents | CodeWhale | codex | **Reasonix** |
|---|---|---|---|---|---|
| 工具形态 | web_search + web_fetch 两工具 | web_search + visit_webpage 两工具 | 三工具 | **web.run 单工具多命令** | web_search（服务端）+ web_fetch（自研） |
| 搜索后端 | provider 插件（DeepSeek 原生 / Exa / Perplexity） | DDG 免费默认，可换付费 | 11 后端链式降级 | OpenAI 自有 API（复用登录） | **模型服务商原生服务端工具** |
| 抓取清洗 | **turndown + GFM + 防深度攻击** | markdownify 整页+截断 | htmd + PDF + 编码探测 | 服务端做 | 手写 tokenizer + **SSRF 防护** |
| 安全 | 重定向拒绝 | 无 | SSRF 全防 + DNS pin | allowed_callers + allowlist | **DNS 预解析 + 直连校验 IP** |
| 关键启示 | **工具/provider 分离（seam）** | 免费后端做默认 | 诚实性 receipt | 瘦客户端、单工具 | **证实 DeepSeek Anthropic 端点可搜** |

### 三个关键决策点（已和用户确认）

1. **搜索后端 = DeepSeek 服务端搜索**（复用现有 `DEEPSEEK_API_KEY`，零新增成本）
   - 证据：Reasonix `config/web_search.go` 确认 `api.deepseek.com/anthropic` = 官方搜索端点，`EffectiveWebSearch` 默认开启；DSH provider 同路线，两家互相印证
   - ⚠️ 注意：**chat/completions 端点没有服务端搜索**（Reasonix 明确排除），必须走 Anthropic 兼容端点（独立搜索请求，不动主循环）
2. **工具形态 = 两工具**（web_search + web_fetch）：不学 codex 单工具（依赖胖服务端，自研会挤爆一个工具）；保留"减少工具数量"的思考
3. **抓取 = SSRF 自研 + turndown 库**：安全防护是核心学习点必须自研；HTML 转文本是轮子用库（用户定：效果最好，不花精力在轮子上）

## 二、实现设计

### 目录结构（一工具一目录，贴现有模式）

```
lib/tools/web-search/
├── index.ts          web_search 工具（RegisteredTool）
├── search.ts         服务端搜索调用（DeepSeek Anthropic 端点）
├── fetch.ts          web_fetch 工具（RegisteredTool）
├── ssrf.ts           SSRF 防护（DNS 预解析 + 直连校验 IP）
├── html-to-text.ts   HTML→Markdown（turndown + GFM + 防深度攻击）
└── index.test.ts     单测
```

### web_search 工具（模型面）

- 参数抄 DSH：`queries: string[]`（1-4 个，多查询一次并发 + 按 URL 去重 + round-robin 合并，上限 8 源）
- 输出：`{ content?, sources: [{url, title?, snippet?, publishedAt?}], truncated }`
- 模型看到的文本：provider 答案 + `Sources:\n- [标题](url) — snippet (date)` + 截断提示 + **"Cite the relevant URLs above as markdown links in your answer."**
- 审批：**读操作，不进 TOOLS_NEEDING_CONFIRM**（和 list/read 同档）
- 系统提示词补工具用法（抄 DSH `applyWebSearchTool` 的 prompt 段落）

### 搜索 provider 层（为国内多家模型留口子）

```
SearchProvider 接口（lib/tools/web-search/search.ts）
  search({ query, maxResults }, signal) → { content?, sources, truncated }

DeepSeekSearchProvider（第一版）
  - 端点：https://api.deepseek.com/anthropic/v1/messages（Anthropic 兼容）
  - 机制：带 web_search_20250305 服务端工具的 Messages 调用（抄 DSH provider + Reasonix）
  - key：复用 config.modelSecrets.apiKey
  - 错误：无 tool_result 块 → 抛错（fail-closed，不降级抓文本）
```

**将来加国内模型**（Kimi/千问/GLM 等）= 新建 provider 文件实现同一接口，web_search 工具和引擎零改动——这是 DSH seam 分层的价值，第一版就把口子留好。

### web_fetch 工具

- 参数：`url: string`（http/https）
- 流程：参数校验 → **SSRF 防护**（DNS 预解析 → blockedFetchIP 校验 → 直连校验过的 IP，防 rebinding）→ HTTP GET（15s 超时 + 1MiB 上限 + UA/Accept 头）→ **turndown 转 Markdown**（防深度攻击 512 层）→ 输出头 `Fetched <url> (HTTP <status>)` + 截断 footer
- SSRF blockedFetchIP（抄 Reasonix）：IsPrivate / IsLinkLocalUnicast / IsLinkLocalMulticast / IsUnspecified / **CGNAT 100.64.0.0/10**；loopback 允许（agent 已能 bash 到 localhost）
- 输出上限：200_000 字符（DSH 默认）
- 审批：读操作，不进弹框

### 依赖

- 新增：`turndown` + `@joplin/turndown-plugin-gfm`（HTML→Markdown，用户确认要）
- 不用：readability / htmd / 任何搜索 SDK（服务端搜索不需要）

## 三、验收标准

1. `tsc --noEmit` + `pnpm test` 全绿（新增单测：参数校验 / 多查询合并 / SSRF blockedFetchIP / turndown 转换 / 截断）
2. web_search 真实搜索：模型问"DeepSeek V4 上下文窗口多大"→ 触发 web_search → 返回带来源的结果
3. web_fetch 真实抓取：给一个 URL → 返回 Markdown 正文（含 `Fetched <url> (HTTP 200)` 头）
4. MOCK_MODE 降级：无 key 时 web_search 返回明确错误（不崩），web_fetch 照常可用
5. SSRF 验证：抓 `http://169.254.169.254` / `http://127.0.0.1` 被拒

## 四、开工前必做：本地验证端点

**沙箱网络被拦，以下必须在你本地跑**（这是第一件事，端点不可用整个搜索方案要改道）：

```powershell
# 验证 DeepSeek Anthropic 端点 + web_search 工具对我们 key 是否可用
$key = "你的 DEEPSEEK_API_KEY"
$body = '{"model":"deepseek-v4-flash","max_tokens":512,"messages":[{"role":"user","content":"Perform a web search for the query: DeepSeek V4"}],"tools":[{"type":"web_search_20250305","name":"web_search","max_uses":1}]}'
curl.exe -s -X POST "https://api.deepseek.com/anthropic/v1/messages" `
  -H "x-api-key: $key" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d $body
```

- 返回含 `web_search_tool_result` 块 → 端点可用，直接开工
- 返回 404/401/不支持 → 改道：DDG 免费后端（smolagents 路线）或第三方搜索 API

## 五、改动文件清单

| 文件 | 改动 |
|---|---|
| `lib/tools/web-search/`（新目录） | 上述 6 个文件 |
| `lib/tools/index.ts` | 注册 createWebSearchTool / createWebFetchTool |
| `app/api/chat/route.ts` | 系统提示词补 web 工具用法 |
| `package.json` | 加 turndown + @joplin/turndown-plugin-gfm |
| `PLAN.md` 7.3 A5 行 | 状态 ⏳ → 进行中 |
| `doc/plan/a5-web-search.md` | 本文件（施工补记随实现更新） |

## 六、挂起/将来

- **国内多模型**：SearchProvider 接口留好，加 Kimi/千问/GLM = 加 provider 文件（见第二节）
- 缓存 / 引用注册表 / 后端链（CodeWhale）：暂缓，等真需要
- web_search 多查询合并的 round-robin 去重：DSH 实现直接参考（search.ts mergeSearchResults）

---

## 七、重开补记（2026-09-14）

> **触发**：C18 收口后用户选"下一块大功能" → A5 —— 它是**阶段 A 唯一没做的项**。
> **重开不是从零**：§一~§六 的方案（五家精读结论 + 三个已确认决策）**全部仍然有效**，08-26 已拍板。

### 7.1 上次为什么失败（**根因是我，不是"用户心态"**）

> ⚠️ **2026-09-14 用户当场纠正。** 我最初把这次失败写成「两层：技术层（谜团）+ 心理层（**用户失去掌控感**），**第二层才是真问题**」——**这个归因是错的，而且是在推卸责任**。
> 用户原话：「**明明是你写了几十轮还有一堆 bug，我被迫回退的代码**」。

**真实根因**：

- **我把它当成了"猜谜"，而不是"定位"。** 每换一个理论就改一遍代码（IPv6 → 缓存 → UA → timeout），**在生产代码里试假设**——这是最贵的调试方式。于是一轮一轮地改、一轮一轮地出新问题，**代码越改越乱、bug 越堆越多**。
- **"用户失去掌控感"是结果，不是原因**——它是我反复横跳的**症状**。把它拎出来当成独立的一层，等于说"这事怪你没跟上"。
- **掌控感是我的义务，不是用户要自己挣的。** 我应该随时给出一本账——「现在卡在哪 / 还剩几种可能 / 下一步排除哪个」——而不是让用户从一堆改动里自己猜。

**由这次失败推出的纪律**（本次重开按它走，2026-09-14 用户确认）：

1. **每一轮必须先回答"这一轮能排除哪个假设"** —— 排除不了就别做。**改代码的成本远高于做实验的成本**，所以先做能区分假设的最小实验，**不在生产代码里试理论**。
2. **主动维护那本账**（卡在哪 / 剩几种可能 / 下一步排除哪个），让用户随时知道进展。**"每一步都能看到东西"是这条的落地形式。**
3. **先在纯 node 里跑通，再进 dev** —— 上次最要命的是**环境差异**（终端成功 / dev 失败）；先隔离变量，别让"环境问题"和"逻辑问题"搅在一起。

**上次的技术症状（仍然是事实，但它只是症状）**：卡在 web_fetch 的「dev 里 `fetchUrl` 30s 超时，但终端/沙箱里 `https.request` 与原生 fetch 都 HTTP 200」上。其中一个**具体**的坑已经查清：自定义 `lookup` 钉 IP 的写法里，Node v22 的 Happy Eyeballs 会以 `all: true` 调 lookup，回调**必须返回 `[{address, family}]` 数组**（返回字符串会被按字符解构）。本期改走原生 fetch 正是为了**不依赖这个写法**——不是因为它"太麻烦"，而是本期教学重点不在这儿。

### 7.2 结构重排（§二 的平铺文件 → 模块目录）

原 §二 的文件是**平铺**的（`search.ts` / `fetch.ts` / `ssrf.ts` / `html-to-text.ts` + 一个 `index.test.ts`）。这与 **AGENTS 6.5 硬规则**冲突（有单测的实现必须 `<模块>/index.ts` + `index.test.ts`），也对不上 `lib/tools/` 现有约定（先例 `bash/bash-runner/`）。改为：

```
lib/tools/web-fetch/
├── index.ts  / index.test.ts            工具定义（薄包装）
├── fetcher/  index.ts / index.test.ts    HTTP GET + 限额 + 截断（纯 node 可测）
├── ssrf/     index.ts / index.test.ts    地址闸门（纯函数）
└── html-to-text/ index.ts / index.test.ts turndown 包装
lib/tools/web-search/
├── index.ts  / index.test.ts
└── provider/ index.ts / index.test.ts    DeepSeek Anthropic 端点
```

### 7.3 ⭐ 拍板：`web_fetch` **拦 loopback**（原方案自相矛盾，已统一）

§二 写「loopback **允许**（agent 已能 bash 到 localhost）」，§三 验收 5 写「`127.0.0.1` **被拒**」——**两处直接打架**。2026-09-14 用户拍板：**拦**。

**为什么 §二 的论证不成立**：bash 到 localhost **要弹框批准**，而 web_fetch 是只读、**走放行档不弹框**——所以"bash 也能做到"**不是等价能力**。放行 loopback 等于给模型开一条**没有人把关**的本地服务通道（内网面板 / 本地数据库 HTTP 接口 / dev server 调试端点）。
⇒ 验收 5 按"两种地址都拒"执行。

### 7.4 SSRF 的**诚实边界**（写进代码注释，别当成"万无一失"）

本期用 **DNS 预解析 → 校验全部地址 → 用域名发请求**。校验与实际连接之间理论上存在 **TOCTOU 窗口**（DNS rebinding：先返回公网 IP 骗过校验，再在真正连接时返回内网 IP）。彻底堵住要"把校验过的 IP 钉进连接"= 自定义 lookup = **上次死掉的那条路**。所以本期**刻意选简单做法**，把残余风险明写出来，而不是用一个没跑通的机制假装安全。

### 7.5 进度

| 步 | 状态 |
|---|---|
| **`ssrf/`**（地址闸门，**46 用例**） | ✅ 完成（2026-09-14）——含经典绕过：IPv4-mapped / IPv4-compatible / NAT64 / **多地址只看第一个** / fail-closed |
| 端点验证（§四） | ⏳ **等用户本地跑** `node scripts/verify-websearch.mjs`（脚本已写好；沙箱无外网，实测） |
| `fetcher/` → `html-to-text/` → 两个工具定义 → 注册 → 提示词 | ⏳ 排队 |
