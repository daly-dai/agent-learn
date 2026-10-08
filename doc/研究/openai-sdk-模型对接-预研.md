# 预研：用官方 `openai` 包做模型对接（替换 `lib/deepseekModel` 的手写 fetch）

> **这份文档是什么**：`PLAN.md` 需求池里 **C25（多模型支持）** 的**材料**——回答「模型对接改用官方 `openai` npm 包，值不值、坑在哪」。
> **它不是什么**：**不是定案**。C25 的「详细设计 / 验收」还在 `doc/plan/c25-multi-provider.md` 里空着。这份材料只把事实摆齐，拍板权在用户。
> **调研日期**：2026-09-18。
> **追加（同日）**：第 10 节回答「**以后要支持 GLM、Kimi 等等呢**」——结论是**换不换 `openai` 包跟这件事基本无关**，真正的成本在**能力矩阵 + 模型目录**；第 11 节是 GLM/Kimi 的**官方文档核实**。
> ⚠️ **第 9 节有两个「与本次调研无关、但现在就该看」的发现**（`reasoning_content` 400 隐患 · 截断无法表达）——**建议先读那两条**。

## 证据等级（全文按这四级标注）

| 标记 | 含义 |
|---|---|
| **【读源码】** | 亲自读了 `文件:行`（我们的代码 / pi 的代码 / SDK 的 `src/`） |
| **【实测】** | 起本地假 HTTP server 伪造 SSE 流与错误码，用**真 SDK** 打过去的真实行为 |
| **【文档】** | 官方文档 / README 明文 |
| **【推断】** | 我的推理，**未经证实** |

> ⚠️ **证据边界（必须知道）**：本文件的【实测】有两处先天局限，别当铁证用——
> 1. 测的是**伪造的「DeepSeek 风格」SSE**（按官方文档字段描述构造），**没有打真实的 `api.deepseek.com`**（无 key）。所以「`.stream()` helper 在真 DeepSeek 上必崩」这条，证到的是「**SDK 源码逻辑要求 delta 带 `role`，而 DeepSeek 文档里的流式示例不带**」。
> 2. 本地 SDK 是 **6.40.0**；npm `latest` 已是 **7.20.0**，7.x 的行为差异**未核实**（只知道它要 node ≥22）。

---

## 0. 结论先行

**四条读到的**：

1. **主参考项目 pi 就在用这个包**——不是「要不要引入陌生依赖」，而是「**有一个现成范本可以抄**」。`E:\agents-read\pi\packages\ai\package.json:74` = `"openai": "6.40.0"`，OpenAI 兼容逻辑收在 `src/api/openai-completions.ts`。
2. **接缝是真的好**：全仓 47 处 `TeachingModel` 命中，`new DeepSeekModel` **只有一处**（`lib/selectModel.ts:34`）。换适配器内部实现，引擎/工具/压缩/命令**一处都不用动**。
3. **包很轻**：Apache-2.0、**零运行时依赖**（`package.json:27` `"dependencies": {}`），peer 只有可选的 `ws` / `zod`；我们 12 个 route 全是 `runtime = "nodejs"`，无 Edge 限制，**Node ≥18 无需 polyfill**。
4. **三个参考项目走了三条完全不同的路**（见 §2）——**这本身是最有价值的信号**：这不是一个有标准答案的选择。

**三条最值钱的判断**：

1. **收益比想象中小**：SDK 真正替得掉的只有 **SSE 分帧 + `data:`/`[DONE]` 解析 + provider 类型定义 ≈ 100 行机械管道**；而**回调、累积、错误归一、中止语义、调试日志这五类仍要自己写**（§4）。其中**错误归一与中止语义换 SDK 后从「直白」变成「要绕」**（抛异常 vs 静默结束）。
2. **代价是「行为变了但编译器不响」**：至少三处（**坏 JSON 抛错**、**流式中止静默结束**、**默认重试 2 次**）是运行期语义差异，`tsc` 一个字都不会报——而我们的单测**恰好有一条钉着第一条的旧行为**（`lib/deepseekModel/index.test.ts:281`）。
3. **它挡不住 C40，但也不会拦你**：`reasoning_content` 在 SDK 类型里**零命中**，但运行时**完全透传**（不校验、不剥离，【实测】+【文档】）。所以 C40 该做的活一样不少，只是**类型层要多付一次 widen**。

**一句话**：**这是一次「用一个小依赖换 100 行底层管道 + 一套官方类型」的交易，值不值取决于**——更想要「可读性 + 少维护 SSE 解析」（作品判据），还是「零依赖 + 完全透明 + 行为自己说了算」（教学判据）。**两条都能讲通，这是用户要拍的板。**

---

## 1. 现状盘点：我们手写的 637 行，到底写了什么

`lib/deepseekModel/index.ts` 逐段拆开，标出「SDK 有没有对应物」：

| 行号 | 职责 | SDK 提供吗 | 依据 |
|---|---|---|---|
| 84–129 | `postChatCompletion`：发请求 + 网络/HTTP 错误归一 | **半替**（SDK 发请求并把错误**抛**成类型化对象；「转成受控 `AssistantMessage`」仍要自己写） | §3.6 |
| 156–276 | `completeStreaming`：读流循环 | **是** | `core/streaming.js:22-86` |
| 230–254 | 手写 SSE 分帧：`reader.read()` → `indexOf("\n")` → 按行切 | **是，且更严谨**（三种换行 + 双换行切帧） | `core/streaming.js:193-244` + `internal/decoders/line.js` |
| 516–526 | `parseSseData`：剥 `data:`、忽略 `[DONE]`、坏 JSON **返回 `null` 跳过** | **是，但行为相反**（坏 JSON **抛**） | `core/streaming.js:35-51` |
| 196–228 | `consume`：折进 `textBuffer`/`toolCallsAcc`，调 `onDelta` | **否** | SDK 只 `yield` chunk 对象（`:52`） |
| 289–333 | `buildStreamMessage`：累积 → `AssistantMessage` + `stopReasonFor` + `toUsage` | **否** | 我们的统一协议 |
| 342–403 | `toOpenAiMessages`（统一协议 → OpenAI messages） | **否**（SDK 只给类型，不给转换） | — |
| 408–417 | `toOpenAiTools` | **否** | — |
| 422–457 | `toTeachingAssistantMessage`（非流式） | **否** | — |
| 464–478 | `stopReasonFor` / `withFallbackText` | **否** | — |
| 483–502 | `errorAssistant` / `abortedMessage`（受控错误消息） | **否**（「模型层不抛异常」是我们自己的契约） | `lib/agent/index.test.ts:16` 记着这条契约 |
| 528–538 | `safeJsonParse`：坏 arguments → `{_parseError}` | **否** | — |
| 548–567 | `debugLog`（`DEBUG_DEEPSEEK=true`） | **否**（SDK 有 logger，但不是一回事） | §3.9 |
| 578–637 | 手写 provider 类型 | **大部分可换**（除 reasoning / thinking 字段） | §6 |

**净账**：能删 ≈ **100 行**（SSE 分帧 35 + `parseSseData` 11 + provider 类型 45），**不能删 ≈ 300 行**（全过程转换 + 错误契约 + 回调 + 累积），另加**新增**的 try/catch 与中止判定。

**【推断】**：换 SDK 省下的是**最不好自己测的那部分**（SSE 分帧边界），但**测试成本上升**（§7）——现在可以直接 stub `fetch` 造 SSE 字节流测边界，换 SDK 后测边界要么信任 SDK、要么 stub SDK 内部。

### 1.1 blast radius（【读源码】）

`grep "DeepSeekModel|TeachingModel"` 全仓 47 处命中，**构造点只有 1 处**：

- `lib/selectModel.ts:34` — `new DeepSeekModel({ apiKey, baseUrl, model })`
- `lib/deepseekModel/index.test.ts:92` — 测试构造
- 其余全是 `import type { TeachingModel }`（`lib/agent/index.ts:9`、`lib/commands/*`、`lib/summarize/index.ts:22`、`app/api/chat/_pipeline/*`……）

**换 SDK = 改 `lib/deepseekModel/index.ts` + 它的测试，别处不动。** 这正好是 C25 那句「验证 `TeachingModel` 接缝真的能换」的现成检验。

---

## 2. 三条路线：三个参考项目三种做法（**这是本次最有价值的发现**）

| 项目 | 走哪条路 | 一手证据 |
|---|---|---|
| **pi**（主参考） | **用官方 `openai` SDK** | `packages/ai/package.json:74` `"openai": "6.40.0"`；用法全在 `src/api/openai-completions.ts` |
| **DSH**（`deepseek-harness`） | **完全不用 SDK**：自己 `fetch` + 自写 SSE | `packages/llm/llm-deepseek/src/protocols/chat-completions/adapter.ts:330` 直接 `await fetch(\`${connection.baseURL}/chat/completions\`, ...)`；同目录 `sse.ts`，`:41` `import { parseSse } from './sse.ts'`；`package.json:43-49` 依赖段**无 `openai`** |
| **opencode** | **第三条路**：用 Vercel 的 `@ai-sdk/openai-compatible` | `packages/opencode/src/provider/provider.ts:123,817,875` 的 `createOpenAICompatible` |

**【推断】这条分歧比任何单点事实都重要**：三个成熟项目里，**只有 pi 用了官方 SDK，DSH 明确选择不用**——而 DSH 恰恰是**专门做 DeepSeek 对接**的那个。DSH 的 `llm-deepseek` 自己写 SSE，说明「**官方 SDK 对 DeepSeek 的适配**」并不是显然更优的选择（§5 坑 2 给了一个具体理由）。

