# C14 详案：@ 文件匹配（file mention）—— 输入框 @ 触发文件选择注入

> 2026-08-27 创建（用户提：代码编写时经常需要模型读取指定代码/配置文件，需要指定文件的方式）
> 状态：💡 讨论中 → 定案（符号用 @，不写死，做成配置项）

## 功能描述

在输入框里打 `@` 触发**工作区文件模糊搜索**，选中文件后其路径以标记形式插入消息；发送时解析标记，把**文件内容注入模型上下文**（或等价地让模型知道要读这些文件）。解决"模型不知道该读哪个文件"的问题——代码编写时用户想点名某个文件。

## 参考实现（本地源码已实读）

| 参考 | 文件 | 机制 |
|---|---|---|
| **Codex**（最完整） | `codex-rs/tui/src/mention_codec.rs` + `fuzzy_file_search.rs` + `completion_target.rs` | `@` 触发多线程模糊搜索（12 线程/50 条/可取消）→ Tab/回车选中 → 路径以 `[@name](path)` 插入 → 发送时 `mention_codec` 解码注入。`PLUGIN_TEXT_MENTION_SIGIL = '@'`，另有 `TOOL_MENTION_SIGIL = '$'` |
| **pi** | `@earendil-works/pi-coding-agent/src/cli/file-processor.ts` + `pi-tui/src/autocomplete.ts` | `@file` CLI 参数 → 读文件注入 `<file name="...">\n内容\n</file>`（文本/图片两路）；TUI `@` 触发 fd 搜索（**尊重 .gitignore**、支持引号/空格路径） |

## 决策（用户 2026-08-27 拍板）

1. **符号用 `@`**（参考项目事实标准，不是 `#`）——**不写死**：做成配置项（`config.ts` 加 `FILE_MENTION_SIGIL`，默认 `@`），将来想换 `#` 或加别名只改一处
2. **方案 A：抄 Codex 全链路**（输入框触发 → 模糊搜索 → 选中插入 → 发送解码注入）——学习点最密：mention 编解码 + 模糊搜索 + 输入框补全，三样都是新知识

## 实施方案（seam 设计，11.5 ①）

```
输入框 @ → 补全面板（前端）→ 选中 → 消息里插入 @路径标记
→ 发送时 parseMentions 解析 → 文件内容注入 → 走现有 /api/chat
```

### seam 1：`app/lib/mentions.ts`（纯函数层，可单测 ✅）

```ts
/** 从输入文本提取 @ 标记列表（如 "@src/foo.ts" → 名字 + 光标前的补全前缀） */
export function parseMentions(text: string, sigil: string): Mention[]
/** 补全触发判断：光标前的字符是否处于 @ 前缀（返回当前输入段） */
export function extractMentionPrefix(text: string, cursor: number, sigil: string): string | null
/** 把选中路径编码回消息（如 "@foo.ts"） */
export function encodeMention(path: string, sigil: string): string
```

- **测什么**：parseMentions 提取正确（多标记/转义/边界）、extractMentionPrefix 光标逻辑（@ 后跟/不跟字符）、encodeMention 往返
- seam 收最小结构（纯字符串），node 环境可测——**B8 ① 许可**

### seam 2：`app/api/file-search/route.ts`（服务端文件搜索）

```ts
GET /api/file-search?q=xxx  →  { matches: [{ path, name, isDir }] }
```

- 抄 codex：模糊匹配（大小写不敏感 + 子序列匹配）
- **.gitignore 过滤 = 必须项（不是可选优化）**——2026-08-27 用户问"gitignore 涉及的文件是不是要过滤掉"→ 查证参考实现：
  - **Codex**：`ignore::WalkBuilder` + `respect_gitignore: true`（默认开）+`require_git(true)`——**git 语义**：只读仓库根内 .gitignore，不读仓库上层（如 `~/.gitignore`）；关掉时 .gitignore/git-global exclude/.ignore/parent ignore 全关（`file-search/src/lib.rs:111-117, 408-415`）
  - **pi**：fd（原生尊重 .gitignore）
  - **我们的实现**：Node fs 递归时读工作区根 .gitignore，按 git 语义过滤（node_modules/.next/.git 等默认排除 + 用户 .gitignore 条目）；**不做**"读仓库上层 ignore"（git 语义，同 codex）
