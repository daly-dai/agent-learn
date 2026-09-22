# C45 · ESLint + Prettier 接入

> **状态**：进行中（池子那一格是唯一的状态位，本文件不写状态）
> **起因**：2026-09-22 用户发现「我们项目没有语法检查和代码格式化」
> **参考**：同级项目 `E:\work-space\aI-admin-pro`（**抄它那套硬规则，不抄它的文件** —— 理由见 4.1）

---

## 一、需求（池子行原文）

> **ESLint + Prettier 接入**：现在提交前没有任何语法检查与代码格式化，全凭人眼看 —— 加静态检查 + 一键格式化，把 AGENTS.md 里那些"靠记性"的规矩（命名 / 分层 / 圈复杂度）变成"跑一下就报"。

---

## 二、依据（一手来源）

### 2.1 参考项目 ai-admin-pro（逐文件读过）

| 文件 | 读到的内容 |
|---|---|
| `eslint.config.mjs`（178 行） | flat config：`@eslint/js` + `typescript-eslint` + `react-hooks` + `react-refresh`；硬规则三组（Harness 硬约束 / 函数质量 / 扩展语义）；组件文件放宽复杂度 |
| `.prettierrc` | `singleQuote: true` + `printWidth: 80` + 三个插件（`@ianvs/prettier-plugin-sort-imports` / `prettier-plugin-packagejson` / `prettier-plugin-organize-imports`） |
| `.prettierignore` | 只有两行：`/dist`、`*.yaml` |
| `.husky/pre-commit` | `npx lint-staged` |
| `.husky/pre-push` | `pnpm type-check` |
| `package.json` | scripts：`lint` / `lint:fix` / `prettier` / `type-check` / `verify:raw`；`lint-staged`：`*.{ts,tsx}` → `eslint --fix` + `prettier --write` |

### 2.2 Next 16 官方（决定"路线"的那份）

`https://nextjs.org/docs/app/api-reference/config/eslint`（v16.3.5 文档）：

- **`next lint` 在 Next 16 已删除**，`next.config` 里的 `eslint` 选项一并移除 → 官方路线 = ESLint CLI + flat config。
- 推荐组合：`eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`。
- 与 Prettier 共存要靠 `eslint-config-prettier/flat`（关掉 ESLint 里的格式化规则，避免两个工具互相改）。
- `eslint-config-next@16.3.5` 的 peer 是 `eslint >=9.0.0` → **装 eslint 9，不装 10**。

### 2.3 本仓库自己的规矩（这些条款是本次要"变成机器检查"的对象）

- AGENTS.md 第 2 条：**函数小而单一**（>30 行就拆）
- AGENTS.md 第 5 条：**避免深层嵌套**
- AGENTS.md「环境与验证」：**`tsc` 绿 ≠ 没有垃圾** —— tsconfig 没开 `noUnusedLocals`，删代码后留下的死导入它一个字都不报
- AGENTS.md 第 10 条：状态只在池子那一格；本文件只放材料与设计

---

## 三、实测基线（2026-09-22，跑出来的不是估的）

环境：pnpm 10.34.4 / eslint 9.39.5 / prettier 3.9.8 / eslint-config-next 16.3.5 / eslint-config-prettier 10.1.8
代码规模：`app/` + `lib/` 共 **202** 个 ts/tsx/css 文件

### 3.1 Prettier 存量改动量

| 方案 | 会改动的文件 | 行数变化 |
|---|---|---|
| **双引号**（Prettier 默认，对齐现状） | **117 / 202** | 见下方修正 |
| 单引号（照抄 ai-admin-pro） | **200 / 202** | 再多 82 个纯引号翻转文件 |

**变化性质**（抽 3 个文件 diff 看过）：**双向的** —— 原代码有些地方把一行参数切成 3 行，Prettier 合回去；有些地方行超长（如 93 字符），Prettier 拆开。