> ⚠️ **DSH 是活源码，不是死结论**：它的 `sse.ts` 值得我们单独读一遍（**本次未读**），看它怎么处理坏 JSON 与中止——那是**同题目的第二种实现**。

---

## 3. 官方包事实核查

### 3.1 包身份

| 项 | 值 | 依据 |
|---|---|---|
| 本地已装版本 | **6.40.0** | `E:\agents-read\pi\node_modules\openai\package.json:3` |
| npm `latest` | **7.20.0** | registry |
| 许可证 | Apache-2.0 | `package.json:10` |
| 运行时依赖 | **零**（`"dependencies": {}`，字面意义） | `package.json:27` |
| peer 依赖 | `ws`、`zod`，**都 optional** | `package.json:239-250` |
| 7.x 新增 | `undici` / `@smithy/*` / `@aws-sdk/credential-provider-node`（也 optional） | registry latest |
| engines | 6.40.0 **无** `engines`；**7.20.0 要求 `node >=22`** | registry |
| 体积 | 6.40.0 unpacked **9.75 MB / 2512 文件**；7.20.0 **19.58 MB / 3566 文件** | registry `dist.unpackedSize` |
| 发布节奏 | 6.40.0 = 2026-06-01；此前 6.39.x / 6.38 / 6.37 / 6.36 约**每周一版** | `CHANGELOG.md:3,16,31,54,62,85` |

**【推断】**：**每周一版**的发布节奏 + 我们 `package.json` 现在只有 9 个依赖（且全是 UI/构建类）——引入它等于接受一条**持续的升级维护线**。

### 3.2 最小可用形态与 `baseURL` 语义（【读源码】+【实测】）

```ts
// 三个重载（src/resources/chat/completions/completions.ts:61-80）
create(body: ChatCompletionCreateParamsNonStreaming, options?): APIPromise<ChatCompletion>;
create(body: ChatCompletionCreateParamsStreaming,    options?): APIPromise<Stream<ChatCompletionChunk>>;
create(body: ChatCompletionCreateParamsBase,         options?): APIPromise<Stream<ChatCompletionChunk> | ChatCompletion>;
```

- 构造：`new OpenAI({ apiKey, baseURL, maxRetries?, timeout?, dangerouslyAllowBrowser?, fetch? })`（`src/client.ts:426`）
- `baseURL` 默认 `` `https://api.openai.com/v1` ``（`client.ts:426`）；`timeout` 默认 **600000ms（10 分钟）**（`client.ts:446,1201`）；`maxRetries` 默认 **2**（`client.ts:456`）
- **路径拼接**（`client.ts:619-641`）：只有**双斜杠去重**，**不会**自动补 `/v1`。【实测】`baseURL: 'http://127.0.0.1:PORT'` → 最终请求 `/chat/completions`
- **对我们是好消息**：DeepSeek 官方 OpenAI 格式 `base_url` = `https://api.deepseek.com`（**不带 `/v1`**）【文档】；我们 `.env.local` 里现有 `DEEPSEEK_BASE_URL` 无需改

**⚠️ 坑（【读源码】）**：`client.ts:409` 会 `readEnv('OPENAI_BASE_URL')`。**若环境里恰好设了这个变量，会静默覆盖我们传的 `baseURL`**——我们必须显式传，且最好在文档/`.env.local.example` 里声明「本项目不用 `OPENAI_*` 变量」。

### 3.3 流式：`create()` 与 `.stream()` 是两条能力完全不同的路（**最易被文档误导**）

| | `client.chat.completions.create({stream:true})` | `client.chat.completions.stream({...})` |
|---|---|---|
| 返回 | `Stream<ChatCompletionChunk>`（`core/streaming.ts:21`） | `ChatCompletionStream`（`lib/ChatCompletionStream.ts:129`） |
| `for await` | ✅ | ✅（`:542`） |
| `.on('event')` | ❌ **【实测】`typeof raw.on === 'undefined'`** | ✅ |
| `.finalChatCompletion()` | ❌ **【实测】`undefined`** | ✅ |
| `.toReadableStream()` | ✅（`streaming.ts:192-216`） | ✅（`:603-605`） |
| **与 DeepSeek 兼容** | ✅ **【实测】可用** | ❌ **【实测】崩**（见下） |

**⚠️⚠️ `.stream()` helper 在 DeepSeek 形状的流上直接崩（【实测】，本次最重的发现）**

- 【实测】用 DeepSeek 风格的 SSE（delta 里只有 `content`/`reasoning_content`/`tool_calls`，**没有 `role`**）：
  ```
  helper 错误 = OpenAIError: missing role for choice 0
  ```
  把 `role: "assistant"` 加回第一帧后，helper 就正常了。
- **⇒ 对我们而言，`.on()` / `.finalChatCompletion()` 那一整条路不可用，只有裸 `Stream` + `for await` 一条路。**
- ⚠️ 证据边界：测的是伪造流 + SDK 源码逻辑，**没打真实端点**（见文首）。

**SSE 分帧：SDK 做得比我们严谨（【读源码】）**

- `_iterSSEMessages()`（`core/streaming.ts:219-251`）→ `LineDecoder` 按 **`\r\n` / `\n` / `\r` 三种换行**切行，跨 chunk 半行用内部 `Uint8Array` 缓冲兜住（`internal/decoders/line.ts:24-75`）
- `iterSSEChunks()` 按**双换行**切帧（`streaming.ts:257-285`，探测在 `line.ts:106-135`）
- `SSEDecoder` 按 SSE 规范解析 `data:`/`event:`、剥前导空格、忽略 `:` 注释行（`streaming.ts:287-340`）
- `[DONE]`（`streaming.ts:53-56`）；chunk 带 `error` 字段 → 抛 `APIError`（`:69-71`）

**读到的结论**：我们那套是「**一行一个 data**」的简化版（`index.ts:243-252`，只按 `\n` 切、只认 `data:` 前缀）。换成 SDK 是**实打实的正确性收益**，不是省代码。

**`include_usage`**（【读源码】+【实测】）：类型在 `completions.ts:1799`；usage 出现在一个 **`choices: []` 的独立 chunk** 上。我们现在的写法（`index.ts:196-200` 在取 `choices[0]` **之前**捕获 usage）**逻辑可原样平移**。

**工具调用累积：SDK 不做**（【实测】）——裸流下手动累积才对（`toolName=get_weather`，arguments 跨 chunk 拼成 `{"city":"hz"}`）。我们 `index.ts:217-227 + 300-309` **必须保留**。

### 3.4 中止：三种场景行为完全不同（【实测】，全部证实）

| 场景 | 结果 |
|---|---|
| 非流式请求中 abort | **抛 `APIUserAbortError`**（`status = undefined`） |
| **流式迭代中 abort** | **不抛错，`for await` 静默结束**（实测：`流 abort：抛错 = 没有（静默结束）`，耗时 124ms） |
| **重试退避 sleep 期间 abort** | **不打断 sleep**：服务端 `429 + retry-after: 5`，150ms 时 abort → **5018ms 后才抛**，且只请求了 1 次 |

- 静默结束的机制：`core/streaming.ts:91-94` `catch (e) { if (isAbortError(e)) return; throw e; }` —— **错误被吃掉**
- `.stream()` helper 反而补了一刀：`ChatCompletionStream.ts:391-393` `if (stream.controller.signal?.aborted) throw new APIUserAbortError();`（**裸流没有**）

**【推断·对我们的直接后果】**：我们现在的 `index.ts:255-268` 在 catch 里查 `signal.aborted` → `stopReason: "aborted"` + 返回已累积 partial 文本。换裸流后必须**在循环结束后主动查 `signal.aborted`**，否则「用户按了停止」会被显示成「模型正常答完」。pi 就是这么补的（`openai-completions.ts:682-684`）。

### 3.5 错误模型（【读源码】+【实测】）

```
OpenAIError extends Error                          src/core/error.ts:6
└ APIError<TStatus,THeaders,TError>                :8-106   // status/headers/error/code/param/type/requestID
  ├ APIUserAbortError                              :108-112
  ├ APIConnectionError (含 .cause)                 :114-121
  │ └ APIConnectionTimeoutError                    :123-127
  ├ BadRequestError 400 / AuthenticationError 401 / PermissionDeniedError 403
  ├ NotFoundError 404 / ConflictError 409 / UnprocessableEntityError 422
  ├ RateLimitError 429 / InternalServerError >=500  :129-143
```

- 分派：`APIError.generate()`（`error.ts:60-105`）；**无 status 或无 headers → `APIConnectionError`**（`:66-68`）
- 错误体取值 `(errorResponse as any)?.['error']`（`error.ts:70`）——**错误体里必须有 `error` 键**

**⚠️ 坑 A：`err.name` 不是类名（与官方 README 矛盾）**
README 写 `console.log(err.name); // BadRequestError`（`README.md:316`），但【实测】`new BadRequestError(...).name === 'Error'`——那些子类是**空类体**，没覆盖 `name`（`error.ts:129-143`）。
**⇒ 判类型只能用 `instanceof`，绝不能用 `err.name`。**

**⚠️ 坑 B：是 `requestID`（大写 ID），不是 `request_id`**【实测】——`error.ts:30` `this.requestID = headers?.get('x-request-id')`。成功响应侧才是 `_request_id`（由 `.withResponse()` 解构出 `request_id`）。

**注**：`LengthFinishReasonError` / `ContentFilterFinishReasonError` **不在主包顶层导出**（【实测】`OpenAI.LengthFinishReasonError === undefined`），要从 `openai/error` 引。

### 3.6 重试（【读源码】+【实测】）

