# C1 · MCP 接入（外部工具源）

> **这是「攒材料」阶段的需求文件**（`AGENTS.md` 第 10 条 ②）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 C1 行（2026-09-21 定项）+ **2026-09-21 本地参考项目侦察**（五家一手，file:line 在下文）+ 我们自己的接缝实读。
> ⚠️ **「详细设计」与「验收」都还是草稿 v0**（六 / 七，各自标着 ⛔）—— **没定案就不许开工。**

> ⚠️ **2026-11-05 补记（读 §5.5 之前先看这条）**：主参考 **pi 已从 `0.99.0`（2026-09-29）起内置 MCP** —— **§5.5 的结论作废**。证据链、形态摘要、以及对 §5.5 三条理由的逐条复核，全在 **§十一**。决策表相应多了第 12 条（`6.9-11`）。

---

## ⭐ 回来先读这一段（冷启动入口 · 2026-09-22 写）

> **写给"放完假回来、什么都不记得的自己"。** 有这个块的原因：本文件已经 800+ 行 —— 冷读者从「一、需求」逐节读下去，**读完也重建不出"现在该干什么"**。（`会话检查点.md` 已于 2026-09-18 退役，那套机制没了，所以这段话写在这里。）

### 这项现在是三句话

1. **材料齐了** —— 官方规范 2026-07-28 逐节精读 + 五家参考项目一手对照（每条带 `文件:行号`）+ 我们自己的**全链路实读**。见 **二 / 三 / 五**。
2. **设计是草稿** —— **六**（详细设计）和 **七**（验收）都还标着 ⛔ 草稿 v0。
3. **一条决定都没拍** —— 全部卡在 **6.9 的 11 个开关**。**回来第一件事：打开 6.9，从那张表开始。**

### 已经拍过的（**不用重新想**）

| 何时 | 拍了什么 | 落在哪 |
|---|---|---|
| 2026-09-21 | **Cline 划掉**（本机没有它），第一依据改成 **官方规范 + 本地五家** | 2.1 · 6.9-8 |
| 2026-09-21 | **stdio 先行**、HTTP 第二；**不单独做 SSE 配置** | 5.7① · 6.4 |
| 2026-09-21 | **工具注解一律不参与放行**（规范 MUST untrusted）；**缺注解 = 要问** | 5.7① · 6.3 |
| 2026-09-21 | 第一版**只接 `tools`**，不接 `resources` / `prompts` / elicitation | 6.8 |
| **2026-09-22** | ⭐ **不做"自研裸协议的最小版"** —— 用户原话「**要么就不做，要么就是做全**」。AI 早前建议的"**不引依赖、协议自己写**"那条路线**作废** | 本段 |
| **2026-09-22** | ✅ **明确用官方 npm 包的倾向** —— 用户原话「**要不要基于成熟的 npm 包 功能做的完善一些**」（**未拍**，见下） | 本段 |

### ⚠️ 当前悬着的那**一个**问题（2026-09-22 · 回来先答这个）

> **要不要基于官方 npm 包（`@modelcontextprotocol/client`）做？**

**为什么它现在是唯一的关键问题**：它同时决定 ① `6.9-0`（自研 vs SDK）② 节前这几天能不能做出一个**能跑通**的东西。

**已经核到的事实**（2026-09-22 直读 npm registry，HTTP 200）：

| | `@modelcontextprotocol/sdk@1.30.0` | `@modelcontextprotocol/client@2.0.0` |
|---|---|---|
| 文件数 / 解包体积 | **693** / 4.32 MB | **85** / 6.59 MB |
| 直接依赖 | **16 个**（含 express · hono · cors · ajv · express-rate-limit） | **7 个**（zod · jose · cross-spawn · eventsource · pkce-challenge · eventsource-parser · `@modelcontextprotocol/core`） |
| 子路径入口 | `./client` · `./server` · `./validation` · `./experimental` | ⭐ **`./stdio`**（传输可选）· **`./validators/ajv`**（验证器可插拔） |
| 定位 | **client + server 二合一**（所以才拖着 express/hono） | **"Client package"** —— 拆包后**只留客户端** |
| DSH 用哪个 | — | ⭐ **`@modelcontextprotocol/client: 2.0.0`**（钉死，`versionNegotiation: { mode: 'auto' }` —— 见 5.6） |

⭐ **所以"用官方包"有两个选项，而不是一个** —— 那个巨石 `sdk` 会把 express + hono 拖进来（我们**完全用不上**，我们不是 server）。

**⚠️ 必须同时纠正一个可能的误解**：**"用 SDK ⇒ 功能就完善了"是错的。** SDK 省的是**协议管线**；`6.9` 那 11 条里**它只碰第 0 条本身** —— 剩下 10 条（命名 / 撞名 / 安装同意 / 审批重构 / 生命周期 / 读数 / `instructions` / 依据 / 配置 / 默认吵不吵）**SDK 一条都不管**，全是**产品决策**。详见 `6.9` 与 `9.3`。

> ⭐ **2026-10-08 核实**：**"用官方包"里还有第三条路** —— 官方 `Client`（会话层）+ **我们自己的 transport**（自己 spawn、自己分帧）。**已核实成立**，官方明确支持自带 stdio 传输。三条路线的分界 + 接口原文见 **6.9-0a**；若选它，还附带一个子开关（`versionNegotiation.mode`）见 **6.9-0b**。
> ⚠️ 同一次核实**纠正了两处低估**：① **官方包不替我们分帧**（`Transport.send` 收的是**已解析**的消息，不是字节）② `client` 那一层**不是薄壳** —— 它内建两代协议协商 / 响应缓存 / `listChanged` / elicitation / 内存直连对。**所以 6.9-0 的代价模型要按 6.9-0a 重算。**
> 📄 **C47 的材料文件已建**：`doc/plan/c47-bash-env-scrub.md` —— 2026-10-08 从官方包捞到的**白名单**对照（`getDefaultEnvironment()`）已回填进去。**它仍然不属于 C1 的范围。**

> ⚠️ **本段 2026-09-22 当天被 AI 写错过一次**：AI 一度把用户的"**正在权衡**"读成"**已拍板：节前不决定、不开工**"并写进了这里，当天修正。**记住这条**：**"用户正在想" ≠ "用户拍了"** —— 池子/详案里凡标 ⭐ 已拍的，都要能指回用户的原话。

⚠️ **注意第 5 条的含义**：既然"要么不做、要么做全"，那 **6.9 里那些"第一版可以不做"的裁剪项**（第一版不做缓存、前缀可关、不做 elicitation…）**需要重新过一遍** —— 它们当初是按"最小版"写的。**这是回来要做的一件事，别忘了。**

### 2026-09-22 新增/勘误了什么

| 新增 | 在哪 |
|---|---|
| **全链路实读**（POST → 模型 → 工具结果，逐跳 `file:line`） | **3.2** |
| **链上三个插入点**（注册循环 / 注册顺序 / 审批白名单） | **3.3** |
| **五问**（agent 怎么知道 MCP 存在 / 怎么装配 / 要不要专门 tools / 怎么拿详情 / 怎么调用） | **3.4** |
| **复核纪律** —— 本节 `file:line` **会漂**，当天就撞到一次（审批那行原本就写错） | **3.6** |
| **规范勘误 ①**：`tools/list` **必须**带 `ttlMs`（Time-To-Live，"这结果能新鲜多久"的时间上限）+ `cacheScope`，另有 `server/utilities/caching` 整页 | **2.4 · 2.5** |
| **规范勘误 ②**：**Extensions 整块**（`Tasks` / `Skills over MCP` / `MCP Apps`）+ `sampling` 在这版**已不存在** | **2.3** |

### ⚠️ 一条**与 C1 无关也成立**的发现（已单独入池）

**`bash` 的子进程继承父进程全部环境变量** —— `lib/tools/bash/bash-runner/index.ts:105-115` 的 `...base` 原样展开，一个都不删；而 `lib/config/index.ts:119` 的 `DEEPSEEK_API_KEY` 就从 `process.env` 读（2026-09-22 实测 `.env.local` 含该键）。

⇒ **今天的 `bash` 就能把 API key 读出来，跟 MCP 一点关系没有。** 已入池 **`C47`**（`PLAN.md` 需求池）。**这条不属于 C1，别把它拖进 C1 的范围。**

### 回来第一步（照做即可）

0. ⚠️ **先答上面那个悬着的问题**（要不要基于官方 npm 包）—— 它同时决定 `6.9-0` 和"这几天能不能做出一个能跑通的东西"
1. 读 **6.9**（11 条开关；每条的两条路各付什么代价都在那张表里）
2. 拍完 ⇒ **六 / 七 定稿** ⇒ 才改 `PLAN.md` 那格状态、才建 `doc/iteration/i<n>.md`
3. **在这之前不许写产品代码**（`AGENTS.md` 第 10 条 ③ 的门禁）


## 一、需求（池子行原文）

MCP 接入

（池子行的「依据」原文：`Cline / smolagents mcp_client`；「做什么」原文只有这五个字 —— 这正是它需要攒材料的原因：**一句话放得下，但放不下设计**。）

## 二、依据（跟谁学 / 触发条件）

### 2.1 ⚠️ 原依据第一条要修正：**Cline 不在本地**

