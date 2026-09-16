# C30 · 改名：`Teaching Agent` / `agent-learn` → `statve`

> **状态**：⏳ 进行中（代码 ✅ `aadc389` / 文档层 ✅ `32ba052` / 目录名·仓库名 ⏳）。
> ⚠️ **技术标识二次改过**：原定 `statve-agent`，同日二次决定统一为 `statve` —— 见文末**补记 1**。

---

## 一、定案（用户 2026-09-16 拍板）

| 层 | 用哪个 | 为什么 |
|---|---|---|
| **品牌名**（页头、浏览器标题、系统提示词里它对自己的称呼） | **`statve`** | 单词最好念；域名就是 `statve.com` / `statve.dev`；`harness` 只作**描述词**出现在文案里 |
| **技术标识**（`package.json` name / GitHub 仓库名 / 本地目录名） | **`statve`** | npm 包名不接受空格与大写。**原定 `statve-agent`，同日二次决定统一为 `statve`**（用户："不大气"）——见补记 1 |
| **`观测台`** | **删除** | 用户 2026-09-16 明示 |

**一个名字、一层**——原稿分两层（品牌名 `statve` + 技术标识 `statve-agent`），理由是避免"UI 写一个、包名写另一个"；**同日二次决定并成一层**，两处都用 `statve`。那条理由仍然成立，只是不再需要。

### 名字的来源与占用核查

`statve` = **斯洛文尼亚语「织布机」**。它在七个候选里是**唯一**在下面三层**全部干净**的：

- **包管理器**：npm / PyPI / crates / RubyGems / NuGet 全空
- **代码托管**：GitHub 句柄 `statve` 也空着
- **域名**：`.com` / `.dev` / `.ai` / `.io` **四个全空**（其余六个候选的 `.com` 全部阵亡）

全过程（含可复跑的查法、对照测试纪律、以及被否掉的 `mekik` / `krosme` 类候选为什么出局）见 `workspace/agent命名-欧洲小语种候选.md` **§5.5 全候选占用矩阵**。

---

## 二、依据（一手来源）

- **占用核查**：`workspace/agent命名-欧洲小语种候选.md` §5.1（查法）/ §5.5（矩阵）——RDAP 实测，非搜索印象
- **词义**：kaikki.org + PONS（斯洛文尼亚语 `statve` = 织机，复数专用），见同文档 §2.1
- **影响面**：2026-09-16 对本仓库实测（下表每一行都有文件:行号）

---

## 三、影响面盘点（实测，不是推测）

### 3.1 要改的代码（6 个文件 / 8 行）

| 文件 | 行 | 改动 |
|---|---|---|
| `package.json` | 2 | `"agent-learn"` → `"statve"` |
| `app/components/nameplate/index.tsx` | 41、43 | wordmark → `statve`；**删除**「观测台」span（连同 `.wordmarkCn` 样式） |
| `app/layout.tsx` | 11 | `"Teaching Agent · 观测台"` → `"statve · agent harness"` |
| `app/api/chat/_pipeline/prompt/index.ts` | 53 | 「你是 Teaching Agent，一个帮助初学者理解 AI Agent 核心机制的教学助手。」→ 只把名字换成 `statve`，**其余措辞一字不动** |
| `app/api/chat/_pipeline/prompt/index.test.ts` | 59 | 断言 `toContain("Teaching Agent")` → `toContain("statve")` |
| `lib/tools/web-search/provider/index.ts` | 108 | UA → `statve/0.1 (web_search)` |
| `lib/tools/web-fetch/fetcher/index.ts` | 82 | UA → `statve/0.1 (web_fetch)`（**不带 URL** —— 见补记 1 第 3 条） |
| `lib/tools/test-fixtures.ts` | 19 | 临时目录前缀 → `statve-test-` |

### 3.2 「观测台」7 处——**不是全删，是分清"品牌位"与"文案位"**