| 事实 | 依据 |
|---|---|
| `maxRetries` 默认 **2**（= 最多 3 次请求） | `client.ts:456`；【实测】500 → 3 次请求，1203ms |
| `maxRetries: 0` 确实禁用 | 【实测】503 → 请求 1 次 |
| 判定：`x-should-retry` 头优先 > 408/409/429/≥500 > 连接错误/超时 | `client.ts:978-999`、`:756-773` |
| 退避：`min(0.5*2^n, 8)` 秒 × 抖动（≤25%），优先服从 `retry-after-ms`/`retry-after` | `client.ts:1040-1053`、`:1007-1027` |
| **退避 sleep 完全不碰 signal** | `internal/utils/sleep.ts:3` `(ms) => new Promise(r => setTimeout(r, ms))` |

**【实测】流式重试不会重复吐 token**：流式首发 429 → 服务端被请求 2 次 → 最终拿到完整 chunk。机制是重试发生在 `makeRequest` 内、**响应体被消费之前**（`client.ts:830-853`，重试前先 `ShutdownStream(response.body)`）。
**但**：流一旦开始（HTTP 200 已返回）再断流，**SDK 不重试**——与我们「流式读取中断 → error」（`index.ts:269-272`）这条兜底**不冲突，但这条兜底仍然要保留**。

**pi 的指控成立（三重证实）**：源码 `sleep.ts:3` + `client.ts:1035` + 实测 5018ms。pi 的对策是 `maxRetries: 0` + 自研 `abortableSleep`（`provider-retry.ts:97-124`）。

### 3.7 类型严格性 + 未知字段运行时透传（**这一节修正了一个常见误解**）

- **类型是严格 interface，无 index signature**（【读源码】）：`ChatCompletionCreateParamsBase`（`completions.ts:1524-1869`，约 345 行字段）**通篇没有 `[key: string]: unknown`**；全文件只有两处 `[key: string]`，且在 `tools` 匿名 schema（`:1515`）与 `logit_bias`（`:1593`）里。
- **判别是精确的**：`Streaming extends Base { stream: true }`（`:1983-1995`）vs `NonStreaming { stream?: false }`（`:1969-1981`）⇒ **非流式传 `stream:true` 会类型报错**，动态构造 params 会让联合类型退化（这是 pi 那 16 处 `as any` 的真正根因）。
- **但运行时：SDK 不校验、不剥离未知字段——完全透传**（【实测】+【文档】）：
  - 请求侧：body 里塞 `thinking: {type:'enabled'}` → 服务端**原样收到**
  - 响应侧：`message.reasoning_content` **读得到**；流式 delta 里的 `reasoning_content` 在 chunk 上**原样可见**
  - README 官方确认：请求「any extra values you send will be sent as-is」（`README.md:645-657`）；响应「we do not validate or strip extra properties」（`README.md:665-669`）
- ⇒ **`reasoning_content` / `thinking` 只是「类型上没有」，不是「用不了」。** 代价是类型层要写交叉类型或 cast。
- **zod**：`parse()` / `zodResponseFormat` 存在（`completions.ts:164`、`helpers/zod.d.ts:45,46,52`），但 **zod 是 optional**，不 import `openai/helpers/zod` 就不需要。**对我们无用**（我们已统一 `parseSseData` + `safeJsonParse`，`ToolDefinition.parameters` 是裸 JSON Schema）。

### 3.8 运行时 / Edge

- README 明列支持 Node 20+ / Deno / Bun / Cloudflare Workers / **Vercel Edge Runtime**；**React Native 不支持**（`README.md:765-799`）
- 平台探测识别 `EdgeRuntime`（`src/internal/detect-platform.ts:25,73-82`）
- **无 Node 专属 API 硬依赖**：唯一取 `fetch` 的地方是 `src/internal/shims.ts:13-19`，取不到就抛错要求传 `fetch`（不 import `node:http`/`fs`）
- `dangerouslyAllowBrowser`：我们**不需要**（服务端）；pi 所有 provider 都写 `true`（`openai-completions.ts:790` 等），因为它要在 Electron 里跑

### 3.9 调试日志

SDK 有自己的 debug logger（`loggerFor(client)`，`streaming.ts:41`、`client.ts:727`；README 支持 pino/winston），但**格式与开关都不是我们的**。`DEBUG_DEEPSEEK` 那套（`index.ts:548-567`）**仍要自己留**。

---

## 4. 逐项对照：替得掉 / 替不掉 / 变了行为

| 能力 | 我们手写的 | SDK 给的 | 判定 |
|---|---|---|---|
| SSE 分帧（三种换行 / 双换行切帧 / 注释行） | `index.ts:230-254`（简化版） | `streaming.ts:219-340`（规范版） | ✅ **替，且更对** |
| `[DONE]` / `data.error` | `:517-519` / 不处理 | `streaming.ts:53-56` / `:69-71` | ✅ 替（各修一个简化/漏洞） |
| **坏 JSON chunk 容错** | `:516-526` **跳过** | `streaming.ts:61-67` **抛 `SyntaxError`** | ⚠️ **倒退**，见 §5 坑 1 |
| HTTP 错误 → 类型化 | `:121-126` + `:504-509` | `APIError` 家族（status/headers/error/requestID/code/type） | ✅ 替（信息更多） |
| 网络错误 → 受控消息 | `:108-119` | 抛 `APIConnectionError`/`...TimeoutError` | ⚠️ 仍要自己 catch 转 `AssistantMessage` |
| 中止 → 可识别 | `:110-111`、`:255-268` | 请求期抛 / **流内静默结束** | ⚠️ **倒退**，见 §5 坑 2 |
| 重试 | **无** | 默认 2 次、不可中断 | ⚠️ 默认值会**改变我们现在的行为**，必须显式表态 |
| 文本 delta → `onDelta` | `:211-214` | **不给**（只 yield chunk） | ❌ 留 |
| tool_call 按 index 累积 | `:217-227`、`:300-310` | **不给**（裸流不累积；helper 会崩） | ❌ 留 |
| usage 折叠成我们的 `Usage` | `:196-200`、`:322-333` | 值在 `chunk.usage`，折叠要自己写 | ❌ 留（简化） |
| 统一协议 ↔ OpenAI 转换 | `:342-417` | **不给** | ❌ 留 |
| 受控错误消息（模型层不抛） | `:483-502` | **不给**（我们自己的契约） | ❌ 留 |
| 调试日志 | `:548-567` | 有 logger，但格式/开关不是我们的 | ❌ 留 |
| provider 类型定义 | `:578-637` | `ChatCompletionMessageParam` / `ChatCompletionTool` / `ChatCompletionMessageToolCall` / `ChatCompletionChunk` / `ChatCompletion` | ✅ 替（**除 reasoning/thinking**，§6） |

**读到的账**：**替得掉 4 项 / 替不掉 7 项 / 行为反转或需重新表态 4 项。**

---

## 5. 六个必须知道的坑

### 坑 1：坏 JSON 从「跳过」变「抛异常」——而我们的单测正钉着旧行为

- SDK：`JSON.parse` 失败 → 打日志 → **`throw e`**（`core/streaming.ts:61-67`）【读源码】+【实测】抛 `SyntaxError`，**流当场中断，后续帧全丢**
- 我们：`parseSseData` 失败 → **返回 `null` 跳过**（`index.ts:521-525`），注释写着「断流/网络抖动时常见，忽略即可，别让整个流崩掉」
- 单测：`lib/deepseekModel/index.test.ts:281`「**坏 JSON 行被跳过，正常 chunk 不受影响（断流不崩）**」→ **换 SDK 后必红**

**拍板点**：这是「我们的容错策略」vs「SDK 的严格策略」。我们那条是**有意为之**（注释 + 测试都在说这件事），换 SDK 等于**放弃一个有测试保护的设计决策**去换官方默认。要保留就得在 `for await` 外 catch 并区分「坏 chunk」与「真断流」——**但 `SyntaxError` 与真断流的 `TypeError` 混在同一层**（【推断】，未实测），区分起来不干净。

### 坑 2：流式中止「静默正常结束」

见 §3.4。对策是循环后查 `signal.aborted`（pi：`openai-completions.ts:682-684`）。**漏了就是「停止按钮失灵，界面显示答完了」。**

### 坑 3：不写 `maxRetries: 0`，就悄悄获得了「不可中断的 2 次重试」

见 §3.6。我们现在零重试，**这是引入 SDK 后第一件要显式表态的事**。

### 坑 4：`.stream()` helper 对 DeepSeek 不可用

见 §3.3。**别被 README 的 `.on()` / `.finalChatCompletion()` 示例吸引** —— 那条路在 DeepSeek 形状的流上崩（【实测】`missing role for choice 0`）。

### 坑 5：`reasoning_content` 只缺类型、不缺运行时（**直接压在 C40 上**）

- 类型：grep `reasoning_content|reasoning_details|reasoning_text` → **0 命中**
- 运行时：**完全透传**（§3.7）
- pi 的做法可直接抄：交叉类型扩展（`openai-completions.ts:276-279`）+ 运行时按 `["reasoning_content","reasoning","reasoning_text"]` 顺序取第一个非空（`:605-614`）+ 用签名记住字段名再回放（`:1336-1338`；`:619-622` 甚至处理了 opencode-go 把 `reasoning` 映射成 `reasoning_content` 的特例）
- **可回填 C40 的「依据」节**（它现在写着「待侦察」）

### 坑 6：工具调用参数累积 SDK 不管，且「chunk 里 arguments 是 string」会骗人