`E:\agents-read\` 下的参考项目是：pi · codex · deepseek-harness · Reasonix · smolagents · CodeWhale · langchainjs · opencode · 综述。**没有 Cline**；`doc/开源项目导航手册/index.md` 的项目清单里也没有它。Cline 目前只出现在三处**引用**里（`PLAN.md` 的 T 层依据与 `B4` 行 · `doc/plan/far-map.md:20`）——**"写着跟它学"但本机没得读**。

⇒ 要用 Cline，得按 §11.6「新增参考项目流程」先克隆 + 解析架构 + 写导航卡（**待拍板第 1 条**）。

### 2.2 本地已有的一手参考（比原依据更近，且都在盘上）

| 参考 | MCP 在哪 | 导航手册怎么标 |
|---|---|---|
| **smolagents** | `src/smolagents/mcp_client.py` | `smolagents.md:15`：「MCP 客户端 · **未精读**」 |
| **langchainjs** | `libs/langchain-mcp-adapters/`（**适配层范本**） | `langchainjs.md:8,34`：「MCP 工具适配 · 未读」 |
| **opencode** | `packages/core/src/tool/websearch.ts`（**走 MCP 调 Exa / Parallel** 的 consumer） | `opencode.md:56,73`：「本地工具走 MCP」· 已读 core 那份 |
| **DSH** | `packages/mcp/` + `packages/core/tools/` | `deepseek-harness.md:26,44`：「工具注册 + MCP · **未精读**」 |
| **codex** | `codex-rs/tools/`（`mcp_tool`）+ **`codex-mcp` 89 文件** + **`rmcp-client` 84 文件**（MCP **client** 侧） | `codex.md:17,23,38,52` |
| **CodeWhale** | `crates/mcp/` | `codewhale.md:17`：「未精读」 |

### 2.3 ⭐ 一手规范：MCP 官方 spec **2026-07-28**（**位置就在我们自己仓库里**）

`doc/研究/agent评价标准-调研.md` 已经把规范和它的**安全约束**定位好了（不用重新找）：

- **:1584-1589**：spec 入口 + `server/tools` + versioning + **Security Best Practices** 四个链接（⚠️ 它明确记着「**2025-06-18 已过时**」）
- **:1140-1147**：章节结构（Transports / Authorization / **Discovery** / Prompts / Resources / **Tools**）
- **:1188-1210**：**与我们权限审批模块直接相关的约束** —— `server/tools` 页三条：**iteration limits for tool loops** / human in the loop / **工具注解不可信**；:1210 还记着「我们的轮次上限不是自己发明的，是规范建议的」
- **:1162-1165**：安全条目 —— Token Passthrough / **State Handle Hijacking**（"MCP servers **MUST NOT** treat possession of a state handle as authentication"）/ SSRF / Confused Deputy / Local MCP Server Compromise
- **:1116, 1379**（OWASP #10）：**pin / sign / verify 每个 MCP server 与工具包；审计工具描述里的隐藏指令**

> ⭐ **这一条改变了"跟谁学"的排序**：**规范 > 参考项目**。参考项目回答"怎么接"，规范回答"**必须/禁止什么**"（尤其安全侧）。而这份规范我们已经有了 —— 缺的只是**逐节精读**。

> **⚠️ 2026-09-22 勘误 —— 上面那个"章节结构"不完整**（直读规范 index 页，HTTP 200）。正确的分层是：
>
> | 层 | 有什么 |
> |---|---|
> | **Servers 提供的三种原语** | **Prompts**（**用户**控制：斜杠命令、菜单项）· **Resources**（**应用**控制：文件内容、git 历史）· **Tools**（**模型**控制：API 调用、写文件）—— ⭐ **分界线是「谁发起」** |
> | **Clients 提供给 server 的** | **只有 `Elicitation`**（server 反过来向用户要输入）—— ⚠️ 旧版的 `sampling`（server 反过来请求 client 的模型做一次补全）**在这一版已不存在** |
> | **基础协议** | JSON-RPC · **无状态的自包含请求** · **逐请求能力协商** |
> | **附加工具** | Configuration · Progress tracking · Cancellation · Error reporting |
> | ⭐ **Extensions（可选；须双方显式支持）** | **`Tasks`**（长时操作的异步执行：轮询 / **中途输入** / 持久 handle）· ⭐ **`Skills over MCP`**（把"技能"标准化进 MCP）· **`MCP Apps`**（对话内联渲染的交互 UI） |
>
> ⚠️ **两处影响**：① `Tasks` 里的"**中途输入**"和 **6.9 第 11 条（elicitation）是同一类问题** ② ⭐ **`Skills over MCP` 可能和 `C37`（技能清单规模）撞同一块地** —— 这是"行业在往哪走"的信号，值得记着。

### 2.4 规范精读 ①：`server/tools`（2026-09-21 实读，`https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md` → **HTTP 200**）

**列了才知道哪些不必猜** —— 下面是**对客户端有约束力**的条目（原文关键短语保留英文），以及它落成我们的什么问题：

| 规范要求 | 强度 | 对我们的含义 |
|---|---|---|
| "there **SHOULD** always be a **human in the loop** with the ability to deny tool invocations … Present **confirmation prompts** to the user for operations" | SHOULD | ⚠️ **规范站在"弹框"这一边** —— 而我们现在 MCP 工具会走审批兜底**自动放行**（见「三」）。这条把待拍板第 4 条的默认值推向"要人批" |
| "clients **MUST** consider tool **annotations to be untrusted** unless they come from trusted servers" | **MUST** | **待拍板 4-③ 被规范关掉**：不能拿 `readOnlyHint` 之类注解做"只读放行" |
| "clients … **SHOULD** implement a **disambiguation strategy such as prefixing tool names with a server identifier**. The server `name` (from `serverInfo`) is **not guaranteed to be unique** and **SHOULD NOT** be relied upon" | SHOULD | 前缀用**我们自己配置里的别名**，不能用 server 自报的名字（自报的名字可能重名/可伪造） |
| "Servers **SHOULD** return tools in a **deterministic order** … improves **LLM prompt cache hit rates** when tools are included in model context" | SHOULD | 与我们的既有教训同源（`50ed41e`「时间注入只给日期」）⇒ **工具清单顺序必须稳定**，否则每请求前缀缓存全失效 |
| "`tools/list` … set **MUST NOT** vary per-connection … **MAY** change over time"（配 `listChanged` 通知） | MUST/MAY | 工具清单**是会变的**；我们"注册表每请求组装"（`lib/tools/index.ts:114`）天然能容纳"每次重列"，但要定**要不要订阅变化** |
| Streamable HTTP："Clients **MUST** reject tool definitions where any `x-mcp-header` value violates these constraints … **MUST** exclude the invalid tool from the result of `tools/list`"（并 SHOULD 记日志） | **MUST** | 一条具体义务：**坏工具要单独剔除，不能让整批 discovery 失败** |
| "Tools use two error reporting mechanisms: **Protocol Errors**（JSON-RPC error）… **Tool Execution Errors**（`isError: true`）… Clients **MAY** provide protocol errors to models … **SHOULD** provide **tool execution errors** to language models to **enable self-correction**" | MAY/SHOULD | ⭐ **与 C36 的判据同形**：执行错误**要给模型**（让它自纠）、协议错误给不给都行 —— 我们已有的「加标记不抛错」设计正接这条 |
| "clients **SHOULD**: … **Show tool inputs to the user before calling the server**, to avoid … data exfiltration … **Validate tool results** before passing to LLM … Implement **timeouts** for tool calls … **Log tool usage for audit purposes**" | SHOULD | 四条我们**都已经有承接的位置**：审批面（show inputs）· `isError`/判据（validate）· `config` 超时 · `.traces/`（audit） |
| 结果内容类型：`text` / `image` / `audio` / `resource_link` / 内嵌 `resource`；另有 `structuredContent` + `outputSchema`（clients **SHOULD** validate） | — | 我们的 `ToolResult.content` 目前基本是 text 一条 ⇒ 图像/资源怎么落（与 `C12 read_image` 同源问题） |
| "MCP has no protocol-level session … a handle is a **name, not a capability**"（Stateful Tools，非规范 guidance） | — | 多轮状态靠**模型自己携带 handle 字符串** ⇒ 审计要能看出 handle 流转；与"会话"无关，别混 |
| `InputRequiredResult`：server **可**在 `tools/call` 中途要求补充输入（elicitation / multi round-trip） | MAY | **新问题**：它和我们 `ask_user_question`（A4）的提问通道要不要打通？（见待拍板第 11 条） |
| 名字规则：1–128 字符 · 大小写敏感 · 仅 `A-Za-z0-9_-.` · server 内唯一 | SHOULD | 做了前缀之后要**校验**长度与字符集（我们自己的工具名都合规） |

> ⚠️ **读法提醒**：这一节是 **2026-09-21 一次 fetch 的读数**（HTTP 200，非猜测）；`MUST` = 规范强制，`SHOULD` = 除非有理由否则该做。**做详案时若要引用具体措辞，回来复核这一段对应的锚点**（网页没有行号，按小标题定位：*User Interaction Model* / *Tool Names* / *Error Handling* / *Security Considerations*）。

> **⚠️ 2026-09-22 补漏 —— 上面这张表漏了一条，而它直接决定基座形状：`tools/list` 的响应带缓存提示。**

| 规范要求（原文要点） | 强度 | 对我们的含义 |
|---|---|---|
| **六个操作**的 `resultType: "complete"` 结果 **MUST** 带缓存提示：`server/discover` / `tools/list` / `prompts/list` / `resources/list` / `resources/templates/list` / `resources/read` | **MUST** | 这是**必填字段**，不是可选优化 |
| **`ttlMs`**（Time-To-Live，**"这个结果能新鲜多久"**的时间上限，单位毫秒，类比 HTTP `Cache-Control: max-age`）：正数 ⇒ 客户端 **SHOULD** 在这么久内认为它新鲜、**不必重问**；`0` ⇒ 立刻过期、可以每次问；**缺失 ⇒ 按 `0` 处理**；负数 ⇒ 忽略 | server **MUST** 给 `>= 0`；客户端 SHOULD | ⭐ **"每次都去问"不是协议强制的** —— 它是"**server 没给 TTL 时**"的默认 |
| **`cacheScope`**（缓存作用域）：`"public"`（不含用户私有数据，任何客户端 / 网关都可共享）· `"private"`（**不得跨授权上下文共享**） | — | 分页时**每一页各自带 `ttlMs`**；同一列表所有页的 `cacheScope` **MUST 一致** |
| 缓存与 `listChanged` 通知**互补**：缓存还新鲜时收到 `notifications/tools/list_changed` ⇒ **立即失效**、该重问 | — | 两种机制可以并存 |
| 专门规范页 **`server/utilities/caching`** | — | ⚠️ **2.5 的精读清单里漏了这一页** |

⭐ **为什么这条要紧**：它决定基座里 **`manager` 那一块要不要存缓存**（存 ⇒ 按 server 记 `{tools, fetchedAt, ttlMs}`；不存 ⇒ 每请求都真发一次 `tools/list`），而且**与开关 `6.9-5`（连接生命周期）天然咬合**。

⚠️ **6.9-12 的收口不改**（第一版**不订阅** `listChanged`、**每请求重列**），但**要补一句代价**：**我们放弃了 server 主动给的 TTL 优化** —— server 说"5 分钟内不用再问"，我们仍然每次都问。这是**有代价的选择**（多一次跨进程往返、多一份 server 负载），**不是唯一做法**。等真机数据再决定接不接。

### 2.5 规范精读 ②：传输 / 版本 / 安全（同日精读，**7 个页面全 HTTP 200**）

> ⚠️ **最先要知道：2026-07-28 是"无会话"的一版** —— **没有协议级 session、没有 `initialize` 握手**（那是 **Legacy** 形态）；`Mcp-Session-Id` 属旧修订（只支持本版的 server **SHOULD ignore it**）；SSE **不可续传**（`Last-Event-ID` 不支持）。**这直接决定我们客户端的形态：无状态 + 每请求独立响应流。**

**（a）stdio 传输**（`basic/transports/stdio`）

| 规范 | 强度 | 对我们的含义 |
|---|---|---|
| client **launches the MCP server as a subprocess**；消息以 newline 分隔且 **MUST NOT** 含内嵌换行 | MUST | 与本机执行同形 ⇒ **"装一个 server" = 装一个可执行文件**（见 (d)） |
| server **MUST NOT** 往 `stdout` 写任何非 MCP 消息；client **MUST NOT** 往 stdin 写非法内容、**MUST NOT** 写 JSON-RPC responses | MUST | stdout 是**协议通道**，一丝污染都不行 |
| server **MAY** 往 `stderr` 写任意 UTF-8 **for any logging purposes**；client **MAY** capture/forward/ignore；client **SHOULD NOT assume `stderr` output indicates error conditions** | MAY/SHOULD | ⭐ **同一条通道，含义与 C36 相反**：pwsh 场景里 stderr 是**报错的家**（CLIXML 只在那儿出生）；MCP stdio 里 stderr 是**自由日志**、且**不该当错误信号** ⇒ **判据不能跨场景照搬** —— 这正是"知道它什么时候会失败"的一条 |
| 关闭：client **SHOULD** ① 关子进程 stdin ② 等它退出 ③ 超时则强杀（POSIX SIGTERM→SIGKILL；**Windows 用 `TerminateProcess`/Job Objects**） | SHOULD | 与本仓库既有教训对上（`taskkill /t /f`）：Windows 上"等它自己退"必须配强杀兜底 |
| 进程意外退出：client **SHOULD** restart it；协议 stateless ⇒ in-flight 请求直接丢、**可 retry**；订阅流要重建 | SHOULD | "重启 + 重试"有规范依据；同时说明**不要做断线续传重放** |
| `subscriptions/listen` 的通知靠 `_meta.subscriptionId` 关联（stdout 是单一共享通道、无 per-request 流） | MUST | 不能假设"一条请求一条流" |

**（b）Streamable HTTP**（`basic/transports/streamable-http`）

| 规范 | 强度 | 含义 |
|---|---|---|
| 单一 endpoint、支持 POST；每条 JSON-RPC 消息 = **一次新的 POST**；`Accept` **MUST** 同时列 `application/json` 与 `text/event-stream`；**MUST** 支持两种响应形态 | MUST | 一个 POST 客户端 + 两套解析即可 |
| 每个 POST **MUST** 带 `MCP-Protocol-Version` 头且 **MUST** 与 body 的 `_meta.protocolVersion` 一致（否则 400 + `HeaderMismatch`）；`Mcp-Method`（所有请求）与 `Mcp-Name`（`tools/call`/`resources/read`/`prompts/get`）**REQUIRED for compliance** | MUST | ⭐ **头/体一致性要做成请求构造器里的单一真相源**（两处各写一遍必然漂） |
| 取消 = **关闭该请求的响应流**（`notifications/cancelled` 本版只用于 stdio） | MUST | 与我们的 `AbortSignal` 取消能对上 |
| SSE keep-alive 注释行（`:` 开头）**clients must ignore**、不得当 malformed | MUST | 解析器必须容错 |
| `x-mcp-header`：标注参数的值 **MUST** mirror 进 `Mcp-Param-{name}` 头；不可安全表示为 ASCII 时 **MUST** 用 `=?base64?…?=`；违反约束的工具定义 **MUST** 从 `tools/list` 结果中排除（并 SHOULD 记日志） | MUST | 上次只读到半条，这里是完整口径 |
| 版本头不符时 server 回 400 `HeaderMismatch`；client **SHOULD** 重新 `tools/list` 检查 schema 变化再重试 | SHOULD | 一条"schema 变了"的自愈路径 |

**（c）版本与新旧形态**（`learn/versioning` + `basic/versioning`）

| 规范 | 强度 | 含义 |
|---|---|---|
| **没有协商握手**：每个请求在 `_meta` 里声明版本，server 逐请求 accept-or-reject | MUST | 正常路径**不需要写 `initialize`**（除非要兼容 Legacy） |
| 版本不支持 ⇒ `UnsupportedProtocolVersionError`（**-32022**）+ `supported` 列表；client **SHOULD** 从里面挑一个**重试**，无可兼容则报给用户 | MUST/SHOULD | **客户端让步并重试**，不是等服务端降级 |
| server **MUST** 实现 `server/discover`；client **MAY** 先调它（拿 supportedVersions / capabilities / identity），也可以直接发请求挨错误 | MUST/MAY | `server/discover` 是我们**探能力的正门** |
| Era 判定（Modern vs Legacy）**SHOULD** 按"server 进程 / origin"缓存、**MAY** 持久化；stdio 探测**不能按某个具体错误码**判 legacy（合法回错 implementation-defined，甚至不回） | SHOULD | 别每请求重探，也别把 legacy 判定写死在某个错误码上 |
| 版本号 `YYYY-MM-DD` = **最后一次不兼容变更的日期**；向后兼容的改动**不涨版本** | — | "版本号没变"≠"没变化" |

**（d）安全 —— 客户端侧的硬约束**（`tutorials/security/security_best_practices`）

| 规范 | 强度 | 含义 |
|---|---|---|
| **Local MCP Server Compromise**：若客户端支持 one-click 配置，**MUST** implement proper **consent** prior to executing commands；对话框 **MUST** ①**不截断地**显示确切命令 ②标注 potentially dangerous ③要求显式批准 ④允许 cancel | **MUST** | ⭐ **这条直接答了待拍板第 10 条**："装一个 server 谁批准" —— 规范把**四个形状**都给了，照做即可。**注意它说的是"安装"那一层，不是工具调用那一层** |
| **Token Passthrough**：client **MUST NOT** 送不是该 server 的 AS 签发的 token | **MUST** | 硬约束（OAuth 场景才用得上；本版 **stdio SHOULD NOT 走 OAuth**，改为从环境取凭据） |
| **OAuth Authorization URL Validation**：只准 `http/https`（生产 **MUST** https，`http` 仅 loopback 开发）；**MUST NOT use shell commands（`cmd.exe`/`sh`/PowerShell）to open URLs**；**MUST** sanitize/validate 所有来自 server 的 URL | **MUST** | "用 shell 打开 URL"恰好是我们 `bash` 能做且有先例的动作 ⇒ 这条要落成**不可绕过的断言**，不能只写进文档 |
| **SSRF**：clients **MUST** consider SSRF risks and implement mitigations when fetching OAuth-related URLs；只放行 loopback 的 `http://`、block private/reserved ranges、**别手写 IP 校验**（注意 octal/hex/IPv4-mapped IPv6 编码伎俩） | **MUST/SHOULD** | 我们**已经有**地址闸门（A5 的 SSRF 防线）⇒ **复用**，别另写一套 |
| **State Handle Hijacking / Confused Deputy**：缓解主体在 server / AS 侧；客户端侧相关事实是 handle 只是普通参数、协议无状态 | — | 记一笔：**别把 handle 当我们的认证机制** |
| **stdio Transport Security in Proxy Scenarios**：sandbox spawned process、限制 fs、记录所有 stdio 用法、危险命令要求额外授权 | SHOULD | 与 `C2 沙箱` 是同一件事的两个入口 |

**⭐ 这一节最大的收获**：规范把"**装一个 MCP server**"明确当成一次**需要人显式批准的代码执行**，并给了必须满足的四个形状；而这在我们现在**根本没有关口**（配置只走 `config` 段）。⇒ **"审批"这件事在 MCP 上是两层**：**装**（一次，重）与**调用**（多次，轻）—— 两层都需要设计，而 `approval/index.ts` 现在只管得了第二层，且默认放行。

### 2.6 触发条件（为什么是现在做）

- `PLAN.md` 的七层对照表把 **T 层（工具接口与协议）唯一的洞**标成"无 MCP 外部工具源"
- `ARCHITECTURE.md:98,204` 两处都写着"14 把工具 → **MCP 外部工具源（C1）**"、"**MCP 未做（C1）**"
- 用户 2026-09-21 拍板：下一个大功能 = **C1**

## 三、我们这边的接缝地图（2026-09-21 实读，file:line）

> **2026-09-22 补**：本节原先只有下面这张**清单** —— 它回答"**有哪些接缝**"，但回答不了"**这些接缝在一次请求里怎么串起来、模型到底怎么用上远端工具**"。
> 现在补上 **3.2 全链路**（带 file:line 的逐跳展开）+ **3.3 插入点** + **3.4 五问** + **3.5 三个发现** + **3.6 复核纪律**。清单**原样保留**（3.1）。

### 3.1 接缝清单