> ⚠️ **2026-09-22 实测修正（原稿写反了方向）**：干净地量一次（`HEAD` 快照 vs 对 `HEAD` 跑过 prettier 的快照，131 个文件）→ **+1629 / −643，净「增」986 行**。也就是说 **Prettier 拆开的多于合回去的** —— 原代码里有大量超过 80 列的长行。原稿写成"净减少 986 行"是**把 diff 的 `-`/`+` 两侧读反了**（`git diff --no-index A B` 里 `-` 是 A、`+` 是 B）。**教训：方向这类结论不能靠眼看几行 diff 推，要有一个能报数的量法。**

### 3.2 ESLint 存量问题

| 配置 | 问题数 |
|---|---|
| 只用 Next 官方推荐 | **28**（7 error / 21 warning） |
| 抄上 ai-admin-pro 全套 | **354** |

按规则拆（并把"测试文件 / 源码"分开）：

| 规则 | 测试 | 源码 | 判断 |
|---|---|---|---|
| `id-length` | 137 | 111 | ⚠️ **噪音**：源码里几乎全是 `catch (e)` / `(e) => {}` / `(a, b) =>` 这类惯用短名，不是 AGENTS.md 第 3 条禁的 `a/tmp/x1` |
| `complexity` | 0 | 28 | ⚠️ 阈值 10 会让**红线文件**必须改，且查表型函数精度差 → 见 4.1 |
| `@typescript-eslint/no-unused-vars` | 8 | 13 | ⭐ **21 处真金**：正是 AGENTS.md 写明的那个洞（tsc 查不出的死代码） |
| `max-params` | 1 | 15 | ✅ 对得上第 2 条 |
| `@typescript-eslint/consistent-type-imports` | 3 | 12 | ✅ 整洁 |
| `max-depth` | 0 | 7 | ✅ 对得上第 5 条 |
| `consistent-return` | 0 | 6 | ✅ 防 bug |
| `no-nested-ternary` | 0 | 3 | ✅ 防 bug |
| `no-require-imports` / `no-use-before-define` / `no-promise-executor-return` | 3 | 2 | ✅ |
| **`no-explicit-any` / `eqeqeq` / `no-var`** | **0** | **0** | 听着吓人，我们**一条没犯** |

### 3.3 红线检查（动手前必查）

- `lib/agent/index.ts` **不在** Prettier 的 117 个改动文件里（它已经是格式化干净的）→ **全库格式化不触发红线**
- 但 `complexity @ 10` **会打在 `runAgentLoop` 上**（复杂度 11）→ 若保持 10，为了一条 lint 规则就得动 agent 内核 → **本末倒置**，见 4.1

---

## 四、详细设计

### 4.1 为什么不能照抄 ai-admin-pro（三条，都是实测得出）

**① 框架不同。** ai-admin-pro 是 rsbuild（无 Next 插件），我们是 Next 16 —— `next lint` 已被官方删除。抄的是**它那套硬规则**，配置骨架必须按 Next 官方路线搭。

**② `id-length` 在我们这儿 70% 是噪音。** 248 条里绝大多数是 `catch (e)`。这条规则长在 antd 业务后台里可能合适，在这里它惩罚的是**惯用写法**，不是坏命名。**不抄。**（AGENTS.md 第 3 条"禁 `a`/`tmp`/`x1`"是**意图**，`id-length` 的**实现**抓不准这个意图 —— 这是"规则该有的形态"的反面教材。）

**③ `complexity` 阈值 10 精度不够 + 会撞红线。** 实测 28 处里，最高的两个是**查表型**函数：

| 函数 | 复杂度 | 性质 |
|---|---|---|
| `classifyIpv4` | 32 | SSRF 防护的 IP 分类：每个分支 = 一种输入格式 |
| `measureTagDepth` | 24 | HTML 标签深度测量：同一个解析器的状态分支 |
| `parseIpv6` / `classifyIpv6` | 17 / 16 | 同上 |
| `runAgentLoop` | 11 | ⚠️ **红线文件** |

把 32 拆成 4 个 8，读的人还得在 4 个函数之间跳 —— **拆开反而更难读**。所以阈值放宽到 **15**（`.tsx` 20，JSX 条件渲染天然多分支）。放宽后 `runAgentLoop`(11) 自然通过，**红线一个字不用动**。