- 我们：`index.ts:217-227` + `:300-310`（按 index 累积后 `safeJsonParse`）
- pi：**也是自己拼**，但更复杂——用 `partial-json` 做**流式部分解析**（`openai-completions.ts:459` `parseStreamingJson(block.partialArgs)`），为了「边收边喂界面」
- **这是路线分歧点**，与用不用 SDK 无关；但换 SDK 时容易误以为「SDK 会帮我拼」（因为 chunk 类型里 `arguments` 看着像完整串，**实际是分片**）

---

## 6. 类型账

**能删**（`index.ts:578-637`，约 45 行）：`OpenAiMessage` → `ChatCompletionMessageParam`；`OpenAiToolCall` → `ChatCompletionMessageToolCall`；`OpenAiTool` → `ChatCompletionTool`；`OpenAiChunk` → `ChatCompletionChunk`；`OpenAiResponse` → `ChatCompletion`。

**要付**：

1. **reasoning / thinking 的交叉类型**（官方没有）：pi `openai-completions.ts:276-279` 的写法。
2. **参数对象的联合类型问题**：正解是把 params **显式标注** `ChatCompletionCreateParamsStreaming`（pi `:816` 就这么写）；**尽量少用 `as any`**——pi 有 **16 处**（`:829,838,851,867,887,891,895,902,923,925,928,964,968,982,992`），但其中 `stream_options` 那处（`:829`）**根本不需要**（类型里就有，`completions.ts:1799`）。**这是我们能做得比 pi 干净的地方。**
3. **导入路径**：pi 用 `from "openai/resources/chat/completions.js"`（`.js` 后缀）；也可 `import OpenAI from 'openai'` 后用 `OpenAI.Chat.Completions.ChatCompletionMessageParam`（命名空间再导出，`completions.ts:2031-2073`）。我们 `moduleResolution: "bundler"` 下哪种能过**待实测**。
4. **`skipLibCheck: true`**（`tsconfig.json` 有）→ SDK 的 `.d.ts` 有问题也不炸我们的 `tsc`；**代价**是类型错也看不出来。

---

## 7. 测试影响：现有 426 行测试哪些会红

`lib/deepseekModel/index.test.ts` 的思路是「**stub 全局 fetch 返回手写 Response**」（`:41-58`）——**这个思路换 SDK 后仍然可行**（SDK 默认用 `globalThis.fetch`）。三个具体影响：

| 测试 | 换 SDK 后 | 依据 |
|---|---|---|
| `:281` 坏 JSON 行被跳过 | ❌ **必红**（坑 1） | `streaming.ts:61-67` |
| `:385` `errorMessage` 含 `"network down"` | ⚠️ **可能红**：SDK 包成 `APIConnectionError`，message 前缀变 | `client.ts:398` |
| `:369` HTTP 500 → 含 `"500"` | ⚠️ **可能红**：SDK 抛 `InternalServerError`，message 格式由 SDK 定 | `error.ts:143` + `APIError.makeMessage` |
| `:434` usage chunk 折叠 | ✅ 预期绿（字段名一致） | `completions.ts:555-560` |
| `:328` tool_call 分片累积 | ✅ 预期绿（累积仍是我们的代码） | — |
| `:402` signal 已中止 → `aborted` | ✅ 预期绿（请求期抛 `APIUserAbortError`，我们 catch 后查 signal） | `client.ts:357-359` |
| 其余协议转换测试 | ✅ 预期绿（转换代码不动） | — |

**⚠️ 一个必须注意的构造时机问题（【读源码】）**：SDK 在**构造时**抓 `globalThis.fetch`（`client.ts:160` + `shims.ts:13-19`）。现在 `makeModel()`（`:91-93`）在 `stubFetch()` **之后**调用，所以没问题；**若将来把 client 提前成模块级单例，测试会静默走真网络**。

**【推断】**：换 SDK 会让这个测试文件从「**测我们的 SSE 解析**」变成「**测我们的转换 + SDK 的行为**」。前者是自研代码的边界测试，后者是给第三方行为写回归测试——**一种测试价值的稀释**，拍板时值得掂量。

---

## 8. 待拍板的问题（**每条都写清「缺什么才能定案」**）

| # | 问题 | 缺什么 |
|---|---|---|
| 1 | **要不要引入这个依赖？** 技术上两条路都成立（§2 三个成熟项目各选一条）；判据冲突：`AGENTS.md` 说「可读性 > 功能完备」，而零依赖是现状（`package.json` 只有 9 个 UI/构建类依赖） | **用户的取舍** |
| 2 | **坏 JSON 容错还要不要？** | 若要保留，得**实测** `SyntaxError` 与真断流异常能否干净区分；没实测不能拍 |
| 3 | **重试要不要？** 要 → 抄 pi 的 `provider-retry.ts`（SDK 自带不可中断）；不要 → 显式 `maxRetries: 0` | **用户的取舍** + 定了才有实现细节 |
| 4 | **导入路径 / ESM 互操作**：`from "openai"` vs `"openai/resources/chat/completions.js"` 哪个能过 `tsc` 与 `next build` | **一次实测**（装包 → 一行 import → `tsc --noEmit` + `next build`）。**没跑过不许写进详案** |
| 5 | **装 6.x 还是 7.x？** 6.40.0 无 `engines`；**7.x 要 node ≥22**，且体积翻倍（9.75MB → 19.58MB） | 我们实际 node 版本 + **用户的取舍** |
| 6 | **离线能不能装**：`pnpm add openai` 需要网络；本地 `E:\agents-read\pi\node_modules\openai`（6.40.0）可离线拷 | **实测一次**，否则详案不能承诺「离线可跑」 |
| 7 | **失败会怎样**（作品判据要求「知道它什么时候会失败」）：现在手写 SSE 的失败模式我们**逐个测过**；换 SDK 后部分失败模式**转移到第三方**，还有三条关键行为（坏 JSON / 流式中止 / `.stream()` 崩）**在 README 里一个字都没提** | **用户的取舍** |
| 8 | **C25 与本次预研的关系**：C25 原意是「接第二家 provider」，本预研是「换对接手段」 | **用户定范围**（合成一次迭代 / 分开） |

---

## 9. 独立发现（**与换不换 SDK 无关，但更紧急**）

### ⚠️ 带 `tools` 时 `reasoning_content` 必须全量回传，否则 API 返回 400

**【文档】**（DeepSeek 官方 Thinking Mode 页，原文）：

> "for requests carrying the `tools` parameter, the `reasoning_content` must be fully passed back to the API in all subsequent requests — **even for turns where the model did not perform a tool call**. If your code does not correctly pass back `reasoning_content`, the API will return a **400 error**."

同一页还写着：**思考模式默认开启，默认 effort 为 `high`**；思考模式下 `temperature` / `presence_penalty` / `frequency_penalty` **不支持**（设了**不报错但不生效**）；`top_p` 只在思考模式下生效且**下限被抬到 0.95**。

**把它和我们代码放在一起看**：

| 事实 | 依据 |
|---|---|
| 我们的 harness **永远带 `tools`**（agent loop 的定义） | `lib/agent/index.ts` 每轮都传 tools |
| 我们的适配器**完全不捕获、不回传** `reasoning_content` | `lib/deepseekModel/index.ts:342-403` 只保留文本与 tool_calls；`lib/types.ts` grep `reasoning` **0 命中** |
| C40 需求原文也记着这件事 | `doc/plan/c40-reasoning-render.md:9` |

**【推断，必须实测确认】**：按文档字面意思，**带 tools 的第二轮请求就会 400**。但我们项目现在显然能跑——所以至少有一个前提不成立（可能是 `deepseek-v4-flash` 默认不启思考模式，可能是服务端实际宽松，也可能是我们没触发到那个分支）。
**⇒ 这条不是换 SDK 引入的，换 SDK 也不会自动解决。它是一个应当单独验证的现存问题**，且验证成本很低：**开一次 `DEBUG_DEEPSEEK=true` 看请求、或直接发一轮带 tools 的两轮对话**。
（顺带：这条一旦确认为真，C40 就从「**想要**渲染思考过程」升级为「**必须**回传思考过程」，优先级会变。)

### ⚠️ 独立发现 2：**截断（`finish_reason:"length"`）在我们的协议里无法表达**——而 C39 的前提正是它

**【读源码】三条事实，放在一起看**：

1. `lib/types.ts:41`：`stopReason: "stop" | "toolUse" | "error" | "aborted"` —— **没有 `"length"`**。
2. `lib/deepseekModel/index.ts:464-471`：`stopReasonFor` 只认「`finish_reason === "tool_calls"` 或内容里有 tool call」→ `toolUse`，**其余一律 `stop`**。
3. `doc/plan/c39-truncated-toolcall-guard.md:9`（需求池 C39 原文）：「模型输出被截断时（**`stopReason="length"`**），流式累积的 arguments 是**残缺 JSON**，可能被 parse 成不完整对象**拿去执行**」

**⇒ 结论**：**C39 这条需求的前提在我们代码里不成立**——`"length"` 这个值**根本到不了 `AssistantMessage`**，它在 `stopReasonFor` 里被吞成 `stop`。也就是说：**「模型因长度被截断」这件事，现在的引擎和界面都无法知道**，看上去和「模型正常答完」一模一样。

**为什么这不只是「少一个枚举值」**：截断的 tool_call **即使 JSON 合法**（例如 `write_file` 的 `content` 只写了一半、但引号闭合了），`safeJsonParse`（`:528-538`）也会**正常解析**并**拿去执行**——`_parseError` 那条兜底只挡「JSON 语法坏掉」，**挡不住「语法合法但语义残缺」**。所以 C39 真正的风险（残缺 tool_call 被执行）**在 `stopReason` 修好之前是不可检测的**。

