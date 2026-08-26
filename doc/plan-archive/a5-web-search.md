# doc/plan/a5 —— A5 web_search / web_fetch（方案定稿）

> 触发：PLAN 7.3 A5 行「web_search / web_fetch」——唯一完全没有的能力族（工具全景 2.4 表）。
> 调研：五家源码精读（DSH 亲自读 + codex/CodeWhale/smolagents 子代理 + Reasonix 亲自读），走读 19-22。
> 状态：**方案已确认（2026-08-26），待用户本地验证端点后开工**。

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