### 4.2 拍板记录（2026-09-22 用户逐条确认）

| 决定 | 选项 | 为什么选它 |
|---|---|---|
| **引号基线** | **双引号**（对齐现状） | 存量代码本来全是双引号；照抄单引号要多吃 82 个纯引号翻转文件，是纯粹的无意义 diff |
| **规则严格度** | **中等**：去掉 `id-length`，保留其余 | 留下的都是"能指出真问题"的规则（21 处死代码 + 函数质量 + 防 bug） |
| **`complexity` 阈值** | **15**（`.tsx` 20） | 查表函数豁免；红线不受影响（见 4.1③） |
| **git 钩子** | **装** husky + lint-staged，pre-commit 只跑暂存文件 | 规矩不靠记性；不碰没改的文件 |

### 4.2.1 清理过程中才浮现的三条 —— **由 AI 代拍，用户可推翻**

下面三条是**跑到一半才从数据里冒出来的**，不是最初那张表能预见的。2026-09-22 请示时**用户取消了提问**（未表态），故按当时给出的推荐值执行，理由如实记在这里：

| 决定 | 选了 | 为什么 | 代价 / 风险 |
|---|---|---|---|
| `consistent-return` 6 处 | **改代码**：`if (!open) return;` → `return undefined;` | 6/6 都是 React effect 的"有 cleanup / 无 cleanup"两分支。规则分不出 `undefined` 与"不返回"，但对 React 二者等价 —— 所以是**规则的语义盲区**，不是代码问题。改 6 个字即可让规则继续管其余 200 个函数，比关掉整条规则划算 | 6 处纯字面改动，零语义变化 |
| react-hooks v7 的 5 处（`set-state-in-effect` ×4 / `refs` ×1） | **本轮带理由 `eslint-disable` 豁免 + 开池子行 C46** | 这 5 处是**真问题**（React 官方「You Might Not Need an Effect」那一类），但修法是"改 hook/组件的状态模型"（派生值化），**会改行为、需真机验收** —— 不该混在"接入工具"这一批里悄悄改 | 5 条 `eslint-disable` 带着理由注释；**债记在 `PLAN.md` 的 C46**，删掉豁免即可复现 |
| `max-params` 16 处（14×4 参 / 2×5 参） | **全改成单个 options 对象** | 本仓库已有这个风格（`createRequestContext(params)`）；调用点从位置参数变具名参数，可读性真的变好 —— 不是为规则而规则 | 动 16 个函数签名 + 全部调用点，含内核文件 `deepseekModel` / `TraceRecorder`。**判据：单测失败集合必须与基线完全相同** |

### 4.2.2 一条规则之外的发现：`eslint-config-next` 带进了 react-hooks v7

按规则名分组统计时**看不出来** —— 它们混在"未归类"的 5 条里。这正是"**先跑一遍再下结论**"的价值：只按自己脑中的规则清单推演，这两个规则根本不会进入视野。

- `react-hooks/set-state-in-effect`（4 处）：effect 体内同步 `setState` → 级联渲染
- `react-hooks/refs`（1 处）：渲染期读 `ref.current`

它们**不在 ai-admin-pro 那套里**（那边是 rsbuild + 自己配 `eslint-plugin-react-hooks@7`），是 Next 官方 `core-web-vitals` 一并带进来的。**下一代 React（Compiler）的护栏，比老板块严**。


### 4.3 交付物清单

| 文件 | 干什么 | 关键设计 |
|---|---|---|
| `eslint.config.mjs` | ESLint flat config | 结构：`globalIgnores` → `...nextVitals` → `...nextTs` → **硬规则块** → `.tsx` 放宽 → `prettier`（必须最后，用来关掉格式化类规则） |
| `.prettierrc` | 格式化基线 | `singleQuote: false` **显式写死** —— 默认值也要写，防止后人"顺手"翻成单引号（这个决定花了 82 个文件的代价换来） |
| `.prettierignore` | 排除不该格式化的东西 | **`*.md` 全排除**：Prettier 的 markdown 会重排表格，而池子表是 `check-plan.mjs` 的解析对象；几十份文档的表格式重排没有任何收益 |
| `package.json` | scripts + `lint-staged` 配置 | 新增 `lint` / `lint:fix` / `format` / `format:check` / `type-check` / `prepare` |
| `.husky/pre-commit` | 提交门 | `npx lint-staged` —— 只对暂存文件跑，不碰没改的 |