| 位置 | 处理 |
|---|---|
| `nameplate/index.tsx:43` | **删除**（它是页头副标 = 品牌位） |
| `layout.tsx:11` | **删除**（换成 `agent harness`） |
| `app/repos/page.tsx:139`「返回观测台」 | → 「返回对话」（它是导航文案，指的是那个页面，不是品牌） |
| `app/page.tsx:4` 注释「观测台的组装层」 | → 「statve 的组装层」 |
| `app/repos/page.tsx:16`、`app/repos/page.module.css:8`「与观测台同语言」 | → 「与对话页同语言」 |
| `app/repos/page.module.css:81`「观测台「新建会话」同款配方」 | → 「对话页「新建会话」同款配方」 |
| `doc/plan/c15-repo-updater.md:9,180` | 文档层，随文档批改一起 |

### 3.3 文档层（约 25–30 处）

`README.md`（H1 + 首段自称）/ `PLAN.md` / `doc/**`（约 10）/ `分享材料/*.svg`（**图片里是文字，要改 SVG 源码**）/ `会话检查点.md`。

**约定**：README 的 H1 与正文自称**都用 `statve`**（原稿曾分两层：H1 用 `statve-agent`、正文用 `statve`；二次决定后统一，见补记 1）。

### 3.4 **不改**的（都有依据）

| 东西 | 为什么不改 |
|---|---|
| 引擎 / 工具链 / 存储寻址 | workspace / traces / sessions / repoBaselines **全部是 `resolve(process.cwd(), …)`**（`lib/config/index.ts:122-128`）——运行时现算，**与名字零耦合** |
| localStorage 键 | 由 `sessionId` 派生（`task-panel/index.tsx:45,66`），不含品牌 |
| 导出文件名 | `<sessionId>.jsonl`（`app/api/chat/export/route.ts:38`） |
| 环境变量名 | 通用名 `WORKSPACE_ROOT` / `TRACE_DIR` / `SESSION_DIR` / `REPO_BASELINE_DIR` |
| 会话 / trace 文件前缀 | `s_…` / `run_…`，无品牌 |
| ⚠️ **`lib/agent/index.ts`** | **红线文件，全程不动**——已确认其中没有任何名字引用，改名**没有任何理由**碰它 |

---

## 四、验收（怎么算做完）

1. `node node_modules/typescript/bin/tsc --noEmit` → exit 0
2. `pnpm test` → 全绿（含改后的 prompt 断言）
3. 代码层旧名残留 = 0：`teaching agent` / `观测台` / `agent-learn` 三串在**代码与 UI 文案**里搜不到（文档历史留档段落豁免）
4. **真实对话跑一轮**：agent 自称 `statve`、教学定位不变、工具调用正常

---

## 五、已知风险与边界（诚实记录）

1. **⚠️ 唯一的行为风险 = 系统提示词**。它第一句就是 agent 的身份，改名字 = 改提示词，模型输出风格可能随之微调。**纪律：只替换名字 token，其余措辞一字不动**，改完做一次前后对比。
2. **旧会话头里的 `cwd` 是旧绝对路径**（`lib/session/store/index.ts:354` 写入 → `lib/types.ts:162` 的 `cwd` 字段）。今天**没有代码读它**，但——⚠️ **`C18⑥`「按工作目录分组」就是它的规划消费者**。所以改名之后，旧会话会在将来的分组视图里落进一个"已经不存在的项目目录"。
   - **影响面量级**：`C18` 实测现存会话的 `cwd` 只有 1 个值 → 最多多出一个分组。
   - **处置：不改历史文件。** 存储是事实，去改写历史行比留一个陈旧字段更危险（同 `B12` 的判据）。
3. **本地目录名与 GitHub 仓库名不在本项内**，原因两条：
   - 目录名 `E:\work-space\agent-learn` **必须在本 DSH 会话之外改**——本会话的 cwd 就是它，在会话里重命名等于抽掉脚下的地板。改完要删 `.next` 与 `tsconfig.tsbuildinfo`（里面缓存了旧绝对路径）。
   - GitHub 改名后旧 URL 走 301 不会立刻断，但它**不解决** `会话检查点.md` 记的那件"仓库是 public + 历史里有敏感内容"的待决事项——那是另一件事。