**不止 `length`**：【文档·代理核实】GLM 的 `finish_reason` 还有 `sensitive` / `network_error` / `model_context_window_exceeded`（见 §11.2），pi 把**所有未知/异常值一律映射成 `error`**（`openai-completions.ts:1552-1576` 的 `default` 分支，有测试 `test/openai-completions-tool-choice.test.ts:549-582` 用 `network_error` 验过）。我们现在的实现在这三种情况下**都会报「正常结束」**。

**⇒ 这一条与 C25 / 换不换 SDK / 接不接 GLM 全都无关，是现在的漏洞。** 修它要动 `lib/types.ts`（加枚举值）+ 适配器（改映射）+ 引擎（消费新值，**红线文件**）。

---

## 10. 追问：以后要支持 GLM、Kimi 等等呢？（2026-09-18 追加）

### 10.1 一句话：**难点不在传输层，在能力矩阵**

GLM / Kimi / DeepSeek 全都是 **OpenAI 兼容**（`baseUrl` + `/chat/completions`），所以「传输层」早就通了——**这也是为什么换不换 `openai` 包跟这件事基本无关**。真正的成本在另外两样：

1. **能力矩阵**：各家在「同一个 OpenAI 协议」上**各有各的缺**（role、max_tokens 字段名、strict tools、usage-in-stream、finish_reason、thinking 参数形状……）。pi 用 **27 个字段**的 `OpenAICompletionsCompat`（`src/types.ts:673-750`）表达它。
2. **模型目录**：每个模型 id 对应 `contextWindow` / `maxTokens` / 价格 / 是否支持 reasoning / 是否支持 strict tools——pi 专门有个 `scripts/generate-models.ts`（**3262 行**）从外部数据生成 `src/providers/data/*.json`。

### 10.2 一手事实：GLM 和 Kimi 到底哪里不一样

**【读源码】**：pi 的差异**不在** provider 声明里（`zai.ts` 只有 15 行），而在 `scripts/generate-models.ts` 的 per-provider 块和 `src/api/openai-completions.ts` 的 `detectCompat()` 里。

| 维度 | DeepSeek | GLM / Z.AI | Kimi / Moonshot |
|---|---|---|---|
| `baseUrl` | `https://api.deepseek.com`（**无 `/v1`**） | `https://api.z.ai/api/coding/paas/v4`（`providers/zai.ts:10`）；国内探测按 `open.bigmodel.cn`（`openai-completions.ts:1591`） | 国际 `https://api.moonshot.ai/v1`、国内 `https://api.moonshot.cn/v1`（`generate-models.ts:2390-2391`，**都带 `/v1`**）；另有 coding 专用 `https://api.kimi.com/coding`（`:2368`） |
| thinking 参数形状 | `"deepseek"`：`thinking:{type}` + 可选 `reasoning_effort` | `"zai"`：`thinking:{type}`（`generate-models.ts:1416`） | **`"deepseek"`——Kimi 也用 DeepSeek 形状**（`:2399`）；**`kimi-k3` 例外 → `"openai"`**（`:2418`） |
| `supportsReasoningEffort` | ✅ | ❌（被 `isZai` 排除，`openai-completions.ts:1638`） | ❌（被 `isMoonshot` 排除）；**kimi-k3 ✅**（`:2419`） |
| `maxTokensField` | `max_tokens` | `max_tokens` | `max_tokens`（`generate-models.ts:2397`） |
| `supportsStrictMode` | ✅ | ✅ | ❌（`openai-completions.ts:1664`） |
| 流式工具调用的私有开关 | — | **`zaiToolStream: true`**（顶层 `tool_stream`；**部分模型不支持**，见 `ZAI_TOOL_STREAM_UNSUPPORTED_MODELS`，`generate-models.ts:1418`） | — |
| `requiresReasoningContentOnAssistantMessages` | ✅（`openai-completions.ts:1645`） | ❌ | ❌；**kimi-k3 ✅**（`:2417`） |
| `supportsStore` / `supportsDeveloperRole` | — | — | 都 `false`（`:2394-2395`） |
| 模型收录规则 | — | — | **`if (m.tool_call !== true) continue`**——**不支持工具的模型直接不收**（`:2412`） |

**读到的三条结论**：

1. **「OpenAI 兼容」是程度问题，不是布尔值**——Kimi 的 `thinkingFormat` 跟 DeepSeek 同形，`kimi-k3` 又切成 OpenAI 形；GLM 有自己的 `tool_stream`。**同一个厂商的不同模型都可能不一样**（所以矩阵挂在**模型**上，不是挂在厂商上）。
2. **`max_tokens` 字段名是个高频坑**：`useMaxTokens` 名单里 DeepSeek/Moonshot/Zai/Together/Nvidia/AntLing/Cloudflare 全中（`openai-completions.ts:1619-1627`）——用 `max_completion_tokens` 发给他们会怎样**未知**。
3. **pi 对「回传 reasoning」的处理**：`compat.requiresReasoningContentOnAssistantMessages` 为真时，**若没有真实思考内容就补一个空串**（`assistantMsg.reasoning_content = ""`，`openai-completions.ts:1376-1382`）；能拿到真实内容时按 `thinkingSignature` 记的字段名回写（`:1330-1339`）。**⇒ 这印证了我们 §9 那条隐患是真实的**：pi 专门为它做了一个 compat 开关 + 回填逻辑，而**我们还什么都没有**。

### 10.3 「遇到一家没见过的 OpenAI 兼容服务」怎么办：默认探测 + 逐字段覆盖

pi 的机制（**这是最值得抄的一段设计**）：

- `detectCompat(model)`（`openai-completions.ts:1583-1679`）：按 **provider 名 或 baseUrl 子串**猜一组默认值——`api.z.ai`/`open.bigmodel.cn` → 当 GLM；`api.moonshot.` → 当 Kimi；`deepseek.com` → 当 DeepSeek
- `getCompat(model)`（`:1685-1714`）：**detected 打底，`model.compat` 逐字段 `??` 覆盖**

**⚠️ 读到的隐患**：它按 **URL 子串**认人（`:1590-1600`）——**厂商换域名就静默漏判**（漏判的后果不是报错，是「用了错的参数形状」，可能只是效果变差）。

### 10.4 三个项目给出的三种组织方式（**这是「要不要支持很多家」的真正选择题**）

| 项目 | 组织方式 | 代价 |
|---|---|---|
| **pi** | 一个通用 `openai-completions` 适配器 + 27 字段 compat 矩阵 + **生成式模型目录** | 适配器 **1723 行**、16 处 `as any`、大量厂商私有参数分支、外加一个 3262 行的目录生成器。换来 ~40 家 |
| **opencode** | **不自研**：基于 Vercel 的 `@ai-sdk/openai-compatible`（`provider.ts:123,817,875`） | 把「各家差异」外包给第三方库的更新节奏 |
| **DSH**（最值得看） | **双层**：`llm` 是 provider 中立**契约**包（`types` / `message` / `content` / `assistant-stream` / **`assembler`** / `adapter-failure` / **`retry-policy`** / `invariant` / `brand`）；`llm-deepseek` 是**手写**适配器（自己 `fetch` + 自写 `sse.ts`，**不用 SDK**）；**外加 `llm-pi-ai`**（12 个文件，含 `replay.ts` / `catalog.ts` / `discovery.ts` / `login.ts`）把**其他所有家**整体接过来 | 两套适配器并存 |

**【推断】DSH 的答案是对我们这类项目最贴切的**：**自己最在意的那家手写**（DeepSeek —— 因为要抠它的 thinking / reasoning_content / 缓存细节），**长尾整体包给一个多 provider 库**（pi-ai / ai-sdk）。既不为长尾写 40 个适配器，也不让最在意的那家受制于第三方抽象。

### 10.5 映射到我们现在的结构

**已经是对的形状**：`config.provider`（单表）+ `selectModel`（分支）+ 一个适配器 + `TeachingModel` 接缝。

**缺三样**：

1. **`ProviderConfig` 里没有能力字段**（`lib/config/index.ts:47-78` 现在只有 `label` / `baseUrl` / `model` / `search` / `contextWindow` / `reserveTokens` / `keepRecentTokens` / `keepRecentMessages`）——加第二家时，「这家支不支持 `stream_options.include_usage`」这类问题**无处安放**。
2. **适配器里没有矩阵，只有分支**——`DeepSeekModel` 的名字本身就把 provider 写死在类名里了。
3. **没有模型目录**：换模型 = 改 `.env`，但「这个模型的上下文窗口多少」现在硬编码在 `PROVIDERS.deepseek.contextWindow`（`index.ts:97`，靠 `CONTEXT_WINDOW` env 覆盖）。

**另外一个已经存在的结构压力（【读源码】）**：`config.provider` 是**单数**（`PROVIDERS[providerKey] ?? PROVIDERS.deepseek`，`index.ts:108-112`），而 `search` 端点被塞在**同一个 provider 对象**里（`index.ts:55-65` 的注释解释了为什么它绝不能复用 `baseUrl`）。**再加两家，「provider 单例」这个模型会开始绷不住**——因为「跟哪家说话」和「用哪种能力」开始不是一回事了。

### 10.6 追问：**照 DSH 的做法要改多大？**（2026-09-18 追加）

「按 deepseek 的做法」有两层，**成本差约 100 倍**，必须拆开答。

**量出来的对比（行数为实测，剔除 `*.test.ts`）**：

