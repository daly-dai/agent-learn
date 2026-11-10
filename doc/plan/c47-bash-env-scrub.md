# C47 · bash 子进程继承父进程全部环境变量

> **这是「攒材料」阶段的需求文件**（`AGENTS.md` 第 10 条 ②）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 C47 行（2026-09-22 入池）+ 2026-09-22 实读我们自己的代码 + **2026-10-08 直读官方 MCP 客户端包**（新增的一条对照）。
> ⚠️ **详细设计与验收都还没写**（四 / 五 各自标着 ⛔）—— **按门禁，没定案就不许开工。**

---

## 一、需求（池子行原文）

**`bash` 子进程继承父进程全部环境变量** —— 模型一条 `echo $env:DEEPSEEK_API_KEY` 就能把你的 key 读走（**既有暴露，非 C1 引入**）：是否清洗、清洗到什么程度

（池子行的「依据」原文：2026-09-22 实读 `lib/tools/bash/bash-runner/index.ts:105-115`（`bashProcessEnv` 把 `...base` 原样展开，**一个都不删**，只加了 NO_COLOR / TERM / PAGER / GIT_PAGER）+ `lib/config/index.ts:119`（key 从 `process.env` 读）+ 本机实测 `.env.local` 含该键；对照 **DSH `scrubbedParentEnv`**（删掉名字含 KEY / PASSWORD / SECRET / TOKEN 的变量 —— `doc/plan/c1-mcp.md` 5.6 有 file:line）。）

## 二、依据（跟谁学 / 触发条件）

### 2.1 我们现在的行为（2026-09-22 实读，三条都带位置）

- `lib/tools/bash/bash-runner/index.ts:105-115`：`bashProcessEnv` 把 `...base`（= 父进程环境）**原样展开**，一个都不删，只**追加** `NO_COLOR` / `TERM` / `PAGER` / `GIT_PAGER`。
- `lib/config/index.ts:119`：`DEEPSEEK_API_KEY` 从 `process.env` 读 ⇒ **它就在父进程环境里**。
- 本机实测：`.env.local` 含该键。

⇒ **模型只要跑一条 `echo $env:DEEPSEEK_API_KEY`**（只读命令，按现有策略**免审批**）**就能把 key 原样打印进上下文**。这条与 MCP 无关，是**既有**暴露。

### 2.2 两条一手对照 —— 两种相反的哲学

| | 机制 | 哲学 | 出处 |
|---|---|---|---|
| **DSH** | `scrubbedParentEnv()`：**删掉**名字匹配 `/KEY\|PASSWORD\|SECRET\|TOKEN/i` 的变量 + 所有 `DSH_*`，再叠显式 env | **黑名单**（列举"要删的"） | DSH `packages/mcp/mcp-client/src/transport.ts:21-23` · `packages/subprocess/.../index.ts:47,66`（转引 `doc/plan/c1-mcp.md` 5.6） |
| **官方 `@modelcontextprotocol/client@2.0.0`** | `getDefaultEnvironment()` / `DEFAULT_INHERITED_ENV_VARS`：**只继承"被认为安全"的变量** | **白名单**（列举"要留的"） | 2026-10-08 直读 `dist/stdio.d.mts:42-48`，原文 "only environment variables deemed safe to inherit"（读法与证据见 `doc/plan/c1-mcp.md` 的 **6.9-0a**） |

⚠️ **两条都不完整，而且缺的方式相反**：

- **黑名单**漏的是"**名字不像秘密的秘密**"（自定义变量名、base64 进去的凭据…）。
- **白名单**漏的是"**确实需要传下去的变量**"（代理 / 证书路径 / 语言环境…），而且**清单是别人的，会随包版本漂** —— 升级就可能悄悄少传一个。

## 三、待拍板

1. **清洗到什么程度**：全量继承（现状）/ 黑名单 / 白名单 / **白名单 + 允许显式加白**？
2. **清洗只作用于 `bash`，还是所有"我们起子进程"的地方**？（⚠️ MCP 的 stdio 传输也起子进程 —— 若 C1 走 **A / C** 路线，那个 spawner 也归我们写 ⇒ 同一套清洗要能复用；若走 B，spawn 归官方包，它默认用白名单。）
3. **要不要给模型一条"我需要某个变量"的正式通道**？不给的话，清单外的需求会退化成"改代码"。

## 四、详细设计

⛔ **未定案** —— 本节尚未成文。按 `PLAN.md` 的门禁（依据 · 详案 · 验收 三格齐，且本文件里要真写出「详细设计」+「验收」两节）**不许开工**。

## 五、验收

⛔ **未定案**（定案后再写）。

## 六、⚠️ 缺什么才能定案

- [ ] 上面「三」的三条待拍板要有答案。
- [ ] ⚠️ **先确认"我们到底在防谁"** —— 防"**模型无意间把 key 读进上下文**"（那黑名单够用，成本低），还是防"**远端 MCP server 想偷**"（那是另一层，且 MCP 侧本来就是我们显式给 `env`）？**目标不同，方案不同**；不先回答这个，方案就是凭感觉选的。
- [ ] 需要一条实测：**清洗之后哪些合法命令会坏**（依赖 `PATH` / `HOME` / 代理变量的命令）—— 这条决定白名单可不可行，也是「知道它什么时候会失败」要写进验收的东西。