**明确不加的三个插件**（ai-admin-pro 有，我们这次不要）：`@ianvs/prettier-plugin-sort-imports` / `prettier-plugin-organize-imports` / `prettier-plugin-packagejson`。理由：它们管的是**import 排序**，属于独立议题（会额外改一大片 import 顺序），跟"有没有语法检查"是两件事 —— 混在一起做，diff 就没法审了。若要，单开一项。

### 4.4 存量清理策略（顺序不能反）

```
① 装齐依赖（eslint / prettier / husky / lint-staged）
② eslint --fix        —— 机械可修的（consistent-type-imports 等）
③ 手改剩余            —— 21 处死代码（删）+ 5 处函数质量
④ prettier --write    —— 必须排在 eslint --fix 之后，否则 eslint 改完又不是 prettier 格式了
⑤ 全量验证            —— tsc 0 + vitest 全绿 + eslint 0 + prettier --check 0
```

⚠️ **③ 的 4 处查表函数用带理由的 `eslint-disable-next-line complexity` 豁免**，注释必须写清"为什么拆开更难读"—— 豁免要能指回 4.1③，不能变成静默放过。

### 4.5 提交切分（两次，别混）

| commit | 内容 | 为什么分开 |
|---|---|---|
| 1 | 配置文件 + scripts + 存量修复 | 这是"引入工具"本身，能读懂 |
| 2 | `prettier --write` 的纯格式化（117 文件） | 纯机械、语义零变化 —— **单独一个 commit 才审得动**；混进功能改动就再也分不出来了 |

---

## 五、验收（怎么算做完）

| # | 判据 | 怎么查 |
|---|---|---|
| 1 | `pnpm lint` 退出码 0，**0 error 0 warning** | `pnpm lint; $LASTEXITCODE` |
| 2 | `pnpm format:check` 退出码 0（全库已格式化） | 同上 |
| 3 | `pnpm type-check` 退出码 0 | `node node_modules/typescript/bin/tsc --noEmit` |
| 4 | **单测全绿**（格式化不能改语义） | `node node_modules/vitest/vitest.mjs run --pool=threads` |
| 5 | 21 处死代码**真的删掉了**（不是 disable 掉的） | 修完 `no-unused-vars` 应报 0，且 `git diff` 里能看到对应删除 |
| 6 | **红线文件零改动** | `git diff --name-only \| Select-String 'lib/agent/index.ts'` 应为空 |
| 7 | 4 处查表函数的豁免**带理由注释** | 打开那 4 个文件，`eslint-disable-next-line complexity` 上一行必须有"为什么" |
| 8 | 钩子真的挡得住 | 故意提交一个格式错的文件（如多两个空格）→ 提交被 lint-staged 修正/拦下 |
| 9 | `pnpm dev` 仍能起、页面不变 | 用户浏览器跑（沙箱起不了常驻 dev server） |

## 六、⚠️ 缺什么才能定案

**已定案**（详细设计 + 验收 齐）。剩余未定项只有一条，不影响开工：

- **import 排序插件**（4.3 末）要不要跟 —— 本项**明确不做**，若要单开一池子行。

---

## 七、施工记录（2026-09-22）

### 7.1 数字：354 → 0

| 阶段 | 剩余违规 | 怎么降的 |
|---|---|---|
| 接入前基线 | **354** | — |
| `eslint --fix` | 71 | 机械可修的（`consistent-type-imports` 等）自动改掉 |
| 零风险批 | 43 | 20 处死导入/死变量 + 2 类型导入 + 2 声明顺序 + 1 promise-executor + 3 嵌套三元 |
| 判断题批 | 14 | `consistent-return` 6（改 `return undefined`）+ react-hooks 5（带理由豁免）+ require 2 |
| 重构批 | **0** | `max-params` 16（改对象参数）+ `max-depth` 7（压平）+ `complexity` 6（2 拆 + 4 豁免）|