- 上限 30 条（比 codex 50 略小，教学项目够用）；工作区根 = 项目根（未来 C6 多工作区再参数化）
- **效率闭环**：排除依赖（.gitignore 过滤）→ 搜索范围只有项目文件 → 600 文件 ≈12ms（实测），巨型目录（node_modules 17k 文件 81ms）根本进不来

### seam 3：前端补全面板（`app/components/ui/mention-picker/`）

- 输入框 onChange 时调 extractMentionPrefix → 有前缀则调 /api/file-search → 显示匹配列表
- ↑↓ 选择 / Enter 或 Tab 确认 / Esc 关闭（抄 Menu 的键盘导航模式，已有现成模式）
- 选中 → encodeMention 插入消息 → 关面板

### seam 4：发送前注入（改 `submit()` 或 chat route）

- 发送时 parseMentions(text) → 对每个 @路径：读文件内容（若存在）→ 注入 prompt（格式参考 pi `<file name="...">\n内容\n</file>`）
- **决策点（实施时确认）**：注入是"读文件内容进上下文"（pi 式）还是"让模型自己调 read 工具"（C 方案）——定 A 的完整链路，先做 pi 式注入（内容直接进 prompt），简单直接

## 验收标准

1. 输入 `@` 弹出文件匹配面板，输入时实时过滤（模糊匹配）
2. ↑↓ 键盘选择、Tab/Enter 确认、Esc 关闭（键盘可达，Menu 同款）
3. 选中后消息里出现 `@路径` 标记，发送后模型上下文里有该文件内容
4. `parseMentions` / `extractMentionPrefix` / `encodeMention` 单测绿（B8 ①）
5. `tsc --noEmit` 通过；code-review 双轴（11.5 ⑦）

---

## 方案对比：为什么选当前方案（2026-08-27 决策留痕，重点）

> 用户要求"记录几种方案对比之下为什么选择当前方案"——决策过程要能回看，不能只剩结论。

### 对比的三种方案

| 方案 | 做法 | 复杂度 | 学习点 | 缺点 |
|---|---|---|---|---|
| **A. 抄 Codex 全链路** | 输入框 @ 触发 → 模糊搜索 → 选中 → mention 编解码注入 | 中 | mention 编解码 + 模糊搜索 + 输入框补全（三样新知识） | 实现量最大（前后端都做） |
| **B. 抄 pi 的 CLI 注入** | 输入里识别 `@路径` 直接读文件注入，无补全 UI | 小 | 文件注入格式（`<file name>`） | 没有交互——用户要"指定文件"时得自己打全路径，不解决"记不住路径/打错"的核心痛点 |
| **C. 补全 + 复用现有 read 工具** | 前端 `@` 补全路径 → 选中后自动调一次 read 工具 | 中 | 前端补全 + 工具编排 | 多一次工具调用往返；且"让模型自己调 read"依赖模型行为，不如"内容直接进 prompt"确定性高 |

### 为什么选 A（逐条理由）

1. **学习价值最高（项目第一原则：学习优先于产出）**：A 覆盖 mention 编解码——"用户看到的是标记，模型收到的是展开内容"这条管道是 agent 输入层的核心知识（Codex/Claude Code/Cline 都有，是事实标准）。B 只有注入格式，C 只有补全，都不完整。
2. **解决真实痛点**：用户要的是"代码编写时点名要读的文件"。B 要手打路径（记不住/易错），C 依赖模型行为（不保证）。A 的补全交互（模糊匹配 + 键盘选择）正好解决"记不住路径"。
3. **本地源码可对照**：Codex 和 pi 的完整实现都在 `E:\agents-read/`，抄的时候能逐行对照（7.4 落地原则 1：每步标注参考谁）。
4. **注入确定性**：pi 式"内容直接进 prompt"（A 的 seam 4）比"让模型调 read"（C）更确定——不依赖模型会不会、想不想调工具。

### 为什么不选 B / C（排除理由）