| 接缝 | 现状 | 对 MCP 的含义 |
|---|---|---|
| 工具契约 | `lib/tools/types.ts:43` `RegisteredTool = ToolDefinition & { execute; guidelines? }` —— 名字/描述/参数 JSON Schema/执行函数/**规矩** | 远端工具要**映射**成这个形状；`parameters` 是 JSON Schema（MCP 的 `inputSchema` 也是）⇒ **形状天然对得上** |
| 注册表 | `lib/tools/index.ts:29` `ToolRegistry`（`register` / `definitions` / `guidelines` / `execute`）；`:114` `createToolRegistry(context, hooks)` **每请求组装** | 加工具 = 往表里 `register` —— 但**表是同步装配的**，而 MCP 工具要**异步连接 + 握手**才发现 ⇒ 装配点要变成 async（或先连好再组装） |
| 装配点 | `app/api/chat/_pipeline/tools.ts:28` 每请求调一次 `createToolRegistry` | MCP 连接若常驻，就撞上「注册表每请求重建」那条**条件触发**（`PLAN.md` §7.3.5，⚠️ 动红线 `lib/agent/index.ts`） |
| **⚠️ 审批** | `app/api/chat/_pipeline/approval/index.ts:29-35` **硬编码工具名白名单** `TOOLS_NEEDING_CONFIRM`；`:63-65` 取 `needsConfirm`、`:79` 用它判；**`:150` 兜底 `{ action: "allow" }`** | **MCP 工具的名字是运行时才知道的 ⇒ 不在白名单里 ⇒ 走兜底 ⇒ 自动放行。** 而外部工具能做任何事（本地进程 / 网络请求）⇒ **这条必须先定**。相关池子项：`B5`（含 E5「审批策略硬编码 → **per-tool 重构**」，⚠️ 动红线）<br>⚠️ **本行行号 2026-09-22 重核过**：原写 `:75` / `:125`，**两处都对不上代码**（核了 `dea7d1b` / `c95f252` 两份历史，`needsConfirm` 一直在 `:63`、兜底一直在 `:108`）；C45 拆分 `decideToolCall` 后又把兜底从 `:108` 推到 `:150`。见 **3.6** |
| 分级审批 | `approval/index.ts:41` `getApprovalMode()` → `suggest` / `bypass` / `never`；记忆放行在 `lib/permission/approval-memory` | 新工具要接进这三档语义（尤其 `never` 档：现在只拒绝"需确认名单"里的） |
| 配置 | `lib/config/index.ts:110` 分段：`provider` / `modelSecrets` / `paths` / `agent` / `approval` / `bash` / `web` | MCP server 清单住哪一段（或独立配置文件）是**待拍板**；判据可沿用 `:181-183` 那条「换个厂商会不会变」 |
| 围栏先例 | `config/index.ts:126-135` `skillsRoot` **在工作区之外** ⇒ 只有专用 `skill` 工具能读它 | MCP server（本机任意路径的进程）与它同形：**围栏之外的东西要自己的工具/自己的批准** |
| 提示词 | `lib/tools/index.ts:55` `guidelines()` 收集各工具规矩，由管道渲染（C34 归属规则） | MCP 工具的规矩**数量不可预知**（跟 server 走）⇒ 与 `C37`（技能清单规模）同源问题 |
| 输出上限 | `config.bash/web.maxOutputChars` 各自一节 | MCP 结果超限怎么办 ⇒ 与 **`C44`**（超限留一份 + 给定位）同源 |
| 工具数 | 14 把（`ARCHITECTURE.md:98`） | MCP 会把它推上去 ⇒ 逼近 `tool_search 工具发现` 的**条件触发线（>20）** |

### 3.2 ⭐ 全链路：一次请求从 POST 到工具结果

> **2026-09-22 实读**（每一跳自己打开核过，不是转述）。`★` = MCP 要插的位置。

```
[浏览器] POST /api/chat { text, sessionId }
   │
   ▼ app/api/chat/route.ts:75
   │    :114  createRequestContext → { store, recorder }
   │    :177  beforeToolCall = (call) => handleToolApproval(call, send, sessionId)
   │
   ▼ runPipeline(...)              app/api/chat/_pipeline/index.ts:59
   │    1b :79   loadSkills(skillsRoot)
   │    1c :92   store.appendMessage(userMessage)
   │    1d :99   技能手势（扫 /技能名 → 注入一条 user 消息）
   │    1e :121  context = store.buildContext()
   │
   │    ★ 1e :125  createPipelineTools({ toolContext, store, recorder, send })
   │                └─ _pipeline/tools.ts:28
   │                     └─ lib/tools/index.ts:114  createToolRegistry(...)
   │                          └─ 14 个工厂函数 → registry.register() → Map
   │
   │    1f :139  systemPrompt = buildSystemPrompt(now, 技能清单, registry.guidelines())
   │
   ▼  2 :146 runAgentLoop({ ... })
   │         tools:        registry.definitions()   ← 只有 3 个字段（见 3.4-Q4）
   │         toolRegistry: registry                 ← 完整对象（带 execute）
   │         beforeToolCall
   │
   ▼ lib/agent/index.ts:174  runAgentLoop   ⚠️ 红线文件
   │
   │    for turn = 1 … maxTurns
   │       :216  options.model.complete({ systemPrompt, messages, tools, onDelta })
   │               └─ lib/deepseekModel/index.ts:476  toOpenAiTools()
   │                    → [{ type:"function", function:{ name, description, parameters } }]
   │                    → 发给 provider API
   │
   │       模型回 assistant（可能带 toolCall 块）
   │       :249  toolCalls = assistant.content.filter(b => b.type === "toolCall")
   │
   │       for each toolCall:
   │          ★ :265  decideToolCall(toolCall, options.beforeToolCall)
   │                  └─ route.ts:256  handleToolApproval
   │                       └─ _pipeline/approval/index.ts:54  decideToolCall
   │          :283  block → 伪造一条 isError 结果（不执行）
   │          :315  executeToolCall(...)
   │                  └─ :105  toolRegistry.execute(name, args, { signal, onChunk })
   │                          └─ lib/tools/index.ts:71  Map.get(name) → tool.execute(...)
   │          :326  toolResult push 进 context  ← 下一轮模型就看得见（ReAct 短期记忆）
   │
   ▼ 2b :176 落盘  2c :181 压缩  3 :189 done 帧
```

### 3.3 链上 MCP 的三个插入点

> **结论先说**：整条链上 MCP 只有**三个**地方必须动，**其余全是零改动** —— 这不是克制，是 `ToolDefinition` 只有三个字段、**没有"来源"这个维度**（见 3.5-①）。

| # | 插入点 | 位置 | 为什么躲不掉 | 相关开关 |
|---|---|---|---|---|
| ★1 | **注册循环** | `lib/tools/index.ts:114` `createToolRegistry`（由 `_pipeline/tools.ts:28` 调） | 远端工具要变成 `RegisteredTool` 才能进表 —— 这里是**唯一**的入口 | **6.9-5**（决定这一跳要不要变 `async`） |
| ★2 | **Map 的注册顺序** | `lib/tools/index.ts:32-34` `this.tools.set(tool.name, tool)` | `Map.set` = **后注册的赢**：外部 server 报个叫 `bash` 的工具就能**顶掉我们的 `bash`** | **6.9-2** |
| ★3 | **审批白名单** | `approval/index.ts:29-35` + `:150` 兜底 `allow` | MCP 工具名运行时才知道 ⇒ 落不进白名单 ⇒ **自动放行** | **6.9-4** · 6.9-10 |

⚠️ **★1 那条的 async 分支要点**：

- **连接常驻**（6.9-5 暂定）⇒ `createToolRegistry` **保持同步**，工具对象只是薄壳，真连接由 `lib/mcp/manager` 在模块级持有 ⇒ **装配链三跳签名一个字都不用改**
- **每请求连/断** ⇒ `createToolRegistry` 得变 `async` ⇒ `_pipeline/tools.ts:28` 与 `_pipeline/index.ts:125` **两跳跟着改签名**

### 3.4 五问：模型到底怎么用上远端工具

#### Q1 · agent 如何知道 MCP 存在？

**它不知道，而且没有知道的途径。**

引擎入参是一个封闭对象 `RunAgentLoopOptions`（`lib/agent/index.ts:33-51`）：

```
systemPrompt · messages · tools · model · toolRegistry
maxTurns · beforeToolCall · onEvent · signal · onToolOutput
```

**里面没有任何"来源"维度。** `tools: ToolDefinition[]` 是一个扁平数组，引擎从不问"你是我们写的还是别人给的"。

⇒ 「内核零改动」**是接口形状决定的**，不是我们克制：只要 MCP 产出 `RegisteredTool`，引擎连知道的机会都没有。

#### Q2 · 在管道上如何装配？

三跳，逐跳见 3.2 的 `★ 1e`：

| 跳 | 位置 | 干什么 |
|---|---|---|
| 1 | `_pipeline/index.ts:125` | `createPipelineTools({ toolContext, store, recorder, send })` |
| 2 | `_pipeline/tools.ts:28` | `createToolRegistry(toolContext, { onTodoWrite, onAskUser })` |
| 3 | `lib/tools/index.ts:114` | `new ToolRegistry()` + 14 次 `register()` |

**MCP 插在第 3 跳那个注册循环** —— 它是"第 15 到第 N 个工具来源"。⚠️ 同步/异步的分岔见 3.3。

#### Q3 · 装配好了之后，是否需要提供专门的 tools？

**MCP 自己的工具不需要。** 它们和 `bash` / `read` **平级进同一张 Map**（`lib/tools/index.ts:30`），模型看到的是一张**混在一起的清单**。三个连带效果：

1. **前缀是唯一的隔离手段** —— `mcp__fs__read_file` 和 `read_file` 挤在同一张表里，只靠名字区分
2. ⚠️ **撞名是静默覆盖**（`lib/tools/index.ts:32-34`）—— 见 3.3 的 ★2
3. **规矩也能投稿**：`guidelines()`（`lib/tools/index.ts:55`）收的是 `RegisteredTool.guidelines`，MCP 工具**可以**投稿，但数量跟 server 走、不可预知（与 `C37` 同源）

> **但确实有一类"MCP 配套工具"要另造**：`resources` / `prompts` **不会自动变成工具** —— 它们是协议的另一块面。要让模型用得上，得**特意造工具**（DSH 就造了三个共享资源工具）。我们第一版不做（6.8）⇒ **确实不需要专门工具**。

#### Q4 · agent 怎么拿到 MCP 里面的详情？

**它拿到的是被削过的详情 —— 而且只能拿到这些。** 四步，每步都在丢东西：

| 步 | 在哪 | 手上有什么 |
|---|---|---|
| 1 | server 的 `tools/list` | `name` `description` `inputSchema` **`annotations`** `title` `execution` `outputSchema` |
| 2 | MCP 适配层（要新写） | 翻成 `RegisteredTool`：名字加前缀 / `description` 原样 / `parameters = inputSchema` / `execute` = 转发 |
| 3 | ⭐ **`registry.definitions()`（`lib/tools/index.ts:36-44`）** | **削成三个字段**：`({name, description, parameters}) => ({name, description, parameters})` |
| 4 | `lib/agent/index.ts:219` → `toOpenAiTools`（`deepseekModel/index.ts:476-485`） | `{type:"function", function:{name, description, parameters}}` → 发到 API |

第 3 步的落点类型就是 `ToolDefinition`（`lib/types.ts:87-91`）—— **只有三个字段，物理上没有第四个位置**。

⭐ **于是"annotations 不能信"是双重成立的**：① 规范 **MUST** untrusted（2.4）② **它根本到不了模型眼前** —— 在第 3 步就被丢掉了。

⇒ 模型眼里的"一把工具" = **名字 + 一段自然语言说明 + 一个 JSON Schema**。没有别的。

#### Q5 · 怎么调用的？

```
① 模型选工具
   assistant 里多一块：{ type:"toolCall", id:"call_abc",
                        name:"mcp__fs__read_file", arguments:{ path:"a.txt" } }

② 引擎提取            lib/agent/index.ts:249   filter(type === "toolCall")

③ 审批                :265  decideToolCall(...) → route.ts:256 → approval/index.ts:54
   ⚠️ MCP 工具在这里落进 applyDefaultArguments(:81) → { action:"allow" }(:150)
      因为它不在 TOOLS_NEEDING_CONFIRM(:29-35) —— 自动放行，没人把关

④ 执行                :315  executeToolCall → :105  toolRegistry.execute(name, args, ...)
                      → lib/tools/index.ts:71  Map.get(name) → 拿到那个「薄壳」
                      → tool.execute(args, options)

⑤ 薄壳内部  ★ MCP 新增的全部执行代码就在这
      · 公开名 mcp__fs__read_file → 查**另存**的映射表 → (alias:"fs", rawName:"read_file")
        ⚠️ 绝不从公开名反解（DSH 原话：raw name 只在线上出现，public name 从不被解析回原名）
      · 拼一条：{"jsonrpc":"2.0","id":N,"method":"tools/call",
                 "params":{"name":"read_file","arguments":{...}}}
      · 写进子进程 stdin

⑥ server 干活 → stdout 吐一行：
      {"jsonrpc":"2.0","id":N,"result":{"content":[{"type":"text","text":"..."}]}}

⑦ 拆行 + 按 id 配对（乱序也不怕）→ 取出 content

⑧ 翻回 ToolResult      lib/types.ts:93  { content, details? }

⑨ 引擎包成 ToolResultMessage   lib/agent/index.ts:110-118
   :326 push 进 context

⑩ 下一轮模型就看得见它  :216 再调 model.complete，context 里已带着这条结果
```

⭐ **第 ⑩ 步就是 ReAct 的短期记忆机制**，也正是 MCP 结果"**必须穿过模型 context**"的地方 —— pi 那条「MCP 不 composable」的批评（5.5）指的就是这一步。

### 3.5 三个关键发现（2026-09-22）

| # | 发现 | 为什么重要 |
|---|---|---|
| **①** | **引擎的"零感知"是接口形状给的，不是我们克制** | `ToolDefinition`（`lib/types.ts:87-91`）只有 3 个字段，**没有"来源"这个维度** ⇒ 红线天然不会被碰 |
| **②** | ⭐ **`definitions()` 是"详情被削掉"的那一刀** | MCP 的注解 / 标题 / `outputSchema` **到不了模型** ⇒ "注解不能信"在代码里已经成立了一半（3.4-Q4） |
| **③** | **整条链上 MCP 只有三个插入点，其余零改动** | 见 3.3：注册循环（★1）· 注册顺序（★2）· 审批白名单（★3）。**注意三个里有两个不是"新增代码"，是"改既有行为"** |

### 3.6 本节的行号会漂 —— 复核纪律

⚠️ **本节自己就是一次教训**：3.1 清单里审批那行的行号（原写 `:75` / `:125`）**在写下的当天就对不上代码**。

- 2026-09-22 核了三份历史（`dea7d1b` / `c95f252` / `07b2e6a~1`）：`needsConfirm` **一直在 `:63`**、兜底 `allow` **一直在 `:108`** —— 从来没在 `:75` / `:125`
- 更要紧的是**它还会继续漂**：C45（`07b2e6a`）把 `decideToolCall` 拆成 `blockSecretWrite` / `confirmOrRequest` / `applyDefaultArguments` 之后，兜底从 `:108` 推到了 **`:150`**
- 这正是 `AGENTS.md` 说的那件事的另一面 —— 那边管的是**工具的 `guidelines` 提到不存在的工具**（`lib/tools/index.test.ts` 会扫 token 断言），这边是**文档提到不存在的行**

⇒ **纪律**：本节的 `file:line` 只在**引用它的那一刻**有效。**要拿它去改代码之前，先打开那个文件核一遍**；核完把新行号写回来。

## 四、待拍板的问题（现在已知的，每条都要有答案才能进「详细设计」）

1. **依据用谁**：Cline 要不要按 §11.6 克隆进参考系？（还是以本地五家 + spec 为准，把 Cline 从依据里划掉）
2. **先支持哪些传输**：stdio（本机进程）先行，还是 stdio + streamable HTTP 一起？（spec 的 Transports 一节是依据）
3. **配置形态**：住 `config.mcp` 段（env 覆盖）/ 独立文件（`.statve/mcp.json` 之类，见 `C32`）/ 两者？
4. **⭐ 审批语义（最大的一条；规范已给方向）**：MCP 工具凭什么被放行 —— ① 一律弹框 ② 按 **server 别名**记信任（装一次、批一次）③ ~~信 `readOnlyHint` 之类的注解~~ —— **规范已关掉这条路**（`MUST consider tool annotations to be untrusted`，见 2.4）④ 顺手做 `B5`/`E5`（per-tool 重构，⚠️ 动红线）。规范那条 SHOULD（**human in the loop**）把默认值推向"要人批"，但"每次每个工具都弹"太吵 ⇒ 真正的选择在 ①②④ 之间
5. **命名与冲突**：前缀拿什么当命名空间（规范给了做法：`prefixing tool names with a server identifier`，**且明说不能用 `serverInfo` 自报的名字**）；与 14 把内置工具重名怎么办（`register` 是 `Map.set` ⇒ **静默覆盖**，`lib/tools/index.ts:32-34` —— 前缀能防 MCP 之间的撞车，**MCP 撞内置工具仍要显式处理**，否则一个外部 server 能悄悄顶掉 `bash`）
6. **生命周期**：server 进程谁启动、常驻还是按需、失败/超时怎么降级？与"注册表每请求重建"的关系？（推翻它 ⇒ 条件触发 + 红线流程）
7. **工具发现的范围**：只接 `tools`，还是也接 `resources` / `prompts`（spec 的 Discovery 一节）？
8. **规模**：工具数上去之后，提示词里的清单与 `tool_search` 条件触发线怎么处理（与 `C37` 的关系）？
9. **输出与错误**：远端结果超限 / 报错怎么回给模型（与 `C44` 的关系）；**两类错误的分工**规范已给（执行错误 SHOULD 给模型、协议错误 MAY）—— 要定的是**怎么落进我们既有的"标记"形状**（C36）；以及图像/资源类结果怎么落（与 `C12` 同源）
10. **安全**：MCP server 本身 = 本机任意代码执行 ⇒ "装一个 server"这个动作**谁批准**（规范侧要求 pin/sign/verify，见 2.3 的 OWASP #10）？指向本机 loopback 的地址要不要过地址闸门（`web-fetch` 的 loopback 拦截是既有先例）？
11. **elicitation / `InputRequiredResult`**：server 在调用**中途**要求补充输入时怎么办 —— 接到我们的 `ask_user_question` 通道（A4），还是判"这个 server 不支持"并如实报错？（规范里它是 **MAY**，不做也合规 —— 但"不做"要写进能力声明）
12. **工具清单会变（`listChanged`）**：我们"每请求重新组装"恰好能容纳"每次重列"，但要定**要不要订阅变化**、以及清单变了模型那边怎么知道

### 4.1 收口（2026-09-21）：这 12 条里，哪些**已经不是选择题**

| # | 现状 | 依据 |
|---|---|---|
| 1 | **建议把 Cline 从依据里划掉**（本机没有 + §11.6 要另走一遍流程）；第一依据改为 **官方规范 2026-07-28** + 本地五家 | 2.1 / 2.2 |
| 2 | **stdio 先行、Streamable HTTP 第二**；**不单独做 SSE 配置**（codex 与 DSH 都砍掉了独立 SSE） | 5.7 ① |
| 3 | 未定 —— ⚠️ **与 `C32`（项目级配置目录）撞同一块地**：MCP server 清单该住 `config.mcp` 段还是项目级文件，两者要一起看 | — |
| 4 | **规范给方向 + codex 给现成判据**：走**已有**审批门；**缺注解 = 要问**；注解只用来放宽、绝不用来放行 | 2.4 / 5.3 |
| 5 | **前缀 + 别名 + 字符规范化 + hash 兜底 + 双名分离**（三家现成）；**"撞内置工具"仍未定** —— 我建议**拒绝加载该 server 并明说**，不静默覆盖 | 5.3 / 5.6 / 5.7 ① |
| 6 | ⚠️ **必须拍**（我们与三家形态冲突）—— 我的倾向：**连接常驻、注册表仍每请求组装**（连接住模块级 manager，工具对象只是薄壳）⇒ **不推翻"每请求重建"**，从而避开条件触发与红线流程 | 5.7 ② |
| 7 | 第一版**只接 `tools`**；`resources` / `prompts` 进"不支持"清单 | 规范 Discovery 节 |
| 8 | **记数 + 给读数**（别学 DSH 那条无上限缺口）；超阈值再进 `C37` / `tool_search` | 5.7 ② / ④ |
| 9 | 错误抄 codex（可读文本 + `is_error`）；输出**先复用** `lib/tools/shared` 的 `truncate` —— ⚠️ **不顺手做 `C44`** | 5.3 / 5.7 ② |
| 10 | **规范给了 MUST**：安装要走「**不截断显示确切命令** + 标注危险 + **显式批准** + 可取消」；**env 清洗抄 DSH**；SSRF 复用 A5 的地址闸门 | 2.5(d) / 5.6 |
| 11 | 第一版**不做 elicitation / MRTR**，写进"不支持"清单（规范是 MAY） | 2.4 |
| 12 | 第一版**不订阅 `listChanged`**：每请求重新 `tools/list`（我们本来就是每请求组装） | 5.7 ② |

> **本表里"还要拍"的那几条已收进 `6.9` 决策页**（唯一正本）；这里保留的是**推导过程**（"为什么这几条已经不是选择题了"）。两处若打架，**以 6.9 为准**。

## 五、各家一手对照（侦察产物，2026-09-21）

> 规则：**每家一节，每条带 `文件:行号`**；读不到的**明确写读不到**，不猜（对齐 C31/C32 那两行的诚实口径）。

### 5.1 smolagents（`E:\agents-read\smolagents-main`）

> **一句话：它是个"薄壳"。** `src/smolagents/mcp_client.py`（171 行）只做配置解析与生命周期，**协议实现全部委托第三方包 `mcpadapt`**（`mcp_client.py:118`）—— 而那个包**不在本仓库、本机也没装** ⇒ 工具名/描述/超时/错误转换的底层细节**没读到**（这是「八」里的一条缺口）。

| 维度 | 它怎么做（file:line） | 我们该学 / 该躲 |
|---|---|---|
| 入口 | `MCPClient`（`mcp_client.py:33`，`__init__.py:24` 导出）与 `ToolCollection.from_mcp`（`tools.py:1052`）**两条路** | ⚠️ **同一个能力两条路、安全姿态还不一致**：`ToolCollection` 有 `trust_remote_code` 门禁，`MCPClient` **连这个开关都没有**（`:85-90`）⇒ 我们只留**一条**入口 |
| 传输 | stdio（传 `StdioServerParameters` 对象）/ `streamable-http` / 旧版 `sse`（传 dict + `transport` 键）；**无 websocket**（`mcp_client.py:108,113`） | 与规范三档一致；但"靠参数类型区分传输"不够显式 ⇒ 我们配置里应是**显式字段** |
| 工具命名 | **远端原名，无前缀无命名空间**；`tests/test_mcp_client.py:127-129` **明确断言两个 `echo_tool` 并存** | ✅ **抄反例**：多 server 必撞车 ⇒ 必须加前缀（规范也这么建议） |
| 生命周期 | **构造即连接**（`mcp_client.py:122`）、server 跑在**独立线程**的事件循环里（`tools.py:962`）、靠 `with` / `disconnect()` 收尾（`:135`）；**不绑 agent**（agent 只收到一串 `Tool`） | ✅ **正面**：接入层产出工具、内核零感知 —— 与我们的 `RegisteredTool` 形状天然对齐；⚠️ **负面**：忘 `disconnect` 就漏子进程 ⇒ 我们要有 owner（谁建谁关） |
| 超时 | **完全没有**（唯一透传口是 `adapter_kwargs`，`mcp_client.py:51`） | 必须自己定（规范 SHOULD implement timeouts） |
| 审批 | **没有任何审批**；只有 `ToolCollection` 那个 `trust_remote_code` 布尔（`tools.py:1052`），文档里一句口头警告（`docs/source/en/tutorials/tools.md:173`） | ⚠️ **反例**：规范 SHOULD 要 human in the loop ⇒ 不能照它 |
| 错误 | MCP 工具就是普通 `Tool`，**异常不吞**：`agents.py:1490-1502` 包成 `AgentToolExecutionError` 抛出 | ⚠️ **反例**：规范说**执行错误 SHOULD 给模型**（让它自纠），抛出去模型就看不到了 ⇒ 我们按 C36 的「标记不抛错」 |
| 截断 | 通用 20000 字符（`utils.py:254`） | 与 `C44`（超限留一份 + 给定位）同源问题 |

### 5.2 opencode（`E:\agents-read\opencode`）—— **通用客户端最完整的现成实现**

> 一句话：通用 MCP 客户端 = `packages/opencode/src/mcp/index.ts`（**1004 行**，传输直接复用官方 `@modelcontextprotocol/sdk`），工具发现/命名在同目录 `catalog.ts`；`packages/core/`（V2）**只有配置 schema、没有客户端**（`core/src/tool/builtins.ts:28-29` 的 TODO 明说 "Keep MCP and plugin transforms separate"）。
> ⚠️ `packages/opencode/src/tool/mcp-websearch.ts:58-96` 那条**不是这个客户端**：手写单个 JSON-RPC `tools/call` 直发托管端点、跳过握手与 `listTools` —— **别拿它当客户端模板**。

| 维度 | 它怎么做（file:line） | 学 / 躲 |
|---|---|---|
| 传输 | stdio：`command[]` + `cwd` + `environment`、stderr 走 pipe（`mcp/index.ts:344-357`）；streamable HTTP 首选（`:269-276`）；**SSE 是 fallback 不是配置项**（按 `[StreamableHTTP, SSE]` 顺序试，命中 auth 错误就 `break`，`:269-332`）；配置靠判别联合 `type: "local" \| "remote"`（`core/src/v1/config/mcp.ts:6-7,44-46`） | ✅ 传输**显式字段**区分（比 smolagents 靠参数类型好）；SSE 当 fallback 省一个配置面 |
| 配置 | `mcp.<name>`，**全局与项目各一份**（`cli/cmd/mcp.ts:509-534` 让你选存哪份）；local 字段 `type/command/cwd/environment/enabled/timeout`（`v1/config/mcp.ts:6-23`）；remote `type/url/enabled/headers/oauth/timeout`（`:44-59`）；`enabled:false` **完全不连**（`mcp/index.ts:374-376`） | ⚠️ **文档说默认超时 5000，代码是 `DEFAULT_TIMEOUT = 30_000`（`mcp/index.ts:38`）** —— 文档/代码漂移，**别照文档抄** |
| 命名 | 统一前缀 **`服务器名_工具名`**，**两边都做字符规范化**（非 `[a-zA-Z0-9_-]` → `_`）（`catalog.ts:117-119`） | ⭐ 规范化的**理由**是"名字要能被权限规则 **glob** 匹配"（`permission/index.ts:28-38`）—— 比"防重名"深一层 |
| 冲突 | **没有冲突检测**：MCP 工具直接写进与内置工具**同一张表**、写在后面 ⇒ 同名后者覆盖（`session/tools.ts:92-134` vs `:390-489`） | ❌ 躲（codex 才给了完整消解，见 5.3） |
| 发现 | `listTools` 分页（游标去重 + 上限 1000 页）（`catalog.ts:18-36`）；SDK 对 `outputSchema` 校验失败时**降级成宽容 schema 重发** `tools/list`（`:145-168`） | ✅ **宽容降级**值得抄：别让一个坏 schema 毁掉整个 server |
| 生命周期 | **按目录实例 + 懒加载 + 常驻**（`InstanceState.make`，`:492-529`）；关闭先 `SIGTERM` 子孙进程再 `client.close()`（`:531-556`）；断连 → 删缓存 + `failed("Connection closed")` + 发 `ToolsChanged`（`:442-455`）；`tools/list_changed` **重拉并刷新缓存**（`:461-471`）；**没有自动重连**（显式 API `POST /mcp/{name}/connect`，`handlers/mcp.ts:75-86`） | ⭐ 与我们的"注册表每请求重建"**正相反**（常驻缓存 + 变更事件）—— 正好是「四·6」要拍的那件事的现成对照 |
| 失败降级 | 连不上只记状态字符串（`failed` / `needs_auth` / `needs_client_registration`），**该 server 的工具静默消失、会话照跑**（`:334-337, 383-388`）；OAuth 类失败弹 toast 教你去跑 `opencode mcp auth`（`:303-322`） | ✅ "知道它什么时候会失败"靠 **status API**，不靠异常 |
| **权限** | **走同一套 permission**：执行前 `ctx.ask({ permission: key, patterns:["*"], always:["*"] })`，`key` = `server_tool` 全名（`session/tools.ts:408`）；内建 MCP 资源工具被映射成固定 `read`（`permission/index.ts:204-214`） | ⭐⭐ **同表 ⇒ 审批天然继承**（正是我们要的那条路）；代价是重名无护栏 |
| 注解 | grep `readOnlyHint\|destructiveHint` 在 `src/` **零命中** —— 不拿注解做风险分级 | ✅ 与规范"注解不可信"一致 |
| 可见性 ≠ 授权 | `Permission.visibleTools` 只在"整个工具被 `deny *`"时隐藏，用于 code-mode 目录与 instructions 注入（`permission/index.ts:216-219`）；**实际授权仍由执行时 `ask` 决定** | ✅ 这条判据可直接抄 |
| 提示词 | 服务级 `instructions` 包成 `<mcp_instructions><server name="...">` **进系统提示词**（`session/system.ts:121-137`，挂载点 `prompt.ts:1261`） | ⚠️ **外部文本进提示词 = 信任边界**，我们 C34 的"规矩住工具文件"管不到它 ⇒ 要单列决定 |
| 规模 | code mode 开启时 MCP 工具**不进扁平表**，改成一个目录挂在 `execute` 工具里（`session/tools.ts:388` + `tool/code-mode.ts:58-65`） | ✅ 一条**规模策略**（对 `C37` / `tool_search` 有用） |
| 输出 | text 块 `"\n\n"` 拼接；`image` 与 `resource.blob` → attachments（不支持的 MIME 或 >10MB 降级成一行说明）（`session/tools.ts:426-462`）；**超 2000 行 / 50KB 就整份落盘**，只回预览 + "用 Grep/Read 或委派 Task"提示，metadata 带 `truncated`/`outputPath`（`tool/truncate.ts:85-141`） | ✅ 与 **`C44`** 完全同形 —— 可当 C44 的一手依据 |
| 错误 | `result.isError` → `throw`（`catalog.ts:68-74`）→ 框架置 `status:"error"` 写进 message，**该错误文本作为下一次请求的工具结果回给模型**（`processor.ts:416-418, 186-199`） | 效果与我们"标记不抛错"相近，**路径不同**（它靠框架兜） |

### 5.3 codex（`E:\agents-read\codex`）—— **命名消解与审批默认值的范本**

> ⚠️ **前提更正**：这份 checkout 的 `codex-rs/` 下**没有 `mcp-server/` crate**（glob + grep Cargo.toml 全 0 命中）—— 它是**纯 MCP client**。入口 `codex-rs/codex-mcp/src/lib.rs`（`McpRuntime` / `McpBinding` / `ToolInfo`）+ 传输 crate `codex-rs/rmcp-client/`。

| 维度 | 它怎么做（file:line） | 学 / 躲 |
|---|---|---|
| 传输 | `enum McpServerTransportConfig`：`Stdio { command, args, env, env_vars, cwd }` / `StreamableHttp { url, bearer_token_env_var, http_headers, env_http_headers }`（`config/src/mcp_types.rs:564-578`）；**协议版本可切换**：`enum McpProtocolMode { Legacy, V20260728 }`（`rmcp-client/src/protocol_mode.rs:9`） | ✅ 明确把 **Legacy/Modern** 做成开关，不硬编码单版本 |
| 配置 | `[mcp_servers.<name>]`（`config/src/config_toml.rs:278`），CLI `codex mcp add`（`cli/src/mcp_cmd.rs:92`）；每 server 有 `startup_timeout_sec` / `tool_timeout_sec` / **`required`**（`mcp_types.rs:235,256,260`） | ⭐ **"必需 server"与"可选 server"分开**：必需起不来=报错，可选=降级 |
| 命名 | 模型可见名 = **`mcp__<server>__<tool>`**（前缀常量 `codex-mcp/src/tools.rs:22`）；前缀**可关、可按 server 关**（`[features] non_prefixed_mcp_tool_names`） | ✅ 默认开、例外可关 |
| ⭐ **冲突消解（四层）** | ① 同名工具**直接跳过 + warn**（`tools.rs:135`）② 命名空间撞 → **12 位 sha1 后缀**（`:252`）③ 工具名撞 → hash 后缀（`:248`）④ **长度上限 128** + 截断后再补 hash（`:226,269,289`）；**原始名始终保留**：`ToolInfo.server_name` / `tool.name` 回协议，`callable_namespace` / `callable_name` 给模型（`:34-45`） | ⭐⭐ **最完整的范本**。尤其"**原始名 vs 模型可见名分开存**"—— 我们的 `RegisteredTool.name` 一肩挑两职（`lib/tools/index.ts:66-71`），接 MCP 时这里必缠 |
| 生命周期 | **按 turn 发布** + `enum McpStartupPolicy { Eager, LazyWhenCached }`（`codex-mcp/src/runtime.rs:65`）；有缓存才惰性启动（`connection_manager.rs:255-256`）；失败**后台重连 + 退避**（`rmcp_client.rs:211,278`） | ✅ "按 turn 发布"与我们"每请求组装"最接近 |
| ⭐ **审批** | 走既有审批：`maybe_request_mcp_tool_approval` 四路分支（Approved/Denied/TimedOut/Abort）（`core/src/mcp_tool_call.rs:277,292-351`）；判据 `requires_mcp_tool_approval`（`:2413-2430`，**2026-09-21 我自核过原文**）三段：① `destructive_hint == Some(true)` ⇒ 问 ② **`read_only_hint == true` ⇒ 直接放行**（`:2419-2424`）③ 否则 `destructive_hint.unwrap_or(true) \|\| open_world_hint.unwrap_or(true)` ⇒ **缺注解 = 问** | ⭐ **缺注解就问**这一半值得抄（正是"注解不可信"的保守用法）；⚠️ **但它另一半与规范打架**：靠 `readOnlyHint: true` 放行＝**信了注解**，而规范是 **MUST untrusted**（2.4）⇒ **我们不抄这一半**，见 6.3 |
| 沙箱 | 把 sandbox 状态作为 request meta **下发给 server**（`mcp_tool_call.rs:523`）；`McpConfig` 携带 `permission_profile`（`mcp/mod.rs:154,164`） | 与 `C2 沙箱` 的预留接口 —— 说明"MCP 与沙箱不是两件事" |
| 错误 | **变成 `is_error: true` 的 text content，不抛异常**（`protocol/src/models.rs:2264,2271`），文案带上下文 `tool call failed for \`{server}/{tool}\``（`binding.rs:359`）；启动失败话术**直接教你加 `startup_timeout_sec`**（`connection_manager/startup.rs:75`） | ⭐ 与规范 SHOULD（执行错误给模型）+ 我们 C36 同形；"错误文案带可执行建议"值得抄 |
| 多模态 | 模型不支持图片时 `sanitize_mcp_tool_result_for_model` 换成一句 text（`mcp_tool_call.rs:907`） | 与 opencode 的 attachments 对照（两种取向） |

### 5.4 langchainjs（`E:\agents-read\langchainjs`）—— **适配层边界范本（但命名/冲突是反例）**

> 一句话：`MultiServerMCPClient` + `loadMcpTools`（`libs/langchain-mcp-adapters/src/index.ts:3,22`）把 MCP 工具转成 LangChain `DynamicStructuredTool`。

| 维度 | 它怎么做（file:line） | 学 / 躲 |
|---|---|---|
| 传输/配置 | 三种：stdio / http / sse（SSE 复用 HTTP schema）（`src/types.ts:249,351`）；stdio 有 `command/args/env/cwd/stderr/restart`（`:258-308`），http 有 `url/headers/authProvider/reconnect`（`:360-384`）；顶层 `mcpServers`（`:683`） | ✅ 字段面比 opencode 还全（`restart`/`reconnect` 都进配置） |
| 命名 | **默认不加前缀**：`defaultLoadMcpToolsOptions` = `prefixToolNameWithServerName: false`（`tools.ts:1178`）；前缀是可选拼接（`:1224-1228,1254`） | ❌ 对我们**反例**：默认无前缀 + 冲突推给使用者（`types.ts:839` 只有一句注释） |
| 冲突 | **没有处理**（`grep duplicate\|collision` 只命中一条注释） | ❌ |
| 生命周期 | 懒初始化（`client.ts:340`，`getTools` 触发）+ 显式 `close()`（`:620`）；**连接池按 (transport, server, config) 去重**（`connection.ts:84-85`） | ✅ "同一 server 同配置不复连"值得抄 |
| 权限 | **无审批、无沙箱**（`grep approval\|sandbox\|permission` 零命中） | ❌ 反例（规范 SHOULD 要人 in the loop） |
| 错误 | `result.isError` → **抛 `ToolException`**（`tools.ts:837-839`）；兜底 `:1174` | ❌ 反例（对"给模型自纠"不友好）—— 但它服务的框架需要异常 |
| 工程细节 | schema 为 LLM 简化：`dereferenceJsonSchema` → `simplifyJsonSchemaForLLM`（`:1244,1250`）；连接失败策略可配 `onConnectionError`（`throw` 默认 / `ignore` / 函数）（`types.ts:696`）；`throwOnLoadError` | ✅ **schema 简化**值得抄；失败策略"可配"比"写死"好 |

### 5.5 pi（`E:\agents-read\pi`）—— ⚠️ **我们的主参考明确"不做 MCP"** · ⛔ **本节结论已作废（2026-11-05）**

> ⛔ **结论作废，原文保留。** pi 从 **`0.99.0`（2026-09-29）** 起内置 MCP；本节下面引的两句原话（`README.md:501` "No MCP." / `usage.md:310` "It intentionally does not include built-in MCP"）在 **1.5.0 里已经 grep 不到**。
> **为什么留着原文**（`AGENTS.md` 第 10 条）：补记不覆盖原文 —— 要看得见"2026-09 当时凭什么这么判"。**替代结论见 §十一。**

**这条必须让用户看见**（它是"该不该做"的反方论证，不是遗漏）：

- `packages/coding-agent/README.md:501` — "**No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support."
- `packages/coding-agent/docs/usage.md:310` — "It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash."
- 它给的路是**扩展**（`README.md:397` 的能力清单里有 `MCP server integration`）。
- 全仓 grep `\bmcp\b|MCP` 只 **7 处**命中，**无任何实现文件**（`glob **/*mcp*` 只有 `node_modules` 里无关文件）。

**但它这条路**不能**当成我们的依据**（三条理由，写清免得下个会话拿它当结论）：

1. pi 的替代方案建立在"**工具有 CLI + README 载体**"上（用 Skills 封装 CLI 工具）；我们的工具是**进程内 TS 工具**，没有那个载体。
2. 它的扩展模型**不是更安全的边界**：`README.md:414` 原文 "Pi packages run with full system access." —— 比 MCP 的"外部进程 + 显式配置"面更大。
3. 它明确**没有 permission popups**（`usage.md:310`），而我们**有**审批面 —— 它不需要 MCP 的审批问题，我们有。

⇒ **结论**：C1 的理由**不是"pi 做了"**（⚠️ 2026-11-05 更正：这句在 2026-09 成立，pi 现已内置 MCP，见 **§十一**），而是：① 七层对照表把 **T 层唯一的洞**标在这里 ② 作品判据要求"**能力面不能有洞**"。**这是一个需要被拍板的取舍，不是既定事实。**

### 5.6 DSH（`E:\agents-read\deepseek-harness`）—— **工程细节最硬的一家（三条别家没有）**

> 一句话：**有 MCP 且只有 client 侧** —— `packages/mcp/mcp-client`（连外部 server、把远端工具注册进 `ctx.tools`，公开名带 server 限定）+ `packages/mcp/mcp-resources`（三个共享资源工具）。**没有 "DSH 作为 MCP server" 的包**（`@modelcontextprotocol/server` 只出现在测试夹具）。
> 第二个接入面容易漏：**ACP**（Zed 等编辑器）在 `newSession` 里传标准 `mcpServers[]`，DSH 把它翻成 **Agent 作用域**的 mcp-client 插件（`packages/acp/acp/src/mcp.ts:32`、`session.ts:135`）。

| 维度 | 它怎么做（file:line） | 学 / 躲 |
|---|---|---|
| 传输 | **只有两种**：stdio / streamable-http（**没有独立 legacy SSE**）（`mcp-client/src/transport.ts:33,40`；`index.ts:121,133`）；SDK 钉死 `@modelcontextprotocol/client: 2.0.0`、协商 `versionNegotiation: { mode: 'auto' }`（`connection.ts:262`） | 与 codex 一致（两家都砍掉独立 SSE 配置） |
| 配置 | **Cordis profile YAML 的插件条目**（`name:` + `config:`），一台 server 一条记录；`serverName` 必填且 `[A-Za-z0-9_-]{1,32}`（`README.zh.md:55`、`index.ts:40` 的 `SERVER_NAME_PATTERN`）；默认值：`toolCallTimeoutMs` 60s · `maxInstructionBytes` 32768 · `failOnStartupError` **false** · `reconnect {initial 500, max 30000, maxAttempts 10}`（`index.ts:37,127-140`） | ⭐ **别名有字符集/长度约束**（我们的前缀直接用它，约束要照抄） |
| ⭐ **env 清洗** | stdio 子进程 env = `scrubbedParentEnv()`：**删掉 `/KEY\|PASSWORD\|SECRET\|TOKEN/i` 与所有 `DSH_*`**，再叠显式 env（`transport.ts:21-23`；`packages/subprocess/.../index.ts:47,66`） | ⭐⭐ **别家都没有的一条** —— 默认把父进程的秘密**不给**子进程。**我们要直接抄** |
| 命名 | 纯函数 **`mcp__<serverName>__<rawName>`**；非法字符或超 **64 字符** → 截断 + 12 位 sha256 后缀（`tools.ts:82,84-86`） | 与 codex 的 `mcp__s__t` 形状一致（64 vs 128 上限不同） |
| ⭐ **整代原子换** | 先 fetch 出**完整下一代**再切换：fetch 失败**保留上一代**；注册冲突（外来注册占了本 server 的命名空间）**整体回滚成零工具**；服务端在同一个列表里重复列同一工具 ⇒ **整份列表判无效**、保留上一代（`tools.ts:119-162,126-130`） | ⭐⭐ **"绝不给模型半个工具集"** —— 我们要抄这条判据（比 langchain 的 `throwOnLoadError` 更细） |
| ⭐ **两个名字严格分开** | 原文："The raw name is only ever sent on the wire (`tools/call`); **the public name is never parsed to recover it**."（`tools.ts:9-10`） | ⭐⭐ **公开名只能"生成"、不能"反解"**（我们 `RegisteredTool.name` 要拆两职，见 5.3 的同一发现） |
| 生命周期 | **常驻**：一 plugin 实例 = 一台 server = 一条长期连接；`apply` **阻塞激活**到首连 + 首轮发现结束（`index.ts:194-202`）；拆除由 Cordis effect + 卸载钩子（`index.ts:184-192`、`connection.ts:388-407`）；**重连** 500ms 起翻倍、上限 30s、同一次 outage 共享 `maxAttempts=10`，耗尽则**注销工具**并停（`connection.ts:211-245`）；中断期间旧工具仍列出但调用报 `server is disconnected`（`:369`） | ⭐ 与我们"注册表每请求重建"正相反 —— **两家（opencode/DSH）都选常驻**，这条要正面拍 |
| 失败降级 | `failOnStartupError:false`（默认）⇒ 记 warning + 进重连循环、**harness 照常启动**（`index.ts:199-202`） | 与 opencode 的软降级同形 |
| 权限 | MCP 工具**自带零权限语义**（schema 只有 `name/description/parameters`，无 readOnly/destructive；`packages/llm/llm/src/types.ts:447-451`）；走**同一套通用门** `tools/pre-execute` waterfall → `ask` → `ctx.approval`（`core/tools/src/index.ts:146`）—— ⚠️ **没有 approval 服务时 `ask` 直接变 deny**（`:1702-1705`） | ⭐ 第三条同表继承的实现（三家都是这条路）；"没审批服务就拒绝"是**安全默认** |
| ⚠️ **按名字预授权做不到** | `tools.restrict({allow,deny})` 是**精确名字**过滤、且要求名字已在"当前已知全局工具"集合里；**MCP 工具是异步发现的 ⇒ 不能提前按名字 restrict**（`core/tools/src/index.ts:1077-1098`）；permission-presets 只捆 sandbox + approval，**无 per-tool 名单**（`permission-presets/src/index.ts:181-194`） | ⚠️ **一条硬限制**：动态工具与"按名字的策略"天然错位 ⇒ 我们的审批不能只靠名字白名单（现在 `TOOLS_NEEDING_CONFIRM` 恰好就是名字白名单） |
| ⚠️ **stdio 子进程不在它自己的沙箱内** | spawn 由 MCP SDK 负责，DSH 只共享 env 清洗定义、**不接管 spawn**（`transport.ts:18-19`） | ⚠️ **它自己承认的缺口** —— 我们要么纳入自己的进程策略，要么明确接受 |
| 规模 | **工具数量与 schema 大小都没有任何上限**（README 自己承认 token 影响，`README.zh.md:168`）；只有"服务器指令"有 **32 KiB** 上限（**超限直接让连接失败**）（`connection.ts:320-321`） | ⚠️ **缺口**：设上限时"超限即失败"还是"截断"要自己定 |
| 输出 / 错误 | 成功：canonical 值保留完整 MCP JSON，给模型的内容按块投影（text 换行合并 / `resource_link` → 一行 / audio 与未知块 → 有界诊断文本）（`tools.ts:461-511`）；`isError:true` **在图片持久化之前就 throw**（模型看到明确失败、不会看到假成功）（`:297-299`）；图片仅 PNG/JPEG/WebP/GIF 且模型声明支持才落 attachment（`:352-440`） | ⭐ "先判 isError 再处理内容"的顺序值得抄 |
| 与 spill 的关系 | MCP 包自己不 spill；通用 `dsh-spill-policy` 是 `tools/post-execute` 整形器，**只处理"全是 text 块"的结果**（带图的不 spill）；超 `maxInlineBytes` → 首尾预览 + locator，全文落 `dsh-spill-local`；**尽力而为**：无 owner / 无后端 / 保存失败 ⇒ 保持原样，**绝不把成功变成 isError**（`spill-policy/src/index.ts:191-204,80-88,133-156`） | ⭐ 与 `C44` 同源；"spill 失败不能让调用变失败"是一条**判据**（抄） |

### 5.7 收口：五家对照之后，哪些已经不是选择题了

**① 五家一致（可以直接当我们的默认）**

| 一致点 | 谁这么干 | 结论 |
|---|---|---|
| 命名 = **前缀 + 服务器标识**，且**纯函数/hash 兜底**、冲突**必须消解** | codex（四层消解）· DSH（纯函数 + 原子换）· opencode（前缀 + 规范化）· langchain（可选前缀，**不做消解**）· smolagents（**没有**） | 抄前三家；**"默认不加前缀"是给库用的取舍，我们是产品 ⇒ 默认加** |
| 审批 = **走已有那套门**，不为 MCP 另造 | codex（`maybe_request_mcp_tool_approval`）· opencode（`ctx.ask`）· DSH（`pre-execute` → `ask`） | 抄；我们对应的是 `_pipeline/approval` 那个 `decideToolCall` |
| **不消费工具注解** | opencode（grep 零命中）· DSH（grep 零命中）· 规范（`MUST untrusted`）；⚠️ **codex 是"半例外"** —— 它**缺注解 = 要问**（对），但 **`readOnlyHint: true` 会直接放行**（`:2419-2424`，**那一半与规范 MUST 冲突**） | 定死：**注解一律不参与放行**（比 codex 严一档）；**缺注解 = 要问** |
| 错误 = **可读文本 + `isError` 给模型**，不把框架异常甩给模型 | codex（`is_error: true` text）· DSH（throw 给**框架**但模型看到明确失败）· langchain（抛 `ToolException`，**反例**） | 抄 codex；与我们 C36 的"标记不抛错"同形 |
| 传输只要 **stdio + streamable HTTP** | codex · DSH 都**没有独立 SSE 配置**；opencode 把 SSE 降为 fallback | 我们的第一版：**stdio 先行**，HTTP 第二（不单独做 SSE 配置） |

**② 两家对一家/各不相同（必须拍）**

| 维度 | codex | opencode | DSH | 我们的处境 |
|---|---|---|---|---|
| **生命周期** | 按 turn + `Eager/LazyWhenCached` | 按目录**常驻**（InstanceState） | **常驻** + `apply` 阻塞到首连 | ⚠️ 我们"注册表每请求组装"⇒ 与三家的形态冲突（见待拍板 6） |
| **审批默认** | **未标注就问**（注解只能放宽） | 同表继承（由内置工具的审批决定） | 无 approval 服务 ⇒ **ask = deny** | 我们的 `TOOLS_NEEDING_CONFIRM` 是**名字白名单**，动态工具落不进去 ⇒ 现在=**默认放行** |
| **规模** | 有 deferred/搜索与暴露策略（`spec_plan.rs:193`） | code-mode 目录（不进扁平表） | **无任何上限**（自认缺口） | 我们 14 把 + MCP ⇒ 逼近 `tool_search` 触发线（>20） |
| **输出超限** | 多模态裁剪 | **落盘 spill**（2000 行/50KB） | spill **只吃纯文本** | 我们有 `lib/tools/shared` 的 `truncate` 原语 ⇒ 复用还是照抄 spill（`C44`） |
| **别名可关前缀** | 可（feature / 按 server） | 无 | 无 | 第一版不必做 |

**③ DSH 独有的三条硬知识（别家没有，值得直接抄）**：**env 清洗**（`scrubbedParentEnv` 删 `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*`）· **整代原子换**（绝不给半个工具集）· **公开名绝不反解**（raw name only on the wire）。

**④ 两条"大家都躲不掉的缺口"**：① **stdio 子进程不在自己的沙箱内**（DSH 自己承认；codex 是唯一把 sandbox 状态下发给 server 的）② **工具数量/schema 无总量预算**（DSH 明确没有，opencode 用 code-mode 绕开）。

---

## 六、详细设计

> ⛔ **草稿 v0（2026-09-21）—— 未定稿。** 下面把设计写到"**只剩几个开关**"的程度；那几处**由人拍板**，拍完本节即可定稿、状态才改 `已纳入 I2`（门禁：依据 ✅ · 详案 ✅ · 验收 ✅）。
> **依据**：规范 2.4 / 2.5 · 五家对照 5.1–5.6 + 收口 5.7 · 我们的接缝「三」· 待拍板「四」+ 4.1。

### 6.0 先答两个"形态级"问题（2026-09-21 查清）

| 问题 | 答案 | 依据 |
|---|---|---|
| 用**官方 MCP SDK** 还是自己写协议层？ | **两条都不违反既有决定** —— 归档里那条「不用 SDK」**只针对模型适配层**（"用 `fetch` 手写 adapter…以后要接多家供应商、要 OAuth/缓存等高级能力时，**再引入 SDK**"）。而且**本仓库没装任何 MCP SDK**（`node_modules` 里没有 `@modelcontextprotocol`） | `doc/plan-archive/02-四个直接问题回答.md:8-12,33`；`package.json` |
| 传输能不能复用 `BashRunner`？ | **不能** —— 它 `stdio: ["ignore","pipe","pipe"]`（stdin 是 ignore），而 MCP stdio **必须双向** | `lib/tools/bash/bash-runner/index.ts:154` |

⚠️ **SDK 与自研的取舍（我建议自研，理由在下面，但它是个真开关）**：抄 SDK = 快、正确性高、与 DSH/opencode 一致；**自研** = 零依赖 + 能看清"JSON-RPC → 我们的工具形状"这一层转换（与归档那条"做中学"的取向一致），代价是版本协商 / 分帧 / 超时都得自己写对。**第一版只做 stdio + `tools/list` + `tools/call` 三个方法 ⇒ 自研的量很小**，所以我倾向自研 —— ⛔ 但这条要你点头（列进 6.9）。

### 6.1 模块与接缝（**内核零改动**）

新增 `lib/mcp/`（一个模块一族，对齐 `lib/tools/<工具>/` 的既有粒度）：

| 文件 | 职责 | 为什么单独一块 |
|---|---|---|
| `naming/index.ts` | **纯函数**：`publicName(alias, rawName)` + 校验 / 截断 / hash 兜底 | 可单测、零 IO；**公开名只能生成、绝不反解**（5.6） |
| `framing/index.ts` | **纯函数**：字节流 → 一条条 JSON-RPC 消息（半行缓冲、`\r\n` 容错） | 规范：消息以 newline 分隔且 **MUST NOT** 含内嵌换行（2.5(a)）⇒ 与"按块收数据"是两件事 |
| `transport/stdio/index.ts` | 起子进程 + 双向管道 + 关闭顺序 | 见 6.4（**不能复用 `BashRunner`**） |
| `client/index.ts` | 连接 + `tools/list` + `tools/call` + id 关联 + 每请求超时 | 协议会话的薄壳 |
| `tools/index.ts` | 远端工具 → `RegisteredTool[]`（审批声明 + 双名映射） | **适配层**：唯一知道 MCP 形状的地方（贴 langchain 的边界，5.4） |
| `manager/index.ts` | 连接持有、状态、失败降级、读数 | ⛔ 生命周期待拍（6.9-5） |

**产出**：`RegisteredTool[]` → `createToolRegistry`（`lib/tools/index.ts:114`）。**`lib/agent/index.ts` 不动** ⇒ 红线不触发。
**装配点**：`app/api/chat/_pipeline/tools.ts:28`（每请求组装那一处）。

### 6.2 命名（纯函数；抄 codex / DSH 形状）

- `publicName = mcp__<alias>__<rawName>`；`alias` 由**我们的配置**给 —— 规范明确：**不许用 `serverInfo` 自报的名字**（可能重名、可伪造，2.4）
- `alias` 校验 `^[A-Za-z0-9_-]{1,32}$`（抄 DSH 的 `SERVER_NAME_PATTERN`）
- 非法字符 → `_`；超长 → 截断 + hash 后缀。**两家的原值（2026-09-21 我自核原文）**：**codex** 分隔符 `__` · `MAX_TOOL_NAME_LENGTH = 128` · sha1 前缀 12 位（`codex-mcp/src/tools.rs:225-227,243-250`）；**DSH** `MAX_PUBLIC_NAME_LENGTH = 64` · `INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g` · sha256(`${server}\0${raw}`) 取 12 位、形如 `…_<hash>`（`tools.ts:48-54,81-87`）⇒ ⛔ 6.9-1
  ⭐ **为什么必须规范化（2026-09-21 找到一手证据）**：DSH 的文件头写着它的规范化是为了「`normalized to the DeepSeek function-name constraints`」（`tools.ts:8`）；**我原先说"我们自己仓库里查不到出处"—— 现在有了**：
  **OpenManus 的真实 issue [#1143](https://github.com/FoundationAgents/OpenManus/issues/1143)**（已关闭）把 **server 的启动路径**拼进了工具名（`'name': 'mcp_/root/miniconda3/envs/openmanus/bin/python_bash'`），API 直接回 **400**：
  > `Invalid 'tools[0].function.name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.`
  它那次请求的 `model` 是 **`deepseek-chat`**（issue 里的请求日志原文）⇒ **约束来自 DeepSeek 侧**，字符集与 DSH 的 `[^A-Za-z0-9_-] → _`、opencode 的 `sanitize` **完全吻合**。⚠️ 我另外读了 [DeepSeek 官方 Tool Calls 指南](https://api-docs.deepseek.com/guides/tool_calls)（HTTP 200，2026-09-21）——**那一页没有写这条 pattern**，所以现在的依据是**真实 400 报文**，不是官方文档。
  ⇒ 结论：**字符集有硬证据；长度上限仍只有实现取值可选**（DSH 64 / codex 128），而 codex 的 128 是**它自己**的上限常量。**6.9-1 建议取 64**（更保守，且与"未来换 provider"无关地安全）。
- **双名分离**：`RegisteredTool.name` = 公开名；执行时走 `alias + rawName` 映射（**绝不从公开名反解**，5.6 原文）
- **撞内置工具** ⇒ ⛔ 6.9-2（现在是 `Map.set` 静默覆盖，外部 server 能顶掉 `bash`）

### 6.3 审批：**两层**（C1 最要紧的一处）

**第一层｜安装**（规范 **MUST**，2.5(d)）：新 server 第一次启用时要有**同意动作**，且满足四形状（**不截断显示确切命令** · 标注 potentially dangerous · 显式批准 · 可取消）。⛔ 6.9-3：第一版它长什么样 —— ① 只有配置 + 记档（**等于没做这条 MUST**）② 前端一次弹框 ③ 复用现有审批弹框（它现在只服务工具调用）。我倾向 ②。

**第二层｜调用**：现在 `decideToolCall` 是「**名字白名单 + 兜底 allow**」（`approval/index.ts:29-35,75,125`）⇒ **动态工具必然自动放行**。改造方向 = **声明式**：
- 给 `RegisteredTool` 加**审批声明**（如 `approval?: "ask" | "auto"`，**缺省 `"ask"`**）
- 内置工具逐个声明（写 / 改 / 删 / bash = `ask`，只读 = `auto`）—— 这正是 `E5` 的形状
- MCP 适配器**一律 `ask`**，且**注解一律不参与放行**（规范 **MUST untrusted**；codex 的「缺注解 = 要问」抄、它「`readOnlyHint` 就放行」那一半**不抄**，见 5.3）
- ⛔ 6.9-4：**是否顺手做 `B5`/`E5`**（`B5` ⚠️ **动红线**）还是不碰红线、只在产品层加一条"`mcp__` 前缀 ⇒ ask"

### 6.4 传输：stdio 先行（HTTP 第二版）

- **新 spawner**：`stdio: ["pipe","pipe","pipe"]`（双向）；**不套 `cmd /c chcp 65001` 那层** —— 规范规定 JSON-RPC **MUST be UTF-8**（2.5(a)）⇒ 固定 UTF-8 解、**不需要猜编码**，与 bash 那条 PowerShell 代码页的历史无关
- **复用**：`lib/process-output` 的 `createOutputDecoder()`（**每流一个实例**，`bash-runner:180-183` 的教训）；Windows 杀进程树 `taskkill /pid /t /f`（`bash-runner:205`）—— 规范同样要求 Windows 用 `TerminateProcess` / Job Objects（2.5(a)）
- **stderr 不是错误信号**（规范 **SHOULD NOT** assume，2.5(a)）⇒ 收进轨迹 / 启动失败诊断，**不进模型上下文**
- **关闭顺序**（规范 SHOULD）：关 stdin → 等退出 → 超时强杀
- ⛔ 6.9-5（**本轮最大的开关**）：连接生命周期 —— ① 连接常驻、注册表仍每请求组装（**我建议**：连接住 `lib/mcp/manager`，工具对象只是薄壳 ⇒ **不推翻既有前提**、避开 §7.3.5 条件触发与红线）② 每请求连 / 断（最简、最慢）③ 会话级（要新造一处所有权层级）

### 6.5 发现的**原子性**（抄 DSH「整代原子换」）

`tools/list`（分页取全）→ 构建**完整下一代** → 全成功才切换；任一失败**保旧代**；server 在同一列表里重复列同一工具 ⇒ **整份列表无效**；注册冲突 ⇒ 回滚成零工具。**判据一句话：绝不给模型半个工具集。**（5.6）

### 6.6 失败与读数

每 server 一个状态（`ok` / `failed(reason)` / `disabled`）；启动失败**不阻断会话**（软降级，抄 opencode / DSH）；工具结果与 `details` 带 server 名与状态；**读数**（工具数 + schema 字节数）⛔ 6.9-6 —— 至少别学 DSH 的"无上限"缺口。

### 6.7 输出与错误

- 结果：text 块按序拼接；`structuredContent` → JSON 文本；image / audio / resource_link / 嵌入 resource **第一版降级成一行说明**（不做附件）
- `isError: true` → **正常返回 `ToolResult`（人话 + 标记），不抛异常**（抄 codex，与我们 C36 同形）：文本里带 `[MCP 工具报错：<server>/<tool>]`
- 超限：**复用** `lib/tools/shared` 的 `truncate`；外部内容提示复用同文件的 `EXTERNAL_CONTENT_NOTICE`；⛔ **不顺手做 `C44`**
- ⛔ 6.9-7：server 的 `instructions` **进不进系统提示词**（opencode / DSH 都进）—— 我倾向第一版**不进**（外部文本 = 注入面，规范也没要求）

### 6.8 第一版明确不做（写进能力声明）

`resources` · `prompts` · **elicitation / MRTR** · OAuth（stdio 本就 SHOULD NOT 走它）· `listChanged` 订阅 · Legacy `initialize` 兼容 · 多模态附件 · 前缀可关 · resources/prompts 相关的三个内建工具。

### 6.9 ⛔ 决策页（**唯一正本** · 拍完即定稿 · 共 12 条）

> ⚠️ **从 5 条变成 11 条**：4.1 收窄出 5 条，**写详案时又冒出 6 条**（标「新」的）—— 是"落到字面上才发现"，不是之前漏看。**别处不再重复列。**
>
> **拍法建议（2026-09-21）**：只有 **5 条**需要你主动拍（`0 / 2 / 3 / 4 / 5`，因为它们各自有真代价）；其余 **6 条**是"选个默认值就行"。你只要说一句「**按暂定走，第 X 条改成 Y**」就够了 —— ⚠️ **但沉默不算同意**，我不会自己把暂定当已拍。

> ⚠️ **2026-11-05：多了第 12 条（`6.9-11` 工具暴露分级）** —— pi 1.5.0 内置 MCP 后暴露出来的新问题，来龙去脉见 **§十一**。它**属于"要你主动拍"**那一类 ⇒ 现在要主动拍的是 **6 条**。本文其余地方凡写「11 条」「5 条主动拍 / 其余 6 条」的，都是 **2026-09 的形态，保留不改**（时间线）。
> ⚠️ **顺带一条悬空引用（本次未动）**：`2.3` 与 `2.4` 说「6.9 第 11 条（elicitation）」，但**本表没有任何一行是 elicitation**（`6.8` 明确第一版不做它）—— 属既有悬空引用，待核。

| # | 题目 | 两条路的代价 | 暂定（我的建议） | 新? | 要你主动拍 |
|---|---|---|---|---|---|
| **6.9-0** | **协议层：自研 vs 官方 MCP SDK** | **自研** = 分帧 / 超时 / 版本三处自己写（约两百行），换来零第三方依赖 + 看得清"JSON-RPC → 我们的工具形状"这一层；**SDK** = 这三处白拿、与 DSH/opencode 同源。⚠️ **代价已量化**（2026-09-21 查 npm registry）：`@modelcontextprotocol/sdk@1.30.0` = **4.32 MB / 693 文件 / ~17 个直接依赖**（`ajv`·`hono`·`express`·`jose`·`eventsource`·`cors`·`pkce-challenge`…）**+ 必需 peer `zod`**；而我们**全仓现在只有 10 个运行时依赖** ⇒ 这不是"引一个库"，是**依赖数翻两倍多** | **自研** | 新 | ✅ |
| 6.9-1 | 公开名长度上限 64 / 128 | 64 = 保守、与 DSH 同（超长要截断+hash）；128 = 与 codex 同（长名少拐一次） | **64** | 新 | — |
| **6.9-2** | **撞内置工具怎么办** | **拒绝加载该 server** = 安全、但一台坏 server 拖累它全部工具；**只跳过撞名那个工具** = 保住其余、但模型看到的是"少了一把"（必须在读数里明说） | **拒绝加载 + 明说** | — | ✅ |
| **6.9-3** | **安装层同意怎么落** | **前端一次弹框** = 满足规范 **MUST**（不截断显示命令/标注危险/显式批准/可取消），代价是**要动 UI**；**只写进配置 + 记档** = 不动 UI，但**等于这条 MUST 没做** | **前端一次弹框** | 新 | ✅ |
| **6.9-4** | 是否顺手做 `B5`/`E5`（per-tool 审批重构） | **顺手做** = 一次到位，⚠️ **动红线** `lib/agent/index.ts`（要走"精读 pi → 对比 → 展示 → 拍板"）；**产品层打补丁**（`mcp__` ⇒ `ask`）= 不动红线，代价是审批规则**从此有两处** | **产品层补丁**，`B5` 留给自己那一项 | 新 | ✅ |
| **6.9-5** | **连接生命周期** | **连接常驻**（+ 注册表仍每请求组装）= 快、贴合三家做法，代价是引入一个长驻连接持有者（要管清理）；**每请求连/断** = 零架构改动，代价是 stdio 每次都起进程 + 握手（慢），且与三家都不同 | **连接常驻 + 注册表每请求组装** | — | ✅ |
| 6.9-6 | 读数给谁看 | `details` + 日志 = 零 UI；前端面板 = 可视化但要设计（本项不做也符合"知道它什么时候会失败"） | **`details` + 日志** | 新 | — |
| 6.9-7 | server `instructions` 进系统提示词吗 | 进 = 与 opencode/DSH 一致、信息全，代价是**外部文本进提示词 = 注入面**；不进 = 第一版更窄 | **第一版不进** | 新 | — |
| 6.9-8 | 依据换不换（Cline 不在本地） | 划掉 = 少一次克隆；保留 = 按 §11.6 走完整流程（确认存在 → 架构解析 → 导航卡 → 回填） | **划掉 Cline**（第一依据 = 规范 + 本地五家） | — | — |
| 6.9-9 | 配置住哪（`config.mcp` 段 vs 项目级文件） | `config` 段 = 快、与现有配置入口一致；项目级文件 = 与 `C32` 一致，代价是**两件事必须一起定** | **与 `C32` 一起看**（本项暂不动这块地） | — | — |
| 6.9-10 | 审批默认吵不吵（"缺注解就问" = 每次弹框） | 先接受吵 = 安全、可能烦；立刻"按 server 记信任" = 安静，代价是放宽（且与规范 SHOULD 更远） | **先接受吵**，用实测数据再决定 | — | — |
| **6.9-11** | ⭐ **要不要做"工具暴露分级"（exposure＝这把工具以什么身份存在：模型直接看见 / 按需加载 / 只能脚本里调 / 隐藏）** | **不做**（第一版一律 `direct` 平铺进 `definitions()`）= 零新机制，代价是**外部 server 的工具直接进模型清单**：14 把 + 一个 server 就可能越过 `tool_search` 的触发线（>20）；**做** = 与 pi 1.5 同形，但 `codemode` / `deferred` 两档**依赖我们还没有的两样东西**（脚本执行器 / `tool_search`）⇒ 等于把 C1 撑成三个功能 | **不做**：只做 `direct` + 前缀 + 审批 `ask`；把"越过 20 线"写成 C1 的**已知风险**，交付后立刻评估（依据：§5.7② 的规模行 · §6.8 第一版裁剪 · 我们仓库里既无 `tool_search` 也无脚本执行器） | 新 | ✅ |

### 6.9-0a ⭐ 核实结果（2026-10-08 · 直读官方包类型定义）

> **为什么有这一节**：原 `6.9-0` 只写了"自研 vs SDK"两条路，**没人核实过"能不能只用 SDK 的会话层、把传输握在自己手里"** —— 而那恰恰是我们想要的（进程策略必须在我们手上，见 5.7④ 与 6.4）。
> **怎么读到的**：`node` 从 npm registry 取 tarball（**1,552,450 字节**）解到**仓库外**临时目录，读 `dist/*.d.mts` —— **只读公开类型定义，没读实现，没有装进本项目**。

**① C 路线（官方 `Client` + 自带 transport）成立 —— 且官方为它设计过**

| 事实 | 原文 / 位置 |
|---|---|
| `Client.connect` 收**任何** `Transport` 实现 | `connect(transport: Transport, options?: ConnectOptions): Promise<void>`（`dist/index.d.mts:2041`） |
| `Transport` 是**公开接口**，共六样（三方法 + 三回调） | `start()` · `send(message: JSONRPCMessage, options?): Promise<void>` · `close()` · `onclose` · `onerror` · `onmessage(message: JSONRPCMessage)`（`dist/index-D4xIIEF6.d.mts:1693-1707`） |
| ⭐ 官方**点名支持自带 stdio 传输** | 版本协商注释里两次出现 "…**in place for custom stdio-shaped transports**"（`dist/index.d.mts:1542,1577`） |

⚠️ **一处必须纠正的直觉**：`Transport.send` 收的是**已解析的 `JSONRPCMessage`，不是字节** ⇒ **分帧（字节 ↔ 消息）仍归传输层**。所以 C 路线省下的**不是**分帧。

**② 三条路线的真正分界（修正 9.3 的"缩成 4 块"）**

| 路线 | 我们自己写 | 官方包给 | 基座块数 |
|---|---|---|---|
| **A** 全自研 | 全部六块 | — | 6 |
| **C** 官方 `Client` + **自带 transport** | `naming` · **`framing`** · **`transport`** | **`client`（会话层）** | 5 |
| **B** 官方 `Client` + 官方 stdio 传输 | `naming` · `tools` · `manager` | `framing` · `transport` · `client` | 3 |

**③ 最该记住的一条：`client` 那一层**不是**薄壳（6.1 把它低估了）**

`6.1` 的表述是"连接 + `tools/list` + `tools/call` + id 关联 + 每请求超时"。实测它的公开面还包括：

| 官方包**内建**的东西 | 位置 / 意味着什么 |
|---|---|
| **两代协议 + 版本协商** | `VersionNegotiationMode = 'legacy' \| 'auto' \| { pin }`，**默认 `'legacy'`**；`'auto'` 要先发 `server/discover` 探测，还要处理规范强制的 **`-32022`「选一个共同版本继续」**修正步（`index.d.mts:1527-1599`） |
| 探测用的**兄弟进程**机制 | 官方自家 stdio 传输会另起一个"随时可弃"的兄弟进程（理由写得很具体：**收到未 `initialize` 就退出的 server 必须判成 legacy**）；**自带传输则原地探测**（`:1570-1578`）⇒ 与 6.9-0b 那个子开关直接相关 |
| 现代代次的**每请求 `_meta` 信封** | `:1958-1968` |
| **响应缓存**（TTL / `cacheScope` / 逐方法失效） | `_cache` · `_defaultCacheTtlMs` · `_listMaxPages`（`:1896-1911`） |
| **`listChanged`** 防抖 + 自动开订阅 | `_listChangedDebounceTimers` · `_autoOpenedSubscription`（`:1911,1930`） |
| 输出 schema 校验（`./validators/*` 可插拔） | `_jsonSchemaValidator`（`:1895`） |
| **`input_required` 驱动 = elicitation / MRTR** | `_inputRequiredDriverConfig`（`:1920`） |
| 请求超时默认值 | `DEFAULT_REQUEST_TIMEOUT_MSEC` |
| ⭐ **内存直连对**（单测用） | `InMemoryTransport.createLinkedPair()`（`index-D4xIIEF6.d.mts:2485`）—— **7.5 里打算"自己写十几行"的东西，包里现成** |

⇒ **两条推论**：

1. **`6.9-0` 的真实代价模型不是"省两百行分帧"**，而是"**省下整个两代协议协商 + 缓存 + 变更订阅 + elicitation 管道**"；代价是直接依赖 10 → 17（选 `client`），且**这些能力会在包里存在**。
2. **走了官方包之后，"不做 elicitation / 不做缓存 / 不订阅 `listChanged`"从"不实现"变成"不暴露"** —— 这直接决定 `6.8` 那份能力声明怎么写，也决定「要么不做、要么做全」该怎么复核：**自己的实现里"没有"很干净；官方包里"有但没启用"必须写清楚。**

### 6.9-0b ⛔ 若选 C，附带一个子开关：`versionNegotiation.mode`

- **`'legacy'`（默认）** = 不做协商，直接走 2025 那套 `initialize` 握手 —— 官方原话是"**与不设此选项的客户端逐字节相同**"。
- **`'auto'`** = 先探测 `server/discover`；⚠️ **自带传输时探测在我们的传输上"原地"跑**（官方原话），对我们的 `transport` 实现要求更高 —— 官方自家传输才用兄弟进程规避。
- **`{ pin: '<版本>' }`** = 严格钉在现代代次，不符合就大声失败。
⇒ **要拍的是**：我们要不要"现代代次"（2026-07-28+）？规范读的是 2026-07-28，但**包的默认是 `'legacy'`** —— 这一条决定了我们实际跑在哪一代协议上。

### 6.10 参考实现索引（动手时按需打开，别重读）

| 要抄什么 | 去哪看 |
|---|---|
| 命名消解四层（跳过 / sha1 后缀 / 截断补 hash / 原始名与公开名分离） | codex `codex-rs/codex-mcp/src/tools.rs:135,226-289,34-45`（5.3） |
| **缺注解 = 要问** 的审批判据 | codex `core/src/mcp_tool_call.rs:2413,2426`（5.3） |
| `is_error: true` 文本 + 可执行建议的错误文案 | codex `protocol/src/models.rs:2264-2271` · `binding.rs:359` · `connection_manager/startup.rs:75`（5.3） |
| **整代原子换** / 纯函数命名 / env 清洗 | DSH `mcp-client/src/tools.ts:119-162,82` · `transport.ts:21-23`（5.6） |
| 前缀 + 字符规范化（为权限 glob 匹配） / code-mode 目录 | opencode `mcp/catalog.ts:117-119` · `permission/index.ts:28-38` · `tool/code-mode.ts:58-65`（5.2） |
| 适配层边界（连接池留在 client） / schema 简化 | langchainjs `langchain-mcp-adapters/src/tools.ts:1244-1250` · `connection.ts:84-85`（5.4） |
| 规范：分帧 / 关闭顺序 / 版本错误码 / 安装同意四形状 | 2.4 · 2.5（a)(b)(c)(d) |

