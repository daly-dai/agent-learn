# C15 详案：开源仓库更新面板（repo updater）—— 手动点击更新 + LLM 总结变更

> 2026-08-31 创建（用户提：参考项目按天迭代，每次都不知道更新了啥、要一个个手动 pull——
> 想要"手动点击更新 → 自动 pull 指定开源项目 → 总结最近更新 → 标注哪些值得重点看"）
> 状态：⏳ 排队（2026-08-31 三个决策已拍板：① 只做 3 个 git 仓库 ② 总结粒度按推荐（全量增量）③ 落盘到 `workspace/`）

## 功能描述

观测台里加一个「仓库更新」页面（`/repos`）：列出 `E:\agents-read\` 下的参考项目，
**手动点击某个项目的更新按钮** → 后端自动 `git fetch` + `git pull` → 用 LLM 总结
"上次更新到这次更新之间的变更"（新功能 / 修复 / 重构 / 文档）+ **标注哪些是本项目
值得重点看的**（学习价值 + 使用价值，结合导航手册"我们拿走什么"）→ 结果展示在页面。
基线记录在 `.repo-updates/<项目>.json`，下次更新只总结新增部分（增量，不重复总结）。

用户痛点：参考项目按天迭代，手动 pull 麻烦、pull 完不知道变了啥、更不知道哪些值得学。
本功能 = 「一键更新 + 变更雷达」——把"维护参考仓库"从体力活变成"顺手看更新摘要"。

## 已定决策（2026-08-31 用户拍板）

1. **方案 B：独立路由页 `/repos`**（不塞进现有单页三栏）——新页面练习（本项目第一个
   多路由页，App Router 天然支持），不碰 `app/page.tsx` 现有布局，风险最小
2. **复用现有模型管道**：总结走 `selectModel()` → `model.complete()`（B2 `generateSummary`
   同款模式），不另起炉灶；MOCK 模式/无 key 时降级（总结区显示"未配置 API key，跳过总结"）
3. **git 操作用 child_process spawn**（参数数组形式，防注入）；仓库路径白名单来自
   `config.ts`，不接受用户传路径

## 参考实现（本地可对照）

| 参考 | 文件 | 机制 |
|---|---|---|
| **git 本身** | 无（标准 CLI） | `fetch`（拿远端引用，不动工作区）→ `log HEAD..origin/<branch>`（新增 commit）→ `pull --ff-only`（快进合并） |
| **本项目 B2** | `lib/summarize.ts` | `selectModel()` + `model.complete()` + fail-soft（失败返回 null 降级）——总结管道照搬这个模式 |
| **本项目导航手册** | `doc/开源项目导航手册/index.md` | 每个项目"我们拿走什么"列——作为总结 prompt 的"关注点"输入（模型知道这个项目哪块对我们有价值） |
| **本项目 session 模式** | `lib/session/` + `app/api/sessions/route.ts` + `app/services/sessions/` | 存储逻辑在 lib、路由薄、客户端 services 层——repo updater 同构 |

## 实施方案（seam 设计，11.5 ①）

```
/repos 页面（前端表格 + 更新按钮）
  → app/services/repos/（客户端调用层，仿 sessions）
    → app/api/repos/route.ts（GET 列表 / POST 更新）
      → lib/repos/（核心逻辑，可单测）
        ├── registry.ts  仓库清单（名字/路径/分支/非 git 标记）
        ├── git.ts       git 命令薄封装（execFile + 参数数组）
        ├── baseline.ts  基线读写（.repo-updates/<项目>.json）
        └── summarize.ts 变更总结（selectModel + prompt + fail-soft）
```

### seam 1：`lib/repos/registry.ts` —— 仓库清单（纯数据，可单测 ✅）

```ts
export type RepoEntry = {
  /** 显示名（如 "pi"） */
  name: string;
  /** 绝对路径（E:\agents-read\pi） */
  path: string;
  /** 是否 git 仓库（4 个 zip 解压的是 false） */
  isGit: boolean;
  /** 主分支名（git 仓库才有）：pi/codex=main，deepseek-harness=master */
  branch?: string;
};