| 层 | DSH | 我们 | 判读 |
|---|---|---|---|
| **provider 中立契约包** | `llm/src` **3595 行 / 14 文件**（`types` 459、`assistant-stream` 501、`content` 336、`message` 244、`assembler` 194、`retry-policy` 174、`error` 156、`invariant` 104、`adapter-failure` 99、`call-config` 71、`brand` 65、`attribution` 62、`api-key` 37 + `index` 1093） | `lib/model.ts` **19 行** + `lib/types.ts` + `lib/message.ts` | **形状相同，规模差 ~100×** |
| **适配器抽象契约** | `LlmAdapter`：**1 个必需方法**（`abstract stream()`，源码原话 *"The only required method."*，`llm/src/index.ts:280-284`）+ 6 个有默认实现的可选方法（`providerInfo` / `providerRetryPolicy` / `imageRequestPricing` / `listModels` / `resolveModel` / `prepareCall`） | `TeachingModel`：**1 个方法** `complete()` | **✅ 等价——接缝形状已经相同** |
| **单 provider 适配器本体** | `llm-deepseek/src/adapter.ts` **58 行**（只是「按协议分发」的空壳，真正实现委托给 `ChatCompletionsAdapter` / `DeepSeekMessagesAdapter`） | `lib/deepseekModel/index.ts` 637 行（全塞一个文件） | 我们更「胖」但更少文件 |
| **单协议实现** | `protocols/chat-completions/` = adapter 355 + serialize 416 + translate 193 + types 164 + sse 37 = **1165 行** | 637 行 | 差的 ~500 行几乎全是**我们用不到的功能**（`files-api` 274 / `file-store` 325 / `image-tokens` 146 / `request-files` 138 / `request-pricing` 105 / `model-info` 96） |
| **SSE 分帧** | `sse.ts` **40 行**——而且**不是手写**：`import { EventSourceParserStream } from 'eventsource-parser/stream'`（`sse.ts:14`），只补了 `[DONE]` 语义与「EOF 没等到 `[DONE]` 就是截断，抛 `LlmError('STREAM_CLOSED')`」（`:39`） | ~46 行手写 | **规模相同** |
| **流片段 → 消息组装** | `assembler.ts` **194 行**，独立共享模块（各 adapter 复用） | `buildStreamMessage` 32 行，**在适配器内部** | 规模小，**但位置不同** |
| **重试** | `retry-policy.ts` **174 行**，独立模块、**按 provider 配**（`providerRetryPolicy()`） | 无 | 我们没重试 |
| **模型目录** | `llm-pi-ai/src/catalog.ts` 890 行 + `models.ts` 62 行 + `discovery.ts` 347 行 | `config.provider.contextWindow` **一个数字**（`lib/config/index.ts:97`） | 差一个「目录」概念 |
| **整个 hand-written provider 包** | `llm-deepseek` **3896 行 / 29 个源文件** | 637 行 | — |

**结论（三条，都可查）**：

1. **思想层不用大改**：DSH 的 `LlmAdapter` 抽象契约**只有一个必需方法**，其余全是可选；我们的 `TeachingModel` **就是一个方法**。**形状已经相同** ⇒ 支持多家**不需要动 `lib/agent/index.ts`（红线文件）**，也不推翻现有接缝。
2. **实现层是 3595 行的契约包 + 3896 行的 provider 包，不该抄**。那些代码在为「50+ 包插件化 / 热插拔 / 多进程远程服务（`TypertRemoteService`）/ waterfall 中间件 / 深冻结 + `structuredClone` 不可变日志」服务——**我们不是那个形态**。照抄等于为不需要的复杂度付费（正撞 `AGENTS.md` 的「接缝由需求逼出来，不预挖空壳」）。
3. **真正要动的是三处「位置」，不是「规模」**（且**都还没到**）：
   - **provider 差异**：从「适配器里的分支」变成「配置里的字段」——**加字段，不改结构**
   - **「流片段 → 消息」**：从适配器内部提到共享位置（DSH 的 `assembler` 形态）——**只有接第二家、且逻辑真的要复用时才值得**
   - **`config.provider` 从单数变可寻址**——**只有真加第二家时才需要动**

**⭐ 但有一个我之前没提、它才是真「大改」的点：接缝宽度。**

- 我们的 `CompleteInput.onDelta` 签名是 **`(delta: string) => void`**（`lib/model.ts:14`）——**只能吐纯文本**，没有「这是文本增量 / 这是思考增量 / 这是工具参数增量」的区分。
- DSH 的对应物是 **chunk 流**（`AsyncIterable<StreamChunk>`，`assistant-stream.ts` 501 行在描述它）——**每类增量都是带类型的事件**。
- ⇒ **C40（思考过程渲染）要撞的正是这里**：要把 `reasoning_content` 增量推上界面，就得把 `onDelta(text)` 拓宽成带类型的增量。**而消费端在 `lib/agent/index.ts:221`** ⇒ **这会动红线文件**。

**所以准确的说法是**：**「支持 GLM/Kimi」不用大改；「让思考过程上屏（C40）」才要碰红线。** 两件事经常被混在一起谈，其实是两个不同的改动面。

**⚠️ 顺带纠正一个可能的误解**：DSH **不用 `openai` SDK，并不等于什么都手写**——它的 SSE 用的是小库 `eventsource-parser`（`sse.ts:14`）。⇒ 存在**第三条路**：**不换大 SDK，只补一个小库**（我们的 ~46 行手写分帧换成它），其余（错误归一、思考字段、`safeJsonParse`、受控消息）**全部保留**。这可能是**改动量最小、行为倒退最少**的选项，但要先单独评估这个小库（依赖、维护、是否满足我们的容错策略）。

### 10.7 这一节的待拍板问题

| # | 问题 | 缺什么 |
|---|---|---|
| 1 | **目标是多少家？** 1 家（+ 长尾外包）/ 3–5 家精选 / ~40 家 | **用户定**。这决定了组织方式（§10.4） |
| 2 | **要不要模型目录？** 谁维护、多久更新一次 | 若要 → 得先解决「数据从哪来」（pi 是从 models.dev 之类外部源生成）；不要 → 换模型时上下文窗口得手填 |
| 3 | **抄谁？** pi（自研矩阵）/ opencode（`@ai-sdk`）/ DSH（双层：手写 + 包一层库） | **用户定**。§10.4 已列出各自代价 |
| 4 | **`ProviderConfig` 要不要拆成「端点」+「能力」两层？** | 取决于第 1 题的规模；**规模小就不用拆**（别预挖空壳） |
| 5 | **§9 那条 `reasoning_content` 隐患是否先单独修？** 它**跟接不接多 provider 无关**，但现在看 **pi 专门为它做了 compat 开关**（§10.2 结论 3） | **一次实测**（成本很低） |

> ⚠️ **证据边界**：本节全部来自**本地参考项目源码**（pi / DSH / opencode）。**GLM / Kimi 官方文档侧的事实**（端点是否仍有效、参数是否已变更、有哪些官方限制）**尚未核实**——后台调研中，回来后补。

---

## 11. GLM / Kimi 官方文档核实（2026-09-20 代理抓取官方文档）

> ⚠️ **证据边界**：本节由后台代理抓取厂商官方文档（逐条附 URL），**我本人未逐条复核**。厂商文档更新快，抽查时按页面名回原站。`【文档】`= 代理读到的官方原文；`【pi】`= 本地 pi 源码。
> **一个必须记住的结论**：**「`OpenAICompletionsCompat` 有 27 个字段」这件事本身，就是「OpenAI 兼容不是布尔值」的证据。**

### 11.1 先纠正一个前提：pi 的 compat 真源不在 provider 文件里

`zai.models.ts` / `moonshotai*.models.ts` / `kimi-coding.models.ts` **各只有 8 行**（`import values from "./data/x.json"` + `flattenModelCatalog`），**没有 compat 字段**（`src/providers/zai.models.ts:1-8`）。

真源两处：① `scripts/generate-models.ts` 的 per-provider 块（GLM `1370-1428`、Kimi `2343-2441`）；② 抓取源 `https://models.dev/api.json`（`:1699`）。而落盘目录 `src/providers/data/` **被 `.gitignore` 忽略、本机未生成**。
⇒ **「某字段没出现在 catalog JSON 里」≠「没生效」**——生成器只写与默认表（`616-646`）**不同的 delta**（求 delta `757-767`、合并 `773-780`）。

### 11.2 GLM（智谱 / Z.AI）

**端点（4 条协议 × 2 个区域）**：

| 协议 | 国际 Z.AI | 国内 BigModel |
|---|---|---|
| OpenAI chat-completions（通用） | `https://api.z.ai/api/paas/v4` | `https://open.bigmodel.cn/api/paas/v4` |
| OpenAI chat-completions（**Coding Plan 专用**） | `https://api.z.ai/api/coding/paas/v4` | `https://open.bigmodel.cn/api/coding/paas/v4` |
| Anthropic Messages | `https://api.z.ai/api/anthropic` | `…/api/anthropic` |
| OpenAI Responses | `https://api.z.ai/api/v1` | `…/api/v1` |

- **国内外是不同 host + 不同 key + 不同模型清单**；coding 端点只有它消耗套餐额度，用错报 `1113 Insufficient Balance`
- ⚠️ **静默换模型**：GLM-5.2/5.1 的请求被**静默路由**到 5.3，GLM-4.7 → 5.3-Flash（devpack Overview）——**和 DeepSeek 那套一个味道**，是成本/预期管理上的坑

**与 OpenAI 的差异（挑对我们有影响的）**：