> ✅ **索引自核（2026-09-21）**：上表里 codex 的三处 + DSH 的两处 + opencode 的一处，**我逐个打开原文核过**（不是只信子代理的转述）。核的过程里**逮到我自己的一个错**：codex 的审批判据不止"缺注解就问" —— 它还有 **`readOnlyHint: true` ⇒ 直接放行**（`:2419-2424`）。我原先把它写成"同时满足规范两条"，**是错的**（那一半与规范 MUST 冲突）。已改 5.3 / 5.7① / 6.3。
> **核出来的原值**（可直接进代码注释）：codex = 分隔符 `__` · 上限 **128** · sha1 取 12 位；DSH = 上限 **64** · `[^A-Za-z0-9_-]` → `_` · sha256(`server\0raw`) 取 12 位、`…_<hash>`。

## 七、验收（草稿 v0 · ⛔ 待定稿）

> 分三层（对齐 11.5：单测测 **seam**、真机测"**模型据此改行为**"——后者 AI 测不了，见 C36 的老规矩）。

### 7.1 单测层（纯函数 + 适配层，沙箱里能跑）

| 测什么 | 判据（**先红后绿**；每条都要能说出"这个状态为什么真的会发生"） |
|---|---|
| `publicName` | `mcp__fs__read` 形状；非法字符 → `_`；超长 → 截断 + hash；**同一输入必同输出**（重启 / HMR 后权限规则仍匹配 —— 5.6 的原话） |
| 撞名 | 两个 server 同名工具 → 两个不同公开名；**撞内置工具 → 拒绝加载并报出**（6.9-2 拍后定） |
| 分帧 | 一条消息跨两个 chunk → 合成一条；两条挤一个 chunk → 拆两条；空行 / `\r\n` 容错；**半行不丢**（连接关闭时 flush） |
| id 关联 + 超时 | 乱序响应按 id 对上；超时**不 hang**（错误文本回给模型） |
| 发现原子性 | fetch 失败 ⇒ **保旧代**；重复列同一工具 ⇒ **整份无效**；注册冲突 ⇒ 零工具（**绝不半套**，6.5） |
| `isError` | ⇒ `ToolResult` 文本 + `[MCP 工具报错：…]` 标记，**不抛异常** |
| **畸形结果校验** | 远端返回 `null` / `{content:[42]}` / `{content:[{type:"image"}]}` ⇒ **判为错误，垃圾不进模型上下文**（规范：clients **SHOULD** validate tool results before passing to LLM；DSH 有现成三例，见 7.5） |
| 审批 | MCP 工具**缺声明 ⇒ `ask`**；`bypass` / `never` 两档行为（6.9-4 拍后定） |