- **不选 B**：无交互是硬伤。B 适合"CLI 一次性参数"场景（pi 是终端工具，`pi @file 命令` 合理），但我们是有 GUI 输入框的 Web 应用，补全交互是 GUI 的天然优势，放弃它等于放弃 GUI 该有的体验。
- **不选 C**：`组合 > 发明` 的角度看 C 最"省"（复用 read 工具），但"自动调 read"把控制权交给模型，且多一次工具往返（慢、可观测性差）。A 的注入是在发送前确定性地把内容放进 prompt，路径短、行为可预期。C 可以作为 A 的降级备选（如果将来注入内容太大再考虑）。

### 效率方案对比（真实工作区场景：600+ 甚至更大）

> 2026-08-27 用户纠正：**不能拿当前项目 158 文件当基准**——未来 C6 工作区选择后，用户可能选几百上千文件的项目甚至大型仓库。以下按真实工作区场景分析。

| 方案 | 搜索机制 | 600 文件 | 大型仓库（数千文件） | 卡顿风险点 |
|---|---|---|---|---|
| Codex | Rust 12 线程模糊搜索 | 毫秒级 | 毫秒级（为 monorepo 设计） | 无（我们 Node 不照搬线程） |
| pi | fd（Rust，尊重 .gitignore） | 毫秒级 | 毫秒级 | 依赖外部工具 fd（需安装） |
| **我们（Node fs + 内存过滤）** | 单线程遍历 + 子序列匹配 | **≈12ms** | ≈几十 ms | **巨型目录在搜索范围里** |

**实测基准（2026-08-27 本机）**：
- 项目根（排除 node_modules/.git/.next）：379 文件，**遍历 7ms**
- node_modules（17,198 文件，不排除）：**遍历 81ms**

**结论（修正后）**：
1. **扫描本身不是瓶颈**：600 文件 ≈12ms、数千文件 ≈几十 ms——Node 足够快。用户说的 600 文件**不会卡**。
2. **真正的风险 = 巨型目录混进搜索范围**：node_modules（17k 文件）单次遍历就 81ms，如果每次搜索都带着它，debounce 也救不了。→ **排除依赖（.gitignore 语义）是必须项，不是可选优化**（pi 用 fd 尊重 .gitignore 就是这个原因）。
3. **次风险 = 触发频率**：每敲一个键都发请求会卡。解药：
   - **debounce ~200ms**（关键，参考实现都有）
   - 结果缓存（同查询不重复搜）
   - 上限 30 条（控制渲染）

> 教学点：**卡顿的根源通常是"搜索范围没界定"（带上了巨型目录）+ "触发频率没控制"（每键一搜）**，不是"文件多"本身。两个解药：范围白名单（排除依赖）+ 防抖。

### 文件夹支持（08-27 补）

Codex 源码确认（`FuzzyFileSearchMatchType.ts`）：匹配类型 = `"file" | "directory"` 两种。**我们照抄：文件和文件夹都进搜索结果**。选中文件的注入 = 内容进 prompt；选中文件夹的注入方式待实施时定（候选：① 注入目录文件列表让模型自己选读 ② 只注入路径提示，暂不展开——实施时按"简单优先"选）。

---

## 更新：效率与文件数实测（2026-08-27）

- 项目 git 跟踪文件 **158 个**（93 ts/tsx + 12 css + 23 md + 27 其他）——不是 600
- 600 文件场景：Node 单次扫描 ≈10-30ms，无压力；**必须做 debounce**（~200ms）防"每键一搜"


## 教学点（做中学）

1. **mention 编解码**：输入层的"标记 → 内容"管道——用户看到的是一段文本，模型收到的是展开后的内容（Codex mention_codec 的核心）
2. **模糊搜索**：子序列匹配 + 大小写不敏感 + 上限（不是"查数据库"，是"尽量猜中用户要哪个"）
3. **输入框补全**：光标位置感知 + 键盘导航（复用 Menu 的移动焦点模式）
4. **符号不写死**：配置项 vs 硬编码——一个字符也值得做成配置（用户拍板）

## 参考源码位置（对照用）

- Codex: `E:\agents-read\codex\codex-rs\tui\src\mention_codec.rs` / `fuzzy_file_search.rs` / `completion_target.rs`
- pi: `E:\agents-read\pi\node_modules\@earendil-works\pi-coding-agent\src\cli\file-processor.ts` / `pi-tui\src\autocomplete.ts`