export const REPOS: RepoEntry[] = [
  { name: "pi",               path: "E:\\agents-read\\pi",               isGit: true,  branch: "main" },
  { name: "codex",            path: "E:\\agents-read\\codex",            isGit: true,  branch: "main" },
  { name: "deepseek-harness", path: "E:\\agents-read\\deepseek-harness", isGit: true,  branch: "master" },
  { name: "smolagents",       path: "E:\\agents-read\\smolagents-main",  isGit: false },
  { name: "DeepSeek-Reasonix",path: "E:\\agents-read\\DeepSeek-Reasonix-main-v2", isGit: false },
  { name: "CodeWhale",        path: "E:\\agents-read\\CodeWhale-main",   isGit: false },
  { name: "Survey",           path: "E:\\agents-read\\Agent-Harness-Survey-ZH-main", isGit: false },
];
```

> **分支是数据不是探测（2026-08-31 用户拍板）**：最初实现用 `getCurrentBranch`
> 运行时探测（每次调 git 命令问"你在哪个分支"）。用户纠正：命令序列应固定，
> 只有主分支可能不同——分支是已知数据，写进 registry 即可。删掉探测，
> 命令固定为 fetch → log → pull 三个模板，分支作参数传入。

### seam 2：`lib/repos/git.ts` —— git 命令封装（薄，可单测 ✅）

```ts
/** 执行 git 命令（-C 指定仓库路径，参数数组防注入）。返回 { stdout, exitCode } */
export async function runGit(repoPath: string, args: string[]): Promise<GitResult>
/** 当前 HEAD 完整 commit（写基线用） */
export async function getHeadCommit(repoPath: string): Promise<string>
/** fetch 远端（origin/<branch> 引用更新，不动工作区） */
export async function fetchRemote(repoPath: string): Promise<void>
/** 新增 commit 列表（git log <base>..origin/<branch> --oneline --no-merges；
 *  有基线增量、无基线取最近 N 条） */
export async function getNewCommits(repoPath: string, branch: string, base?: string): Promise<string[]>
/** 快进合并（git pull --ff-only origin <branch>；有本地提交则失败，报错给用户） */
export async function fastForward(repoPath: string, branch: string): Promise<void>
```

- 每个函数只做一件事（AGENTS.md 2）；`runGit` 是唯一碰 child_process 的地方
- **为什么 fetch 和 pull 分开**（教学点）：fetch 只更新 remote-tracking 引用（`origin/main`），
  不碰工作区；pull = fetch + merge。先 fetch → 看 `HEAD..origin/<branch>` 有没有新东西 →
  有才 pull——避免"无脑 pull 但不知道变了啥"。**pull 用 `--ff-only`**：参考仓库不该有本地提交，
  有本地提交时 ff-only 会失败，正好提醒用户"这个仓库被我改过，别乱 pull"（防丢改动）

### seam 3：`lib/repos/baseline.ts` —— 基线记录（纯 fs，可单测 ✅）

```ts
/** .repo-updates/<name>.json：{ lastKnownCommit, updatedAt } —— 机器用，gitignore */
export async function readBaseline(repoName: string): Promise<Baseline | null>
export async function writeBaseline(repoName: string, commit: string): Promise<void>
```

- **增量思想（教学点）**：基线存"上次更新到的 commit"，下次 `git log <基线>..origin/<branch>`
  只取新增的——重复点击不重复总结。没有基线时用 `git log -n 20`（首刷给最近 20 条）
- 目录 `.repo-updates/` 加入 `.gitignore`（工作区自己的 git 不管它）

### seam 4：`lib/repos/summarize.ts` —— 变更总结（复用 selectModel）

```ts
export type UpdateSummary = {
  /** LLM 生成的总结文本（markdown） */
  text: string;
  /** 是否降级（无 key / 调用失败 → text 为空，前端显示"跳过总结"） */
  degraded: boolean;
};

/** 输入：仓库名 + 新增 commit 列表（可能含详细 log）→ 输出：结构化总结 */
export async function summarizeUpdate(
  repoName: string,
  commits: string[],
  signal?: AbortSignal,
): Promise<UpdateSummary>