**最终验证**（2026-09-22）：

| 判据 | 结果 |
|---|---|
| `eslint .` | **退出码 0**，192 文件，0 error 0 warning |
| `tsc --noEmit` | **退出码 0** |
| `prettier --check` | **退出码 0**（124 个文件已格式化） |
| `vitest` | 748 用例 / **743 passed / 5 failed** —— 5 个全在 `app/api/repos/_lib/git/index.test.ts`，全是 `spawnSync git EPERM`（**沙箱边界，与本次改动无关**；需提权或真机重跑） |
| **红线文件** | `git status --porcelain -- lib/agent/index.ts` **为空** |

### 7.1.1 改动量分解（2026-09-22 实测，回答「加个配置到底动了多少代码」）

方法：拿 `HEAD` 快照 → **对它单独跑一遍 prettier** → 和工作区比。两者逐字相同的文件 = **纯格式化**；不同的才含真实代码改动。

| 层 | 量 | 说明 |
|---|---|---|
| **纯格式化**（语义零变化） | 73 个代码文件 | 全部格式化的行数效果 = **+1629 / −643**（净 +986，见 3.1 的修正） |
| **真实代码改动 · 琐碎** | 29 个文件 | 每文件 ≤6 行 —— 基本都是 `import type` 拆分 / 删死导入 |
| **真实代码改动 · 实质** | 28 个文件 | 合计 **+769 / −537** —— `max-params` 改对象参数 / 拆函数 / 压平嵌套。最大三处：`deepseekModel` 257 行、`session-row.tsx` 192 行、`skill/index.test.ts` 132 行 |
| **依赖锁文件** | 1 个 | `pnpm-lock.yaml` **+3252 / −74** —— 装 4 个包引起，**比所有代码改动加起来还大** |
| **配置 + 文档** | 6 个 | `eslint.config.mjs` / `.prettierrc` / `.prettierignore` / `pnpm-workspace.yaml` / `package.json`(+19/−1) / 本详案 |

**合计** `git diff --stat` = 137 文件 / **+5793 / −1244**，拆开看：

```
锁文件          ████████████████████████████  56%
纯格式化        ██████████████                28%
真实代码改动    ██████                        13%
文档 / 配置     █                             3%
```

**结论：真实代码改动 ≈ 13%（+769/−537），且其中一半文件是 1–2 行的 import 调整。** 其余全是"一次性"的：锁文件（装包必然）+ 格式化（全库统一格式的必然代价）。

⚠️ 另外：`doc/开源项目导航手册/pi.md`(+164/−35) 等文档改动**不属于 C45** —— 那是本次会话开始前工作树里就有的未提交内容，别混进这一笔。
### 7.2 偏离详细设计的地方（**逐条留档，这是复盘材料**）

| # | 原设计 | 实际 | 为什么 |
|---|---|---|---|
| ① | 豁免注释写成两行（`--` 后半句换行） | **单行** directive | **实测两行不生效**：`eslint-disable-next-line` 绑的是紧随的**物理行**，第二条 `//` 续行把它吃掉了 → 报 `Unused eslint-disable directive` 且 error 仍在。措辞、`--` 理由、doc 引用全部保留 |
| ② | （未预见）`consistent-return` | 6 处改 `return undefined;` | 见 4.2.1 |
| ③ | （未预见）react-hooks v7 | 5 处豁免 + 池子 **C46** | 见 4.2.1 / 4.2.2 |
| ④ | `max-params` "全改" | 16 个函数全部改对象参数 | 见 4.2.1；调用点含内核 `deepseekModel` / `TraceRecorder`，**参数错位风险已逐个核对**（`postChatCompletion` 两处 `stream: false/true` 是最易调换的一处，已单独确认） |
| ⑤ | `max-depth` 一律用 guard clause | **`lib/deepseekModel` L248/252 例外** | 结构上做不到：`max-depth` 把 `TryStatement` 也算一层 ⇒ `try > while > while > if` 天然是 4 层。拆 `try` 会改变"哪些错误算流式中断"、拆内层 `while` 等于搬运逻辑 —— 两者都越线。**改用"让那一层没有 `if`"**（`line.startsWith("data:") ? parseSseData(...) : null` 交给容忍 `null` 的具名函数，正是 `complexity` 那批要抽的同一个函数） |
| ⑥ | （未预见）`lib/summarize` 分支顺序 | user→摘要→工具结果→assistant | 为了让 assistant 分支落到循环体顶层（否则内层 `for` 还是 depth 3）。**四种角色互斥、输出由单次顺序遍历产出 ⇒ 逐字相同**，该函数有测试覆盖且全绿 |
| ⑦ | （未预见）`fetcher` 增加一个具名判据 | `isRedirectWithoutLocation(response)` | 纯 `&&` 式 guard 会把 `fetchUrl` 复杂度从 ≤15 顶到 **17**（实测）；提成名字后回落到阈值内，三种输入行为逐条对比一致 |