### 7.2 真机层（"**别人能跑通**"）

接一个**公开、无需凭据**的 MCP server（首选 stdio，如 `npx -y @modelcontextprotocol/server-everything`）⇒ 模型能发现它、能调用它、结果回到上下文、审批按声明弹框。
⚠️ **命令必须自包含**（应用工作区根 = `<仓库>/workspace`，不是仓库根 —— 2026-09-20 的教训，`AGENTS.md`）。

### 7.3 失败清单（"**知道它什么时候会失败**"——每条都要有一次实测）

| # | 造什么 | 期望 |
|---|---|---|
| F1 | server 命令不存在 | `failed` 状态 + 会话照跑；读数里明说哪台没起来 |
| F2 | 启动超时（睡够超时时间） | 超时错误文本回给模型，**不 hang** |
| F3 | 运行中杀掉 server | 调用报 `server is disconnected`（抄 DSH），工具状态可查 |
| F4 | 两个工具重名 / 重复列同一工具 | **整代拒绝 + 读数**（不静默覆盖、不给半个工具集） |
| F5 | 工具名含非法字符 / 超长 | 走截断 + hash，且**仍能路由回原始名** |
| F6 | 工具返回 `isError: true` | 模型看到**错误文本**并能自纠（不是框架异常） |
| F7 | 用户拒绝审批 | 工具不执行；模型收到"被拒绝"而不是"成功" |
| F8 | env 检查 | 子进程里**拿不到**父进程的秘密（`DEEPSEEK_API_KEY` 等 —— 抄 DSH 的 `scrubbedParentEnv`） |
| F9 | server 返回**畸形结果**（`null` / `content:[42]` / 非文本块） | 判为错误、**不把垃圾塞进模型上下文**（DSH 的 `it.each` 三例） |
| **F10** | **公开名里混进非法字符**（点号 / 斜杠 / 路径） | ⭐ **这是真事故，不是假想**：OpenManus [#1143](https://github.com/FoundationAgents/OpenManus/issues/1143) 把 server 启动路径拼进名字 ⇒ API **400** `does not match pattern '^[a-zA-Z0-9_-]+$'`，且**每次请求都失败、整个会话瘫痪**（`RetryError`）。我们的期望：**纯函数 + 校验让这种名字根本产不出来**（测试守住），而不是"发出去等 400" |

### 7.4 出口（怎么算这一项做完）

① 7.1 全绿 + `tsc --noEmit` 0 + 全量测试无回归；② 7.2 用户在本机 `pnpm dev` 下人工过一遍并判定通过（**会话记录原文留档**，不转述）；③ 7.3 **十条**逐条有实测记录；④ 详案回填施工记录。

### 7.5 夹具来源（按 11.5 的夹具规则：**每条都要能说出「这个状态为什么真的会发生」**）

> 做法：**先去找真实夹具，不手编**。结果——DSH 的 `tests/fixture-server.ts`（78 行）几乎把我们需要的状态**全造齐了**，而且**每一处都写了"为什么这是真的"**。我们照它的形状**手写一份零依赖的夹具服务器**（不引 SDK），并在夹具注释里保留这些理由。

| 要测的状态 | 夹具 | **为什么这个状态真的会发生**（这条是 11.5 的硬要求） |
|---|---|---|
| 正常调用 | 夹具 server 的 `add` / `greet` 工具 | DSH 真实 e2e 就用它们 |
| **点号/非法工具名** | 工具名 **`admin.reset`** | ⭐ **两处独立证据**：① DSH 夹具专门注册了它，注释原文：**"Dotted name: legal in MCP, illegal in the DeepSeek function-name contract"**（`fixture-server.ts:66-68`）② **真事故**：OpenManus #1143 把 server 路径拼进名字 ⇒ API 400（`^[a-zA-Z0-9_-]+$`）—— 见 6.2 与 F10 |
| 公开名形状 | **`mcp__fixture__ping`** | DSH 的真实测试断言里就有这个字符串（`protocol.spec.ts:63`）——**不是我编的** |
| `isError` | `fail` 工具 → `{content:[{type:'text',text:'Something went wrong'}], isError:true}` | DSH 夹具原文（`:34-41`） |
| **回复后崩溃** | `crash` 工具 → `setTimeout(() => process.exit(7), 25)` | ⭐ 夹具注释原文：**"Exit AFTER the response flushes so the caller observes a clean result followed by a transport close, like a real post-reply crash"**（`:55-64`）—— 这就是 11.5 要的那句话本身 |
| 图像块 | `image` 工具（返回 `image/png` 块，`:43-53`） | 真实 server 会返回的内容类型（对应我们"第一版降级成一行说明"） |
| **畸形结果** | `null` / `{content:[42]}` / `{content:[{type:"image"}]}` | DSH 的 `it.each` 三例（`tool-definition.spec.ts:45`）——真实 SDK 校验失败的真实形状 |
| 超时 | 夹具 server 的 `slow` 工具（睡够超时） | 真实原因 = server 卡住；规范 **SHOULD** implement timeouts ⇒ 必须有一条 |
| **分帧：半行 / 两条挤一块** | **不属于任何 server** —— 是**传输层切块**造成的 | ⚠️ 接线注释要写真因：**`stdout` 的 chunk 边界与消息边界无关**（OS/管道按块给数据，边界由 newline 定）—— 与我们 `createOutputDecoder` 面对的是同一件事 |
| 发现原子性（重复列同一工具） | 夹具 server 故意在同一份 `tools/list` 里重复列一个工具 | DSH 有对应的判断与文案："server listed tool \"…\" more than once — invalid tool list"（`tools.ts:126-130`）；规范也说该集合**不该随连接变**（2.4） |

**测试策略分两层（"能走真管道就走真管道"的落地）**：

1. **单测层不起进程**：让 client 接受**可注入的两条流**；测试里用一对**内存 pass-through**（抄 DSH 的 `InMemoryTransport.createLinkedPair()` 思路，我们自己写十几行）⇒ framing / id 关联 / 超时 / 原子换 / 校验都能确定性测，且不碰 spawn。
2. **真进程层**：另有一条 e2e **真的 spawn 我们手写的夹具服务器**（`node fixture-server.mjs`）—— 否则"能走真管道"就是白说。**零依赖**（只用 `node:readline` 说话），所以不引 SDK。
3. ⚠️ **为什么不直接用官方 `server-everything` 当夹具**：它需要**装包 + 联网**（`npx -y …`），进不了确定性的单测；但它**正是 7.2"别人能跑通"那一层该用的东西** —— 两层各司其职。
   ✅ **"这名字是真实包名"已确认**（2026-09-21 查 npm registry，上一轮只有 `.bin` shim 这一个证据）：**`@modelcontextprotocol/server-everything@2026.8.31`**，bin 名 `mcp-server-everything`，带 `start:stdio` / `start:sse` / `start:streamableHttp` 三种起法，官方自述 **"MCP server that exercises all the features of the MCP protocol"** ⇒ **它就是 7.2 该用的那台**。⚠️ 前置条件：用户本地要**联网**跑 `npx -y`（它自己依赖 `@modelcontextprotocol/sdk ^1.30.0` + `zod ^4`）。

## 八、⚠️ 缺什么才能定案

- [x] 五家一手对照（每节带 `文件:行号`）：**smolagents 5.1 · opencode 5.2 · codex 5.3 · langchainjs 5.4 · pi 5.5（明确不做）· DSH 5.6** → 收口见 **5.7**（2026-09-21 全部到位；⚠️ **2026-11-05 更正：pi 0.99.0 起已内置 MCP，5.5 作废 → §十一**）
- [x] spec 2026-07-28：`server/tools` ✅（2.4）+ **传输 / 版本 / 安全**（2.5，7 个页面全 HTTP 200）—— ⚠️ 详案引用具体措辞时回 2.4/2.5 核锚点（网页无行号，按小标题定位）
- [x] **详细设计草稿 v0**（六，含 6.10 参考实现索引 · 行号已自核）· **验收草稿 v0**（七：7.1 单测 8 条 / 7.2 真机 / 7.3 失败清单 F1–F9 / 7.4 出口 / **7.5 夹具来源**）—— ⛔ 未定稿
- [ ] **6.9 的 11 个开关拍完** ⇒ 详案 + 验收定稿 ⇒ 状态改 `已纳入 I<n>` + 建 `doc/iteration/i<n>.md`（**这一步之前不许写产品代码**）
- [ ] ⚠️ **"要么不做、要么做全"已定（2026-09-22）⇒ 6.9 里那些按「最小版」写的裁剪项要重过一遍**（第一版不做缓存 / 前缀可关 / 不做 elicitation / 不做 resources·prompts …）—— 见文件头部「回来先读这一段」第 5 条
- [ ] ⚠️ **`ttlMs` / `cacheScope` 接不接**（2026-09-22 才补进 2.4）—— 它决定 `manager` 存不存缓存。⚠️ **2026-10-08 新证据**：走 **C / B** 时官方 `Client` **内建响应缓存**（`_defaultCacheTtlMs` / `cacheScope`）⇒ 问题从"我们自己存不存"变成"**启不启用它、信不信它的缓存**"。见 **6.9-0a ③**
- [x] ⭐ **6.9-0 的"第三条路"已核实**（2026-10-08）：**C（官方 `Client` + 自带 transport）成立**，官方明确支持自带 stdio 传输 —— 接口原文与行号在 **6.9-0a**；顺带修正了 **9.3** 的映射，并提出子开关 **6.9-0b**
- [ ] ⭐ **`Skills over MCP` 扩展与 `C37` 的关系**（2026-09-22 从规范的 Extensions 挖到）—— 是否影响 C37 的走向
- [x] ~~**bash 子进程继承全部环境变量**~~ —— **不是本项的缺口**；2026-09-22 已单独入池 `PLAN.md` 的 **C47**
- [x] ~~`mcpadapt` 内部行为~~ —— 影响面已被 codex / DSH / opencode 三家覆盖，**不再当阻塞项**（但仍是"没读到"的事实）
- [x] **基座规划已成文**（**九**：结构图 / 六块契约 / 决策落点）+ **外部接入方式一手侦察**（**十**）—— 2026-09-21 加

## 九、基座规划（`lib/mcp/`）—— 结构 / 契约 / 边界

> **这一节回答"基座是什么"。** 6.9 的那些开关**不是**一张偏好清单 —— 它们各自落在下面这张图的某个坐标上（落点见 **9.3**）。
> ⚠️ 顺序：**先有图，再谈开关**。没有图，开关就是一堆互不相干的观点（2026-09-21 用户原话："我还是不知道你让我拍板的这些到底和我们的 mcp 基座有什么关系"）。

### 9.0 一句话与边界图

**基座 = 让"接一个新 server"不用再写代码的那一层。** 第一个 server 和第十个 server 走的是同一条路。

```
   配置：一行 = 别名 + 命令 + 参数 + env
                  │
  ┌───────────────┼────────────────────────────────────┐
  │  lib/mcp/     ▼      ← 这六块就是「基座」            │
  │                                                     │
  │   ⑥ manager     连接持有 / 状态 / 失败降级 / 读数      │ ← 6.9-5
  │        │                                            │
  │   ③ transport   起子进程 / 双向管道 / 关闭顺序         │
  │        │                                            │
  │   ② framing     字节流 → 一条条 JSON-RPC 消息          │ ← 6.9-0
  │        │                                            │
  │   ④ client      说 tools/list · tools/call · 对 id    │ ← 6.9-0
  │        │                                            │
  │   ⑤ tools       远端工具 → RegisteredTool[]           │ ← 6.9-2 · 6.9-10
  │        │          （① naming 是它调用的纯函数）        │ ← 6.9-1
  └────────┼────────────────────────────────────────────┘
           ▼
   装配点  app/api/chat/_pipeline/tools.ts:28      ← 每请求组装（既有的一处）
           ▼
   lib/tools 注册表（既有，不动）
           ▼
   审批关口  app/api/chat/_pipeline/approval       ← 6.9-4（改它就动红线）
           ▼
   模型 → 要调用 → 转发过去 → 结果回来
```

**图的入口**是配置（`6.9-9`：住 `config.mcp` 段还是项目级文件 —— 与 `C32` 一起定）。

### 9.1 六块契约（每块：收什么 / 给什么 / **不做什么**）

| 文件 | 收什么 | 给什么 | **不做什么**（越界就是设计错了） |
|---|---|---|---|
| `naming/index.ts` | `alias` + `rawName` | 合法公开名（`mcp__<alias>__<rawName>`，纯函数） | 零 IO；**不从公开名反解原始名**（映射另存，5.6） |
| `framing/index.ts` | 字节 chunk | 一条条 JSON-RPC 消息 | 不认方法名、不做路由；半行缓冲 / `\r\n` 容错归它 |
| `transport/stdio/index.ts` | 命令 + 参数 + env | 双向流 + 关闭顺序 | 不讲协议、不管超时；**不复用 `BashRunner`**（它 stdin 是 `ignore`，6.0） |
| `client/index.ts` | 一对流 | `tools/list` / `tools/call` 的结果 | 不管命名、不管审批、不管工具形状 |
| `tools/index.ts` | client 的结果 | `RegisteredTool[]`（公开名 + 审批声明 + 双名映射） | 不持有连接（归 manager）；**唯一知道 MCP 形状的地方**（5.4 的边界） |
| `manager/index.ts` | 配置 | 每 server 一份状态 + 可用的 client | 不做业务决策；**失败不阻断会话**（软降级） |

**为什么是六块而不是一个文件**：每块**对应一类可单测的失败**（framing 对应分帧、client 对应超时/id、tools 对应畸形结果、manager 对应启动失败）—— 这正是 11.5 说的 **seam**。

### 9.2 与既有代码的接缝（就三处）

| 接缝 | 位置 | 说明 |
|---|---|---|
| 产出 | `createToolRegistry(context, hooks)`（`lib/tools/index.ts:114`） | 基座交出 `RegisteredTool[]`，注册表照旧每请求新建 |
| 装配 | `app/api/chat/_pipeline/tools.ts:28` | 每请求组装工具的**那一处**，基座在这里接进去 |
| 审批关口 | `app/api/chat/_pipeline/approval/index.ts:29-35,75,125` | ⚠️ 现在是「名字白名单 + **兜底 `allow`**」⇒ 动态工具**必被自动放行** —— 这是 C1 必须动它的**实证**，不是偏好 |
| （内核） | `lib/agent/index.ts` | **零改动** ⇒ 红线不触发（**除非** 6.9-4 拍"顺手做 `B5`/`E5`"） |

### 9.3 决策落点（11 条各自在那张图上的位置）

| 决定 | 落在哪 | 影响 |
|---|---|---|
| **6.9-0** 自研 vs SDK | ② framing + ④ client **由谁写** | ⚠️ **2026-10-08 修正（证据见 6.9-0a）**：官方包**不替我们分帧**（`Transport.send` 收的是已解析消息）⇒ 要分两种 —— **C**（官方 `Client` + 自带 transport）= 只有 ④ 被顶掉（6 块 → **5 块**）；**B**（连官方 stdio 传输一起用）= ②③④ 都被顶掉（→ **3 块**）。代价：直接依赖 `client` 10 → 17 / `sdk` 按原记 10 → 27+ |
| 6.9-1 名字上限 64/128 | ① naming 的一个常量 | 只影响超长名怎么截断 |
| **6.9-2** 撞内置工具 | ⑤ tools → 装配点 | 拒绝加载 = 该 server 一把都进不来；只跳过 = 其余能用、但清单少一把（读数里必须明说） |
| 6.9-3 安装同意框 | **图外**（UI / `app/`） | 图里只管"记档/状态" |
| **6.9-4** 是否顺手做 `B5`/`E5` | **审批关口那一层** + `RegisteredTool` 带不带审批声明 | 改 = 规则归一处但**动红线**；不改 = 只在 `mcp__` 前缀打补丁，规则从此两处 |
| **6.9-5** 连接生命周期 | ⑥ manager 这块**存不存在** | 常驻 = 有 ⑥（快，多一个要清理的持有者）；每请求连/断 = ⑥ 几乎消失（最简、最慢） |
| 6.9-6 读数给谁看 | **图外**（`details` / 日志 / 面板） | 不影响基座 |
| 6.9-7 `instructions` 进不进提示词 | **图外**（提示词层） | 基座只决定"要不要把这段外部文本交出去" |
| 6.9-8 Cline 当不当依据 | **不是代码**（文档） | 不影响任何一块 |
| 6.9-9 配置住哪 | 图的**入口** | 与 `C32` 一起定 |
| 6.9-10 审批默认吵不吵 | ⑤ tools 的**默认值**（放行逻辑在关口） | 决定第一次用远端工具弹不弹框 |
| **6.9-11** 工具暴露分级 | ⑤ tools **进不进 `definitions()`**（装配方式） | 不做 = 外部工具全平铺进清单（逼近 20 线）；做 = 要连带 `tool_search` / 脚本执行器 |

**统计**：改基座本体 7 条（0 / 1 / 2 / 5 / 9 / 10 / 11）· 改基座与外面的接口 1 条（4）· 图外 3 条（3 / 6 / 7）· 不是代码 1 条（8）。
**真正决定"基座形状 + 工作量"的只有 2 条**：**6.9-5**（⑥ 存不存在）与 **6.9-4**（关口改不改、要不要动红线）。

### 9.4 基座不做的事

见 **6.8** 的清单（`resources` / `prompts` / elicitation / OAuth / `listChanged` / Legacy `initialize` / 多模态附件 …）—— 那里是唯一正本，本节不重复。

## 十、外部世界怎么接入（各家一手证据 · 2026-09-21 侦察）

> **这一节干什么用**：给 **6.9-3（安装同意）** 和 **6.9-9（配置住哪）** 提供一手依据；顺带回答"**我们拿到的 MCP 服务到底是什么形态**"。

### 10.1 两种形态：一行**命令**，或一个 **URL**

| 形态 | 客户端拿到什么 | 谁负责"装" | 例子 |
|---|---|---|---|
| **本机 server（stdio）** | **一行命令**（不是链接）· `command` + `args` + `env` | 命令自己：`npx -y` / `uvx` 首次运行会去下包（npm / PyPI），或直接用 Docker 镜像 / 本地 exe | VS Code 官方文档的 `playwright` 条目：`{"command":"npx","args":["-y","@microsoft/mcp-server-playwright"]}` |
| **远程 server（Streamable HTTP / SSE）** | **一个 URL**（+ 可选 headers / OAuth） | 服务器方托管，客户端只连 | VS Code 文档的 `github` 条目：`{"type":"http","url":"https://api.githubcopilot.com/mcp"}` |

**分发链**（官方 MCP Registry 页原文）：packages 住在 **npm / PyPI / Docker Hub**，Registry 只存 **metadata**（`server.json`：唯一名 `io.github.user/server-name` · 去哪找（npm 包名或远端 URL）· 执行说明（命令行参数、env））—— 而且 **Registry 不直接被 host 应用消费**，是给下游 marketplace 用的（`registry/about`）。

### 10.2 各家"添加一个 server"的入口（全部一手）

| 客户端 | 图形入口 | 配置真相 | 一手证据 |
|---|---|---|---|
| **VS Code** | 扩展视图 `@mcp` ⇒ **Install**（用户级）/ 右键 **Install in Workspace**；命令面板 **`MCP: Add Server`** 引导流 | `.vscode/mcp.json`（工作区）或用户 profile 的 `mcp.json`；`{"servers":{…}}` | VS Code 官方文档 [Add and manage MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) |
| **Cursor** | **Customize 页 / Marketplace 一键装**（"Add to Cursor" + OAuth）；社区目录 `cursor.directory` | `mcp.json` 的 `mcpServers`；stdio = `command`/`args`/`env`，remote = `url`/`headers`；支持 stdio / SSE / Streamable HTTP 三种 | Cursor 官方文档 [Model Context Protocol](https://cursor.com/docs/mcp) |
| **Cline** | 面板 **MCP Servers** ⇒ Configure ⇒ **Configure MCP Servers**（打开 JSON）；**Remote Servers** 标签：填 Server Name + **Server URL** + 传输类型 ⇒ **Add Server**；CLI 向导 `cline mcp` | `~/.cline/mcp.json` 的 `mcpServers` | Cline 官方文档 [MCP](https://docs.cline.bot/mcp/mcp-overview) |
| **Codex** | **无图形页**（CLI + TOML） | `~/.codex/config.toml` | `codex mcp` 子命令 = `list/get/add/remove/login/logout`（`codex-rs/cli/src/mcp_cmd.rs:48-54`）；`add` 的字段 = `name` +（`command`/`args`/`env` **或** `url`/`--bearer-token-env-var`/OAuth 参数）（`:93-162`）—— **互斥二选一**，与上面那张"两种形态"表完全对齐 |
| **opencode** | **交互式 CLI 向导**（`@clack/prompts`）`opencode mcp` | `opencode.json` 的 `mcp` 段（用 `jsonc-parser` 改）；条目 `type: "local" \| "remote"`，remote 有 `oauth` | `packages/opencode/src/cli/cmd/mcp.ts:53-66`（`type === "remote"` + oauth 判定）；`mcp/auth.ts` · `mcp/oauth-provider.ts` · `mcp/oauth-callback.ts` · `mcp/browser.ts` |
| **DSH** | UI 在**宿主层**（客户端不读配置文件） | 服务器清单**按会话由宿主传入**（ACP `newSession`） | `packages/acp/acp/src/mcp.ts:41-72`（`command` 必须**绝对路径** · 拒绝重名 · `url` 必须是 http(s)）· `acp/src/session.ts:135` 挂载 |
| **smolagents / langchainjs** | **没有"添加"这回事** —— 它们是库 | 写在代码里 | 5.1 / 5.4 |
| **pi** | ⚠️ **2026-11-05 已反**：**内置 MCP**（`pi mcp add\|list\|login\|logout` + 会话内 `/mcp`）；"不做"是 `0.99.0` 之前的形态 | `~/.pi/agent/mcp.json`（用户级）+ `.pi/mcp.json`（**要先授予 project trust 才读**） | §十一 · `docs/mcp.md` |
| **Claude Desktop** | 改配置文件 + 重启（本页官方教程的形态） | ⚠️ 本轮**只核到**：前置条件是**装 Node.js**（server 要运行时）、官方教程承诺"**every action 都要你显式许可**"；具体配置文件名/路径**未在本轮一手核到**（要用时补） | [Connect to local MCP servers](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers) |

### 10.3 三条观察（这才是给 6.9 用的）

1. **配置文件永远是真相，图形页只是它的编辑器。** VS Code 的 Install 写 `mcp.json`、Cline 的 Add Server 写 `mcp.json`、opencode 的向导写 `opencode.json`、Cursor 的一键装也落在 `mcp.json` —— **没有一家把 server 清单只存在 UI 的私有状态里**。
2. **没有"agent 自动添加"这种模式。** 主流做法的自动化程度止于①市场/注册表**发现**（VS Code gallery、Cursor Marketplace、Cline 市场）②**一键装**（写配置）。原因是规范的 Must：装本地 server = 跑一个可执行文件，**必须**给用户"不截断的命令 + 危险标注 + 显式批准 + 可取消"（2.5(d)）。**VS Code 就是这个 MUST 的现实样本**：官方文档原文写着装完"**When prompted, confirm that you trust the server to start it**"。
3. **"手动下载"在 stdio 形态下是隐式的**：用户写的往往只有 `npx -y <包名>`，**真正的"下载"发生在第一次运行时** —— 所以体验上像"一键装"，但**机器上确实多跑了一个来自第三方的程序**（这正是要人同意的原因）。

### 10.4 对我们（第一版）的三条结论

1. **我们第一版只做 stdio ⇒ 我们拿到的就是"一行命令"，没有 URL。** 所以 6.9-3 那个同意框要显示的是**命令原文**（不截断），不是链接。
2. **配置段就是真相**（`6.9-9`），UI 只是它的编辑器 —— 与 10.3① 一致；本项**不建市场、不接注册表**（那是另一件事，未入池）。
3. **"首次启用要一次显式同意"不是我们的发明**，是规范的 MUST + 至少一家（VS Code）的现实做法 ⇒ 6.9-3 的暂定（前端一次弹框）有**两个独立依据**。

---

## 十一、补记：pi 1.5.0 已内置 MCP（2026-11-05）

> **这是补记，不是新调研。** 起因：用户问「pi 现在（1.5）还不支持 mcp 吗」。
> 下面每条事实都来自**本机检出实读**（`E:\agents-read\pi`，commit `d57c2d219`，2026-11-05；`git describe` = `v1.5.0-184-gd57c2d219`），不是转述，也不是印象。

### 11.1 一句话

**MCP 从 `0.99.0`（2026-09-29）起就是 pi 的内置功能**，1.5.0 只是继续往前推（OAuth 硬化、project overrides、CIMD…）。**§5.5 整节作废**，但原文保留 —— 那是 2026-09 的判断现场。

### 11.2 证据链（每条都自己打开核过）

| 事实 | 位置 |
|---|---|
| 版本 = `1.5.0` | `packages/coding-agent/package.json:3` |
| 引入在 `0.99.0`（2026-09-29） | `packages/coding-agent/CHANGELOG.md:578`；`:582` New Features「**Codemode and MCP**」；`:590` Added「codemode, tool search, and **MCP support as built-in extensions**」（#10040） |
| 有独立的客户端包 | `packages/mcp/` = `@earendil-works/pi-mcp`；`README.md:3` 原文："It does **not** depend on the official MCP SDK or other pi packages." |
| 有真实现（不是只有文档） | `packages/mcp/src/`：`client.ts` · `transports/` · `oauth/` · `protocol/` · `naming.ts` · `input-schema.ts` · `output-limit.ts`；产品层 `src/core/mcp-servers.ts` + `src/extensions/mcp/`（10 个文件） |
| 有文档 | `packages/coding-agent/docs/mcp.md`（274 行） |
| ⭐ 有**官方一致性验收** | `packages/coding-agent/test/mcp-conformance/README.md:3,9` —— 跑 **官方 MCP conformance suite**（一致性测试套件：MCP 官方出的"你的客户端行为对不对"的公开测试集）并对比提交的 baseline，**CI 里有独立 job** |
| 旧结论的两句原话已消失 | `README.md:501` / `docs/usage.md:310` 那两句在 1.5.0 里 **grep 不到** |

### 11.3 它的形态（只写与 C1 直接相关的；术语当场括注）

| 维度 | 它怎么做 | 出处 |
|---|---|---|
| 公开名 | `mcp__<server>__<tool>`；`[^A-Za-z0-9_]` → `_`（**连 `-` 也换**）；上限 **64**；超长或撞名 → `sha256(server\0tool)` 取 **8 位** 后缀 | `packages/mcp/src/naming.ts:10,23,25-26` |
| 为什么连 `-` 也换掉 | 注释原文：`a-b` 与 `a_b` 会变成**同一个名字**，再靠 hash 后缀区分（对应真实事故 #10239） | `naming.ts:13-16` · `CHANGELOG.md:558` |
| ⭐ **exposure 四档**（暴露级别：这把工具以什么身份存在） | `codemode`（**默认**——模型清单里根本没有它，脚本用 `searchTools()` 找）/ `deferred`（`tool_search` 加载后直接调）/ `direct`（像内置工具一样声明）/ `hidden`（注册但不可达） | `docs/mcp.md:191-206` |
| 连带的自动启用 | 有 `codemode` / `deferred` 工具的 server 一连上，**自动激活 `codemode` / `tool_search`** | `src/extensions/mcp/index.ts:153` |
| 清单规模怎么交代 | 这些 server **不进工具清单**，只进系统提示词的一个 `mcp_servers` 段（一行摘要） | `docs/mcp.md:204` |
| resources（MCP 的另一类原语：可读的资源，不是"动作"） | 另造三个工具：`list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`（与 Codex / OpenCode 同形） | `docs/mcp.md:240-246` |
| 审批 | **不另造**：MCP 调用走既有的 `tool_call` / `tool_result` 门；server 自报的注解（`readOnlyHint` 这类"我只读"的自述）经 `pi.getAllTools()` **交给权限扩展**，**自己不下判断** | `docs/mcp.md:252-256` |
| 配置 | `~/.pi/agent/mcp.json`（用户级）+ `.pi/mcp.json`（项目级，**要先授予 project trust 才读**） | `docs/mcp.md:32` |
| 协议层 | **自研**，不用官方 SDK；协议版本 `2025-11-25`，兼容 `2025-06-18` / `2025-03-26` / `2024-11-05` | `packages/mcp/README.md:3,172` |
| 关掉它的两个开关 | `--no-mcp`（单次运行）、`"extensions": ["-builtin:mcp"]`（长期） | `docs/mcp.md:230,268` |

### 11.4 逐条复核 §5.5 的三条理由

| # | 当时的话 | 现在 |
|---|---|---|
| ① | pi 的替代方案靠"工具带 CLI + README 载体"（用 Skills 封装 CLI） | **失效** —— 那是"它为什么**不需要** MCP"的解释；它现在自己接了 |
| ② | 它的扩展模型不是更安全的边界（"Pi packages run with full system access."） | **仍成立**，与 MCP 无关 |
| ③ | 它明确**没有 permission popups**，而我们有 | ⚠️ **未核** —— 原句（`usage.md:310`）已改；现在 MCP 调用走扩展的 `tool_call`/`tool_result` 门（`docs/mcp.md:254`），但"内置到底有没有弹框"**我没读**。**别当依据用。** |

> ⚠️ 这一栏最值得记的不是结论，是**方法**：`pi.md` 导航卡上的"锚点"是 0.86.1，而检出已经 1.5.0 —— **参考项目会动，`file:line` 会烂**。这就是 §3.6 那条复核纪律的又一次实证。

### 11.5 对 C1 的四条影响

1. **反方论证消失**：C1 的第一依据里**再也不能引"pi 不做 MCP"**。理由回到原来那两条：七层对照表把 **T 层唯一的洞**标在这里 + 作品判据要求"**能力面不能有洞**"。
2. **结论没变，代价模型要改**：pi 在 `0.99.0` 里是**三件事一起**加的（codemode + tool_search + MCP）。这是"**接 MCP 不便宜**"最硬的证据，正好印证 §5.7② 的规模行 —— 也直接催生了 `6.9-11`。
3. **可抄项 +4**：`-`→`_` 归一（连 hash 后缀的理由一起）· **exposure 四档** · `.pi/mcp.json` + project trust 门禁 · **官方 conformance suite 当验收标准**。
4. **一个反向印证**：我们 `6.9-0` 倾向"自研"，pi 也自研，而且它还能跑官方一致性测试 ⇒ "**自研 ⇒ 不合规**"不成立。但这**不改** 6.9-0 的代价模型（分帧 / 超时 / 版本协商仍要自己写对）。

### 11.6 这次**没**做的（诚实边界，别当已核）

- 只读了 `docs/mcp.md` **全篇** + `CHANGELOG` 的相关条目 + `naming.ts` / `extensions/mcp/{tools,config,index}.ts` 的**片段**（grep 命中行）。
- **没通读** `packages/mcp/src/client.ts`（协议实现）与 `src/extensions/mcp/runtime.ts`（生命周期）⇒ **"连接是常驻还是按需"这条没核**，而它正是 `6.9-5` 的关键。下次要看就从 `runtime.ts` 进。
- `apps/p2/` 下那套 MCP（`plugins/mcp`、`docs/mcp-durable.md`）是**另一个应用（Durable 版 p2）**的活，**不是 pi 产品线的形态**，别拿来当依据。