/** 总结落盘到 workspace/更新日志-<日期>-<项目>.md（人看，不进 git） */
export async function saveUpdateLog(
  repoName: string,
  summary: UpdateSummary,
  commits: string[],
): Promise<string /* 落盘路径 */>
```

- **prompt 设计（教学点）**：
  - 输入 = `git log` 原文（commit 列表，可选 `--stat` 带文件改动）+ 导航手册里该项目的
    "我们拿走什么"（作为关注点提示）
  - 输出格式（结构化，让模型按这个写）：
    ```
    ## 更新概览（一句：这轮更新主题）
    ### 新功能 / ### 修复 / ### 重构 / ### 文档与杂项（按实际分节，没有的省略）
    ## 重点标注（⭐ 值得重点看：结合本项目"我们拿走什么"，说明学习价值/使用价值）
    ```
- 复用管道（不是抄代码）：照 `lib/summarize.ts` 的模式——`selectModel()` 拿 model →
  `model.complete({ systemPrompt, messages, tools: [] })` → 失败/中止返回 degraded（fail-soft）
- 超长 commit 列表截断（几十条以上只取最近 N 条 + 提示"共 X 条，展示前 N 条"），防止撑爆请求
- 总结生成后落盘 `workspace/更新日志-<日期>-<项目>.md`（人看的临时材料，不进 git，
  与走读笔记同定位）——页面展示同一份文本；落盘失败不阻塞（记 warning 即可）

### seam 5：`app/api/repos/route.ts` —— 两个接口（薄路由，仿 sessions）

```ts
GET  /api/repos
  → { repos: [{ name, isGit, branch?, behind? }] }   // 列表 + 本地可探测的状态
POST /api/repos/update  { name }
  → { updated: boolean, summary?: UpdateSummary, error?: string }
  // updated=false 表示已是最新（无新增 commit）；error 表示失败（网络/ff-only 冲突）