| 项 | GLM |
|---|---|
| `developer` role | ❌ 两份 spec 全文 0 命中 ⇒ `supportsDeveloperRole:false`【pi】 |
| max tokens 字段 | **`max_tokens`**（`max_completion_tokens` 0 命中；默认 65536 / 上限 131072） |
| `tool_choice` | **只支持 `auto`**（原文「默认且仅支持」）⇒ 传 `required` 大概率 400 |
| **并行工具调用** | 官方说**不行**：国内 FAQ 原文「tools 支持传多个函数，但**每次调用只能命中一个**」；且函数调用/知识库/联网**互斥** |
| `stream_options.include_usage` | **两份 spec 0 命中**；`usage` 是「只在最后一个 chunk」自动返回。⚠️【pi】仍无条件发（`OC:828-830`）⇒ **静默忽略还是 400，未知**，需真机验证 |
| 流式 `finish_reason` | 只在最后一块；取值含 **`sensitive` / `model_context_window_exceeded` / `network_error`** |
| 异常流 | 原文：SSE 异常终止**不返回错误码**，只给 `finish_reason` |
| `content` 可为 null | ✅ 明确允许（命中函数时） |
| `temperature` 区间 | **`(0,1]`**（OpenAI 是 0–2）；`top_p` `[0.01,1.0]` |
| `strict`（tool schema） | 【pi】发 `strict`，但 **GLM spec 里搜不到这个字段** ⇒ ⚠️ 存疑 |

**思考**：
- 开关 `thinking:{"type":"enabled"|"disabled"}`，**默认 enabled**；强度 `reasoning_effort`（仅 GLM-5.2+，`max`默认/`xhigh`/`high`/`medium`/`low`/`minimal`/`none`）
- ⭐ **GLM-5.3 / 5.3-FLASH 不再允许关思考**——原文「`thinking.type` 传 `disabled` **将会报错**」；官方迁移建议改 `enabled` + `reasoning_effort:"low"`。**pi 与官方完全咬合**：`glm-5.2` 的 `off = "none"`（用 `reasoning_effort:none`），`glm-5.3` 的 `off = null`（**什么都不发**，`OC:924-926`），断言 `test/openai-completions-tool-choice.test.ts:322-349`
- 思考内容在 **`reasoning_content`**（非 `reasoning`），**先于 `content` 到达**
- 回传：由 `thinking.clear_thinking` 决定，**默认 `true`（清历史），但 Coding Plan 端点默认「保留」**；官方要求「forward the full, unmodified, and correctly ordered historical `reasoning_content`」
- **signature：找不到**（spec + 所有 guide 0 命中）⇒ OpenAI 兼容路径只需回文本
- ⭐ **`tool_stream`**：真参数、**默认 `false`**；**只有 `stream=true` 且 `tool_stream=true` 才让工具参数增量流出**（`format【pi】zaiToolStream:true`，例外集 glm-4.5 系，`OC:848-852` **只在有 tools 时发**）。⚠️ 官方三处支持模型清单**互相矛盾**；且**不开 `tool_stream` 时工具调用长什么样，官方一个字都没写**（找不到）

### 11.3 Kimi（月之暗面 Moonshot）

**端点（4 host × 2 协议）**：

| 用途 | OpenAI 兼容 | Anthropic 兼容 |
|---|---|---|
| 开放平台（国际） | `https://api.moonshot.ai/v1` | `https://api.moonshot.ai/anthropic` |
| 开放平台（国内） | `https://api.moonshot.cn/v1` | `https://api.moonshot.cn/anthropic` |
| **Kimi For Coding**（国际） | `https://api.kimi.ai/coding/v1` | `https://api.kimi.ai/coding/` |
| **Kimi For Coding**（国内） | `https://api.kimi.com/coding/v1` | `https://api.kimi.com/coding/` |

- ⭐⭐ **Kimi Code 官方首先推的是 Anthropic 兼容**（给 Claude Code 用）；**pi 也只用了 Anthropic 那条**（`src/providers/kimi-coding.ts:22` `anthropicMessagesApi()`），**没用官方同样提供的 OpenAI 端点**。套餐 key 与开放平台 key **互不通用**
- ⚠️ 文档域名已改名 `platform.moonshot.cn|ai` → `platform.kimi.com|ai`（301），但 **API host 仍是 `api.moonshot.*`**

**与 OpenAI 的差异（挑对我们有影响的）**：

| 项 | Kimi |
|---|---|
| max tokens 字段 | **`max_tokens` 已标 `deprecated:true`**，官方要求 `max_completion_tokens`（同义）。⚠️【pi】仍发 `max_tokens`（生成器 `2397`）⇒ **pi 落后于官方，别照抄** |
| `developer` role | chat-completions ❌（enum 只有 system/user/assistant/tool） |
| 工具 schema | 走 **MFJS（Moonshot Flavored JSON Schema）**；`strict` **默认 true**；函数名正则 `^[a-zA-Z_][a-zA-Z0-9-_]{0,127}$`、同请求不可重名 |
| tool_call id | 形如 **`"search:0"`**（不是 `call_xxx`）；流式里 `id`/`name` **只在第一片**，`arguments` **必须追加不能覆盖** |
| **并行工具调用** | ✅ **支持且鼓励**（与 GLM 相反） |
| `tool_choice` | `required` **只有 k3 支持**；**开思考时只能 `auto`/`none`**，强制指定 → 400 `incompatible with thinking enabled` |
| `stream_options.include_usage` | ✅ **支持**（额外流一个 `choices: []` 的 chunk 带 usage）。⚠️ 官方警告：**判断传完要看 `data: [DONE]`，不要看 `finish_reason`**；且**不能假设每块都有 `choices[0]`** |
| `temperature` | **不可改**：k3 / k2.7-code 固定 `1.0`，k2.6 思考 1.0 / 非思考 0.6。原文「Do not pass `temperature` explicitly」 |
| `n` | 固定 1（传 >1 → 400） |
| 图片 | **不支持公网 URL**，只能 base64 / `ms://<file_id>` |

**思考（⭐ 逐模型不同，这是重点）**：

| 模型 | 开关 | 能否关 | 回传 |
|---|---|---|---|
| `kimi-k2.6` | `thinking:{type:"enabled"/"disabled"}` + `keep` | ✅ | 由 `thinking.keep` 决定 |
| `kimi-k2.7-code` / `-highspeed` | **永远开、不能关**（传 disabled → 400） | ❌ | **必须**（原文「not optionally」） |
| `kimi-k3` | **根本不接受 `thinking`**，改用顶层 `reasoning_effort`（`low`/`high`/`max`）+ Preserved Thinking 恒开 | ❌ | **必须** |

思考内容也在 **`reasoning_content`**；Kimi Code 的硬 400：`thinking is enabled but reasoning_content is missing in assistant tool call message at index 2`。**signature：chat-completions 路径没有；Anthropic 路径有**（`{"type":"thinking","thinking":…,"signature":…}`，要求原样回传）。

### 11.4 ⭐ pi 的 compat 值 vs 官方文档：**一致 7 处 / 存疑 2 处 / pi 落后 1 处**

| 项 | pi | 官方 | 判断 |
|---|---|---|---|
| GLM 关思考（5.2 vs 5.3） | 5.2 发 `disabled`；5.3 **什么都不发** | 5.3 传 `disabled` 会报错 | ✅ **完全咬合** |
| GLM 保思考 | 固定 `clear_thinking:false` | `false` = Preserved Thinking，须原样回传历史 | ✅ 一致（pi 确实回传） |
| GLM `tool_stream` | 有 tools 就发，已排除 glm-4.5 系 | 默认 false，要增量流必须显式开 | ✅ 一致 |
| GLM `finish_reason` 异常值 | **一律映射成 `error`**（`OC:1552-1576`） | 官方明确列出这些值 | ✅ **这一课最该抄**（见 §9 独立发现 2） |
| Kimi k2.6 / k3 / k2.7-code 三种开关 | `off:null` / `reasoning_effort` / 完全不发 | 官方逐一确认 | ✅ 完全对上 |
| Kimi 后置 system / 带 tools 的 system | k3 两条都开，k2.6/k2.7 只开后置文本 system | 官方：带 tools 的 system **只有 k3 支持** | ✅ 对上 |
| Kimi `supportsStrictMode:false` | 不发 `strict` | Kimi 走 MFJS 方言、`strict` 默认 true | ✅ 方向一致 |
| GLM `stream_options` | 无条件发 `include_usage` | **spec 查无此参数** | ⚠️ **未知**（静默忽略 or 400）→ 需真机验证 |
| GLM `strict` | 发 `strict` | **spec 搜不到** | ⚠️ 存疑 |
| **Kimi max tokens** | 发 `max_tokens` | **已 deprecated，要求 `max_completion_tokens`** | ⚠️ **pi 落后于官方** |

**教学结论**：**pi 是可以抄的，但不是可以盲抄的**——它至少落后官方一次（Kimi 字段弃用），至少两处（`usage` / `strict`）是从未被官方确认的「习惯用法」。
**⇒ 抄它的结构（差异字段化），别抄它的字面值。**

### 11.5 ⭐ 架构结论：**封装单位不该是「厂商」，而该是「路由（端点 + 协议）」**

【文档·代理核实】三条反例：

1. **同一家的不同产品线走不同协议**：Kimi Code = Anthropic 兼容；Moonshot 开放平台 = OpenAI 兼容 ⇒ **按「厂商」选协议是错的，得按「端点」选。**
2. **同一家的新模型可能只在另一条协议上支持某些能力**（opencode 注释：新 OpenAI 模型在 chat completions 上**拒绝 tools + reasoning_effort 组合**，故走原生 Responses）。
3. **很多家同时给两条协议**（GLM、Kimi、MiniMax 都给 Anthropic 版）⇒「用哪条协议」变成**策略选择**（Claude Code 生态 vs 通用 SDK），**不是客观事实**。