---

## 六、顺序

1. 详案 + `PLAN.md` 排期表（本文件）
2. 代码改名（13 文件）+ `tsc` + `pnpm test`
3. 文档层批量替换（**单独一个 commit**）
4. （在本会话之外）目录名 / GitHub 仓库名

**收尾（`AGENTS.md` 第 10 条）**：更新本详案 → 更新 `PLAN.md` 状态列 → 更新 `会话检查点.md` → **展示改动清单等用户确认再 commit**。

---

## 七、补记 1（2026-09-16）：技术标识从 `statve-agent` 统一为 `statve`

**触发**：用户看过落地结果后的原话 ——「**statve-agent 我觉得不大气**，我刚刚改成了 statve 全局替换了」。

**原方案 → 新方案**：原定「品牌名 `statve` + 技术标识 `statve-agent`」**两层**（理由是避免"UI 写一个、包名写另一个"）。新方案：**两处都用 `statve`，只有一层**。

**改动**（全部是字面量替换 `statve-agent → statve`）：`package.json` 的 name、web_fetch 的 UA（含其中的仓库 URL）、web_search 的 UA、`test-fixtures.ts` 的临时目录前缀。

**核查结论**（2026-09-16 全库实测）：

1. **无功能性破坏** —— 没有任何代码或测试依赖 `statve-agent` 这个字面量；`tsc --noEmit` exit 0（含当时工作区里另一会话的 C8 在制品一起编译通过）。
2. **顺带更干净**：`statve` 在 npm / PyPI / crates / RubyGems / NuGet、GitHub 句柄、以及 `.com/.dev/.ai/.io` 四个域名上**全部为空**（见 §一 的占用核查）——比 `statve-agent` 少一层占用风险。
3. ⚠️ **UA 里那个 URL 是错的，已删掉**。第一版我写的是 `+https://github.com/daly-dai/statve-agent`，二次改名后变成 `.../statve` —— **两次都指向一个不存在的仓库**（GitHub 仓库名还没改）。用户当场指出："这个地址不存在啊"。**修法：删掉 URL**，只留 `statve/0.1 (web_fetch)`。判据：UA 里放链接是给站点运营者"查你是谁"用的，**指向不存在的仓库等于撒谎**；何况本地跑的教学 harness 不是爬虫集群，`statve/0.1` 这个自述已经满足"不伪装成浏览器"。兄弟 UA（web_search）本来就不带 URL，改完两边一致。**等仓库真改完名，再决定要不要补回去。**
   - **实测（2026-09-16，GitHub API 直查）**：`api.github.com/repos/daly-dai/agent-learn` → **200 存在**（public，2026-08-19 创建）；`.../statve` → **404**；`.../statve-agent` → **404**。本地 `git remote -v` 与仓库根目录名同样都还是 `agent-learn`。
   - **结论**：真实存在的仓库**只有一个 —— `agent-learn`**；两个 `statve` 变体**从未存在过**。所以"UA 里放 URL"这件事在当前状态下**没有正确答案**，只有"不放"是对的——**要放，得等 GitHub 仓库真改完名。**

**教训（流程，不是技术）**：**两次决定之间没有留痕**。第一次落在 commit `aadc389` 的 message 里（写着 `→ statve / statve-agent`），第二次是全局替换**直接把详案原文覆盖掉**——于是文档与 commit 历史一度互相矛盾、且没有解释。按 `AGENTS.md` 第 10 条，「已有计划升级」必须在原详案**追加补记、保留原文**；本补记就是补上这一步。

**另一条容易误判的事**：`statve-agent → statve` 的替换**命中面很窄**（当时只有 6 个文件含这个字面量）。文档层里写的是 `agent-learn` 和 `Teaching Agent`，**不含 `statve-agent`** —— 所以"全局替换了"≠"改名做完了"。文档层替换是**独立的一步**（见 §六 第 3 条）。