```

- GET 只读本地信息（`rev-parse` 当前 HEAD、`rev-parse origin/<branch>` 差距）——不触发网络
- POST 流程：校验 name 在白名单 → fetch → 读基线 → `log 基线..origin/<branch>` →
  空 → `{ updated: false }`；非空 → summarizeUpdate → pull --ff-only → 写基线 → 返回摘要
- **顺序注意（教学点）**：先 fetch 再读基线（基线是上次的 HEAD），pull 放在总结之后
  （fetch 后工作区还没动，即使总结失败仓库也是安全的；总结成功再 ff 前进）

### seam 6：`app/services/repos/index.ts` + `types.ts` —— 客户端层（仿 sessions）

```ts
listRepos(opts?): Promise<RepoListResult>                    // GET /api/repos
updateRepo(name): Promise<UpdateResult>                      // POST /api/repos（GET/POST 共用 route.ts）
```

### seam 7：`app/repos/page.tsx` —— 独立页面（新路由，App Router 自动接上）

- **布局（2026-08-31 UI 整改，用户拍板左右布局）**：
  ```
  顶栏：仓库更新                           [返回观测台]
  ├──────────────┬───────────────────────────────┤
  │ 左侧边栏      │ 右侧详情（选中项目）             │
  │ [全部更新(3)] │ pi · main            [更新]    │
  │ pi    [有更新]│ ────────────────────────────  │
  │ codex        │ ## 更新概览（LLM 总结）          │
  │ dsh   [有更新]│ ⭐ 重点标注                    │
  │ smolagents   │ ▸ 展开 N 条提交（折叠）          │
  └──────────────┴───────────────────────────────┘
  ```
- **状态 = 进页面实时 ls-remote 检查（不是本地引用比对）**：`checkRemoteAhead`
  （`git ls-remote origin <branch>` 对比本地 HEAD，毫秒级、不下载对象、不写 .git）——
  有更新才显示 tag「有更新」；无更新/检查失败（断网）不显示，杜绝"状态误导"
- **备注列已删**（用户拍板：自己清楚每个项目用途）；**git log 默认折叠**
  （用户拍板：主要看概览和总结），commit 列表收在「展开 N 条提交」details 里
- 非 git 仓库：侧边栏灰置 + 详情提示"zip 快照，无 git 历史"（不提供更新按钮）
- 更新中：按钮禁用显示"更新中…"（防连点）；完成 → 右侧渲染 markdown（复用 `app/markdown.tsx`）
- 样式：复用 `globals.css` 令牌，`repos.module.css` 左右 grid（264px + 1fr）

## 已拍板（2026-08-31 用户拍板，三个子决策）

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| 1 | 非 git 的 4 个项目怎么处理 | **只做 git 仓库**（初始 3 个：pi/codex/deepseek-harness；**2026-08-31 晚新增 langchainjs/opencode，共 5 个**），4 个 zip 解压的在页面灰置标注 | zip 解压的没有 git 历史，增量基线无从谈起；且 Survey 是文档不需要更新。不给参考库动手术。新增大 git 仓库 = registry 加一行（分支是数据） |
| 2 | 总结粒度 | **全量增量**（有基线总结新增、首刷取最近 20 条），超长截断 | 一期先做全量增量，简单直接；粒度选择器留二期打磨 |
| 3 | 总结落盘 | **保存到 `workspace/`**（人看的临时材料，不进 git） | 用户原话："保存到workspace吧 只要是我自己看一下 有需要学的就加到plan里面 没有就看一眼结束"——总结是给自己看的原材料，不是正式文档；看完把有价值的学点补进 PLAN（与走读笔记 `workspace/精读走读-*.md` 定位一致） |

## 验收标准

1. `/repos` 页面左右布局：左侧 9 个项目列表（5 个 git 可更新、4 个非 git 灰置），
   有更新的项目显示「有更新」tag（进页面实时 ls-remote 检查，毫秒级）
2. 点 pi 的更新按钮：真实 fetch + pull，落后数归零；右侧显示新增 commit 列表（默认折叠）+ LLM 总结
3. 总结包含"更新概览 + 分节（新功能/修复/重构）+ ⭐ 重点标注"；MOCK/无 key 时降级显示"跳过总结"（不崩）
4. 第二次点击（无新增）：显示"已是最新"，不重复总结
5. 基线文件 `.repo-updates/pi.json` 生成且内容正确；`.repo-updates/` 已 gitignore
6. 总结落盘 `workspace/更新日志/<日期>-<项目>.md` 生成（人看材料，不进 git）；落盘失败不阻塞
7. `app/api/repos/_lib/git.ts`（runGit/HEAD commit/新增 commit 解析/parseLsRemoteHash）与 `baseline.ts`
   有单测绿（B8 ① 纯逻辑层）；`registry.test.ts` 断言分支是数据（DSH=master 非 main）
8. `tsc --noEmit` 通过；code-review 双轴（11.5 ⑦）

## 教学点（做中学）

1. **fetch vs pull**：remote-tracking 引用（`origin/main`）与工作区分开——先 fetch 看清
   再决定 pull，是"知道自己在做什么"的 git 用法（不是无脑 pull）
2. **增量基线**："上次位置 → 现在"的差集思想——凡是"重复执行不能重复产出"的场景都要
   记录位置（基线/游标/checkpoint 同族）
3. **spawn 参数数组防注入**：`execFile('git', ['-C', path, ...])` vs 字符串拼命令
   （参考 bash-runner 已有教训）；路径白名单 = 不接受外部输入
4. **复用模型管道**：B2 的 `selectModel + complete + fail-soft` 是通用"调模型干活"模板，
   总结、摘要、分类都是同一管道换 prompt——学会一个模板到处用
5. **`--ff-only` 保护**：参考仓库不该有本地提交；ff-only 失败 = 提醒"这仓库被动过"
6. **App Router 多页**：第一个非首页路由（`app/repos/page.tsx`），layout 自动套用
7. **分支是数据不是探测（用户 08-31 拍板）**：命令序列固定，只有分支名因项目不同——
   已知数据写进 registry，不做运行时探测（`rev-parse --abbrev-ref HEAD`）。
   为"自适应"而加的动态逻辑，在场景不需要时是过度设计（可读性优先）
8. **ls-remote vs fetch（UI 整改核心，用户 08-31 拍板）**："有没有更新"用 `git ls-remote
   origin <branch>`——只传引用（一行 hash，毫秒级、不下载对象、不写 .git），对比本地 HEAD
   即可；真正要更新内容才 fetch（下载增量对象，可能几十秒）。检查 ≠ 更新，用最小命令
   做最小的事。实测 pi 0.16s / codex 0.045s

## 参考源码位置（对照用）

- 本项目 B2 管道：`lib/summarize.ts`（generateSummary 模式）+ `lib/selectModel.ts`（模型选择，C15 从 _pipeline 下沉）
- 本项目 session 三层：`lib/session/` + `app/api/sessions/route.ts` + `app/services/sessions/`
- 本项目导航手册：`doc/开源项目导航手册/index.md`（"我们拿走什么"列 → prompt 关注点）
- bash 子进程教训：`lib/tools/bash-runner.ts`（spawn 参数数组 + 乱码/超时处理）

## 决策记录

- 2026-08-31：用户拍板方案 B（独立路由页）；三个子决策拍板：① 只做 3 个 git 仓库
  ② 总结粒度全量增量 ③ 总结落盘 `workspace/`（人看材料，不进 git，看完有价值再补进 PLAN）
- 2026-08-31（实施中用户纠偏）：**分支是数据不是探测**——删 getCurrentBranch 运行时探测，
  分支写进 registry；**命令序列固定**（fetch/log/pull 三个模板，分支作参数）
- 2026-08-31（UI 整改，用户拍板）：① 左右布局（左侧项目边栏 + 右侧详情）
  ② 删状态列/备注列——状态改**进页面实时 ls-remote 检查**，有更新才显示 tag（不误导）
  ③ git log 默认折叠（主要看概览和总结）④ 全部更新按钮放侧边栏顶部 ⑤ 右侧详情加更新按钮
- 2026-08-31（新增参考项目）：用户本地新增 **langchainjs**（`main`，LangChain JS 生态参考）和
  **opencode**（**`dev` 分支**，终端 Agent 参考，浅克隆）→ registry 加两行（分支是数据：
  opencode 不是 main 再次验证此设计）；git 仓库 3→5，页面/接口无需改（遍历 REPOS 自动纳入）
- 2026-08-31（新增参考项目机制）：用户定"新增参考项目要对架构进行解析，方便下次精确查找" →
  **导航手册改渐进式**（`doc/开源项目导航手册/`：index.md 索引 + 每项目一个文件 + `sop-新增参考项目.md`）；
  新增项目 SOP = 架构解析（技术栈/组织哲学/核心引擎/按功能词逐项 grep 定位/验证路径 +
  monorepo 几十包处理三原则）→ 填导航卡 → 回填 → 验收。**克隆/更新代码是用户自己的事，
  面板接入属本详案（C15）范畴，不进 SOP**；全局文档不增加机制内容
- 为什么不做方案 A（对话内工具）/方案 C（侧栏面板）：A 无可视化、一问一答；C 要动
  `page.tsx` 三栏布局、挤占主界面。B 独立页成本最低且是新路由页练习（方案对比详见会话记录）
- 2026-08-31（为什么放 lib/，用户纠结过的边界）：用户问"repo 是业务功能/特供小工具，
  为啥放 lib（lib 不是应该放 agent 相关内容吗）"。结论：**lib/ 的准入标准是"无 UI 依赖、
  可单测、不反向依赖 app 的纯逻辑层"，不是"agent 专属"**（config/message 等非 agent 核心也在 lib）。
  repo 放 lib 的理由：① 纯逻辑可单测（lib/repos/*.test.ts）② 复用 lib 模型管道
  （selectModel+complete+fail-soft）③ 与 lib/session 三层模式同构。且"特供小工具"放 lib
  最安全——不追求通用、不要了直接删 lib/repos 不影响 agent 代码；真正要防的污染是
  "有 UI 耦合/依赖 app/不可单测"的东西进 lib（本目录已验证 0 条 @/app import）。
  边界已注释在 `lib/repos/registry.ts` 顶部。
- 2026-08-31（业务模块探索模式定案，repo 迁出 lib/）：用户进一步想清楚——lib/ 应是**纯 agent 内核**，
  以后要基于内核探索更多落地实践，业务模块不该混进 lib（删起来要整块干净）→ **定 AGENTS.md 11.7**：
  - lib/ = agent 内核（引擎/模型/会话/工具/类型），公共门面 `lib/index.ts`（外部从这里 import）
  - **业务模块**放 `app/api/<模块>/_lib/`（`_` 前缀非路由，先例 `_pipeline`）+ 页面 + services，3 处目录
  - repo 从 `lib/repos/` 迁到 `app/api/repos/_lib/`（本详案所有路径随之更新：_lib/registry、_lib/git…）
  - 删一个业务模块 = 删 3 处目录，不影响 agent 内核；内核红线（lib/agent.ts）不变