### 7.3 两个环境发现（都不在计划内）

- **`.tmp_pdf/` 挡住 `prettier .`**：上一次会话用 Python 处理 `pi-web.pdf` 留下的 pip 临时目录（未跟踪、ACL 坏掉、连 `git status` 都读不了）。⚠️ **`prettier` 展开目录时不看 `.prettierignore`**（先 walk 再过滤）⇒ `pnpm format`（=`prettier .`）会 EPERM。**待办：删掉 `.tmp_pdf/`**。ESLint 不受影响（flat config 的 `globalIgnores` 会在遍历前剪枝 —— 这个差异本身就值得记）。
- **`pnpm-workspace.yaml` 是安装时自动生成的**（内容 `allowBuilds: unrs-resolver: true`）：eslint 链上的原生依赖要跑构建脚本。**该提交**，否则别人 `pnpm install` 会被拦。
- **沙箱跑不了 vitest**：vite 加载配置时 `exec("net use")` 撞管道 EPERM。**真机（或提权）重跑一次才算数**。

### 7.4 遗留

- **husky + lint-staged 还没装**（需在工作区外写 pnpm store → 由用户安装）。装完后要补：① `package.json` 的 `"prepare": "husky"` ② `.husky/pre-commit`（内容 `npx lint-staged`）③ 验收第 ⑧ 条（故意提交格式错的文件，看是否被拦）。
- **验收第 ④ / ⑨ 条未在真机跑过**（单测绿 / 浏览器页面不变）—— 需用户执行。
- **C46** 就是这次豁免出去的债，已在池子里。

---

## 八、交付补记（2026-09-22 收口）

### 8.1 7.4 那条遗留已落地

husky 9.1.7 + lint-staged 17.5.1 已装；`package.json` 补了 `"prepare": "husky"`；`.husky/pre-commit` 已写好（`pnpm exec lint-staged`）。**用 `pnpm exec` 而不是 `npx`**：本项目是 pnpm 单包管理器，`pnpm exec` 直接解析本地 bin，不会像 `npx` 那样在找不到时尝试联网下载。

### 8.2 收口时的验收实况（**先写过一版"未验"，随后环境变了，补验后改写**）

收口当时本会话的沙箱是 `workspace-write`：**Node 起不了任何子进程**（`node -e "execSync('git --version')"` → `EPERM spawnSync C:\Windows\system32\cmd.exe`），husky 初始化与 lint-staged 都跑不了。于是先把钩子线路接好、把 ④⑧⑨ 记成"未验"。

**随后会话策略变成 `danger-full-access`，EPERM 全部消失** ⇒ 三项当场补验：