**⇒ 对照我们的结构**：`lib/config/index.ts` 的 `PROVIDERS` 把「厂商 = 端点 + 协议」**绑成了一件事**——证据就在我们自己的代码里：同一个 `deepseek` provider 对象**同时塞了两条协议**（`baseUrl` 走 chat-completions、`search.baseUrl` 走 Anthropic，`:55-65` 的注释正是在解释这件事）。
参考形状：pi 的 **`Model.api`**（每个模型自带 `api` + `baseUrl`）、DSH 的 **`providers` 字典 keyed by route**。

### 11.6 同类还有谁（只列事实）

| 厂商 | pi 里的协议 | 要点 |
|---|---|---|
| **MiniMax** | **只有 Anthropic**（`minimax.ts:13`、`minimax-cn.ts:13`） | 无额外 compat；opencode 注释：其 Anthropic 端点**默认关思考**，需手发 `thinking:{type:"adaptive"}`（`transform.ts:1280-1283`） |
| **Qwen / DashScope** | OpenAI 兼容 | `thinkingFormat:"qwen"` → 顶层 **`enable_thinking: boolean`**。opencode 注释：DashScope **必须显式 `enable_thinking:true` 才返回 `reasoning_content`**（`transform.ts:1296-1308`） |
| **小米 MiMo** | OpenAI 兼容 | `{requiresReasoningContentOnAssistantMessages:true, thinkingFormat:"deepseek"}`（生成器 `2447-2450`）——**和 DeepSeek 同款** |
| GLM 第三方托管 | 各自网关 | **同一模型的 compat 随托管方变**（fireworks 的 glm-5.2 支持 off/high/max；openrouter 用 `reasoning:{effort}`） |

**⭐ 一条参照系**：DeepSeek 自己的 compat 是 `{thinkingFormat:"deepseek", requiresReasoningContentOnAssistantMessages:true, …}`（生成器 `2755-2758`）——**我们现在唯一接的这家，恰好是 compat 最「重」的一档**。这既是「DeepSeek 难搞」的证据，也意味着**我们已经在最难的那一档上练过了**。

### 11.7 明确的「找不到」清单（**不许当已知事实用**）

- **GLM**：`developer` 是否被拒（spec 根本没有）；`stream_options`；`parallel_tool_calls` 参数；thinking 的 `signature`；**不给 `tool_stream` 时工具调用长什么样**；coding 端点的 `/chat/completions` 全路径（只给了 base）；`max_completion_tokens`/`n`/`seed`/`logprobs`/`store` 是被忽略还是被拒；三处 `tool_stream` 模型清单为何矛盾
- **Kimi**：`X-Trace-Id`（不存在）；工具数量/并行数上限；chat-completions 的 reasoning signature（不存在）；**普通**（不带 tools）的 system 能否出现在对话中段
- **同类**：硅基流动 / 火山方舟 / 百度千帆 / 腾讯混元 / 讯飞星火 —— **pi 与 opencode 里 0 命中，无一手来源**
- **pi catalog 的 JSON 字面值**：被 gitignore 且本机未生成 ⇒ §11.2–11.4 的 pi 侧结论建立在**生成器源码 + 断言测试 + 运行时解析代码**三重证据上，**不是最终 JSON 字面量**

---

## 12. 下一步（按「急迫度」排序，不是按调研顺序）

0. **⭐ 先修 §9 独立发现 2**（与 C25 / GLM / SDK 全都无关，是现在的漏洞）：`finish_reason:"length"` 等异常值被吞成 `stop`。**这一条成本最低、收益最直接**，而且它同时解锁 C39（那条需求的前提就是它）。
1. **验 §9 独立发现 1**（`reasoning_content` 400 隐患）：开 `DEBUG_DEEPSEEK=true` 发一轮带 tools 的两轮对话就能看出。
2. **A/B 对照实验**（换不换 SDK 的决策依据）：同一请求走「手写 fetch」vs「SDK」，对比 ① 坏 JSON ② abort ③ 错误 message 文本 ④ 真实 DeepSeek 流里 delta 有没有 `role`。
3. **回答 §8 第 4、5 条**（导入路径 / 6.x vs 7.x）：`tsc --noEmit` + `pnpm build`。
4. **多 provider 侧**：先只回答 §10.7 第 1 题（**目标多少家**）——它决定了后面所有结构选择。**规模小就不用拆 `ProviderConfig`**（别预挖空壳）。
5. **只有在 1–4 都有结论后**，才谈把结论写进 `doc/plan/c25-multi-provider.md` 的「详细设计」（`AGENTS.md` 第 10 条门禁：依据 · 详案 · 验收三格齐）。

---

## 附 A：一手来源清单

| 来源 | 位置 | 支撑 |
|---|---|---|
| 我们的手写适配器 | `lib/deepseekModel/index.ts`（637 行） | §1、§4 |
| 我们的适配器单测 | `lib/deepseekModel/index.test.ts`（426 行） | §7 |
| 统一模型协议 / 唯一构造点 | `lib/model.ts:17`、`lib/selectModel.ts:34` | §0、§1.1 |
| pi 的 OpenAI 兼容实现 | `E:\agents-read\pi\packages\ai\src\api\openai-completions.ts` | §2、§5 坑 5/6、§6 |
| pi 的可中断重试 / 错误归一 | 同项目 `src/utils/provider-retry.ts:97-124`、`error-body.ts:1-14` | §3.6、§2 |
| DSH 不用 SDK 的证据 | `deepseek-harness/packages/llm/llm-deepseek/src/protocols/chat-completions/adapter.ts:330`、同目录 `sse.ts:41`、`package.json:43-49` | §2 |
| opencode 用 `@ai-sdk/openai-compatible` | `opencode/packages/opencode/src/provider/provider.ts:123,817,875` | §2 |
| 官方 SDK 真源码（6.40.0） | `E:\agents-read\pi\node_modules\openai\src\` → `core/streaming.ts`、`core/error.ts`、`client.ts`、`internal/utils/sleep.ts`、`internal/shims.ts`、`internal/decoders/line.ts`、`resources/chat/completions/completions.ts`、`lib/ChatCompletionStream.ts` | §3 全部 |
| 官方 SDK README | 同包 `README.md:316,611,645-657,665-669,765-799` | §3.5、§3.7、§3.8 |
| DeepSeek 官方文档 | <https://api-docs.deepseek.com/guides/thinking_mode>（Thinking Mode 页；另见 Tool Calls 页） | §9、§3.2 |
| 项目配置 | `tsconfig.json`、`package.json`、12 处 `export const runtime = "nodejs"` | §3.1、§3.8、§6 |
| 相关需求文件 | `doc/plan/c25-multi-provider.md`、`doc/plan/c40-reasoning-render.md`、`doc/plan/c39-truncated-toolcall-guard.md` | §0、§5 坑 5、§9 |
| pi 的 compat 矩阵与模型目录生成器 | `E:\agents-read\pi\packages\ai\src\types.ts:673-750`、`scripts/generate-models.ts`（3262 行）、`src/api/openai-completions.ts:1583-1714` | §10.2–10.6、§11.4 |
| DSH 的多 provider 组织 | `deepseek-harness/packages/llm/README.zh.md:25-33`、`llm/src/index.ts:203-285`、`llm-deepseek/src/adapter.ts`、`llm-deepseek/src/protocols/chat-completions/sse.ts`、`llm-pi-ai/package.json` | §2、§10.6、§11.5 |
| GLM 官方文档（**代理抓取，我未逐条复核**） | docs.z.ai / docs.bigmodel.cn 的 `api-reference/llm/chat-completion`、`guides/capabilities/{thinking,thinking-mode,streaming,stream-tool,function-calling}`、`guides/overview/concept-param`、两份 `openapi.json` | §11.2、§11.4 |
| Kimi 官方文档（**代理抓取，我未逐条复核**） | platform.kimi.ai/docs 的 `api/{overview,chat,messages,models-overview}`、`guide/{use-thinking-models,kimi-k3-quickstart,use-reasoning-effort,use-tool-choice,utilize-the-streaming-output-feature-of-kimi-api}`、www.kimi.com/code/docs | §11.3–11.5 |

## 附 B：明确「找不到 / 没做」的

- **真实 `api.deepseek.com` 的流式形状**：无 key，**未打真实端点**。§3.3「`.stream()` 崩」证到的是「伪造流 + SDK 源码逻辑」，**不是真实回包**。
- **DeepSeek 流式 delta 里到底带不带 `role`**：官方文档流式示例被截断，**未拿到确证**。这条直接决定坑 4 是否会在真机复现——**列为下一步第 3 条要实测的第一项**。
- **`openai` 7.x 的行为差异**：本地只有 6.40.0，**未下载 7.20.0 源码**核实（只知道 engines 与体积变化）。
- **§9 的 400 隐患**：只有官方文档字面 + 我们代码的静态事实，**没有实测**——这正是它被单列在 §9 而不是写进结论的原因。
- **GLM / Kimi 官方文档的全部细节**：由**后台代理**抓取，**我本人未逐条复核**；抽查时按 §11 的页面名回原站。详细的「找不到」清单见 §11.7。
- **DSH 的 `sse.ts` 实现**：**已读**（40 行，`llm-deepseek/src/protocols/chat-completions/sse.ts`）——结论是它**自己也没手写 SSE**，用的是 `eventsource-parser`（见 §10.6 末）。
- **DSH `llm-deepseek` 的 `serialize.ts` / `translate.ts`（416 + 193 行）**：**未读**。那是「统一消息词汇 ↔ DeepSeek wire 格式」的对应物，与我们 `toOpenAiMessages` 同题，值得单独读。