| 验收 # | 结果 | 证据 |
|---|---|---|
| ① `pnpm lint` | ✅ **退出码 0** | 用**真脚本**跑（`eslint .`，192 文件，0/0） |
| ② `pnpm format:check` | ✅ **退出码 0** | 真脚本；`All matched files use Prettier code style!`（`.tmp_pdf` 那次 EPERM 同样是沙箱假象，不是 ACL 问题） |
| ③ `pnpm type-check` | ✅ **退出码 0** | 真脚本 |
| ④ **单测全绿** | ✅ **748 / 748 passed（56 文件全过）** | `node node_modules/vitest/vitest.mjs run --pool=threads`，**不需要任何 shim**。⚠️ 之前那 5 个 `spawnSync git EPERM` **确认是沙箱假红**，不是真失败 —— 这条教训已回写进 `AGENTS.md` 的环境与验证节 |
| ⑤ 死代码真删掉 | ✅ | `no-unused-vars` 归零（20 处删除 + 1 处 `ignoreRestSiblings`） |
| ⑥ **红线零改动** | ✅ | `git status --porcelain -- lib/agent/index.ts` 为空（全程巡检多次） |
| ⑦ 豁免带理由 | ✅ | 4 处查表函数各一行 `eslint-disable-next-line complexity -- 查表型：…`，且 eslint 报 0 warning ⇒ 注释真的生效（不是"Unused directive"） |
| ⑧ **钩子实测挡得住** | ✅ **两侧都验了** | 测试 A：`pnpm exec lint-staged` 把 `const  spaced   =   1;` 自动改成 `const spaced = 1;` 并**重新暂存**；测试 B：塞一个未使用变量后 `git commit` **退出码 1、HEAD 未变**，报 `'unusedThing' is assigned a value but never used` + `husky - pre-commit script failed (code 1)` |
| ⑨ `pnpm dev` 页面不变 | ⚠️ **冒烟验过，人工没点** | `pnpm dev` 起来后 `GET /` **200**（17KB，含 `statve`/`__next`/`<html>`）、`GET /repos` **200**（13.8KB）、`GET /api/sessions` **200**（3.9KB），dev 日志 `✓ Ready in 4.6s` 且**无任何报错**。**但"用鼠标把改动过的交互点一遍"没做**（用户 2026-09-22 明确表示不做真机） |

**唯一诚实的缺口**：⑨ 的**人工交互那一层**。本次含 28 个函数的实质重构（`max-params` / 拆函数 / 压平嵌套），其中 `decideToolCall`（审批决策树）、`session-row.tsx`（会话行渲染）、`use-command-menu` 相关路径的**行为等价性**靠 `tsc` + 748 条用例 + 页面 200 三点支撑，**没有第四道人工验证**。

### 8.3 顺带撞出的两条环境知识（已回写 `AGENTS.md`）

1. **受限模式下的子进程 EPERM 会伪装成"测试失败"** —— 5 个 git 用例红了，看着像代码问题，实为沙箱；换 `danger-full-access` 立刻 748/748。
2. **DSH 自带的 pnpm 是 11、而本仓库 `node_modules` 是 pnpm 10 装的** —— 直接 `pnpm <script>` 会撞 `runDepsStatusCheck` / `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`（**不是脚本坏了**）。正解：`& 'C:\Users\25082\AppData\Local\pnpm\pnpm.CMD' <script>`。

### 8.4 收口读数

- `pnpm lint` / `pnpm format:check` / `pnpm type-check` **三个真脚本退出码全 0** · `check-plan` **0**
- **红线 `lib/agent/index.ts` 零改动**
- 池子：`C45 → 已交付`（ID 保留）；豁免出去的债 = **C46**（`未开始`）
- 本批改动量拆解见 7.1.1：**真实代码改动只占 13%**，锁文件 56%、纯格式化 28%


### 8.4 下次做同类事的三条经验（都给过代价）

1. **先跑基线，再谈方案** —— "照抄参考项目"这个默认动作，在工具配置上会被数据推翻（`id-length` 248 条噪音、`complexity` 撞红线）。
2. **格式化要单独一步提交** —— 本次是先跑 prettier 再一起提交，结果 124 个文件的机械 diff 和 28 个函数的实质重构**混成一个 commit，审不动了**。正确顺序：先 commit「配置 + 存量修复」，再单独跑 `prettier --write` 提交。
3. **方向性结论要有"能报数的量法"** —— "净增还是净减"这类判断，眼看几行 diff 就会读反（本次真的读反了）。


