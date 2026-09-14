# 会话 + 压缩 联合重构（详案）

> **状态**：💡 **讨论中**（**诊断完成，方案未定**——本文件目前是"问题清单 + 分档"，不是施工单）
> **优先级**：**A 档（含新增子项 ⑥「按工作目录分组」）排 A3 完成后第一批**（2026-09-14 用户定：分组迟早要做、优先级提高，**由它把 A 档打开**）；**B/C 档仍排 C 阶段所有功能之后**
> **触发**：2026-09-14 用户判断——"总觉得我们的会话系统迟早要重构……**想作为产品推出来，会话要大改，压缩也要跟着大改**"
> **定位**：**架构债**，不是新功能。对应 `PLAN.md` 7.3 **C18**
> **前置认知**：当时的核心是**做中学**，所以刻意从简（"先有就行"）。**那个选择是对的**——459 行、逻辑清晰、有测试（B18 补的树语义用例）；一上来就上 DSH 那套（projection + 持久缓存 + 索引 + 格式迁移），这个项目根本长不到今天。

---

## 0. 为什么会话和压缩必须一起改

`compaction` **就是** `SessionEntry` 的一个类型（`lib/types.ts`）——**压缩产物是会话格式的一部分**。所以两边是同一个问题的两面：

| 改一边 | 必然牵动另一边 |
|---|---|
| 会话格式版本化 / 迁移 / 落盘 `leafId` | compaction entry 的结构与版本必须跟着走 |
| 压缩策略（真实 token / 分层摘要 / 保留区规则） | 写进会话文件的结构变了，就是格式变更 |
| 会话读取性能（增量折叠 / 缓存） | 压缩折叠是 `buildContext()` 的重头，一起变 |

**旁证**：DSH 的 `packages/session/` 有 24 个包，其中 `session-format` + `session-format-v0-to-v1/v1-to-v2/v2-to-v3` = **四个版本 + 三个迁移包**；压缩另成 `packages/compaction/` 四包。**格式演进和压缩演进在工业实现里就是绑在一起做的。**

---

## 1. 会话侧诊断（2026-09-14 实读 `lib/session/store.ts`，459 行）

| 项 | 性质 | 证据 |
|---|---|---|
| ⭐ **会话树是"预挖的空壳"** | **现在就不完整** | `switchLeaf` **生产代码零调用**（只有 `store.test.ts` 3 个用例） |
| ⭐ **`header.version = 1` 从不被读** | **现在就不完整** | grep `version ===` / `.version` **零结果**——写了但没人检查 |
| `loadOrCreate` 用 **`readFileSync`**（同步 IO） | 阻塞事件循环 | `store.ts:335`，在 route handler 里同步读 |
| **每请求全量读 + 全量重放** | 规模 | `createRequestContext` 每请求 new store → 构造即全量 parse；`buildContext()` 再全量回溯 |
| `list()` **全量读每个会话文件** | 规模 | `manager.ts:128` 读整个文件只为拿 `title`（首行）+ `preview`（第一条 user 消息） |
| `rename` **非原子写** | **风险** | `manager.ts:75-90` 全文件读 → 改首行 → 全量写回；崩在中间 = 会话损坏 |
| 并发写无保护 | 已知 | B11 会话级运行锁已排队 |
| ~~`reset()` 是死代码~~ | ❌ **误判** | `/clear` 命令在用（`lib/commands/clear/index.ts:27`） |

### 1.1 ⭐ 会话树是"预挖的空壳"（重要）

`ARCHITECTURE.md §5` 不变量 3 写着：**"接缝由需求逼出来，不预挖空壳"**。而会话树的现状是：

- 数据结构**支持**分支（`id`/`parentId` + `switchLeaf`）
- **落盘格式不支持**——没有任何地方记录当前 `leafId`
- `loadOrCreate` 直接假设 **"最后一行就是叶子"**（`store.ts:346-347`）——这个假设**只在纯线性追加时成立**，与树结构自相矛盾
- 生产**从未切过分支**，只有测试在切

**所以要修正一处旧结论**：`走读 24` 里写"我们的树形结构（id/parentId + switchLeaf 可回溯）是 DSH 线性日志+折叠视图的**超集**"——**这个自我评价偏高了**。我们有一个 DSH 没有的能力，但它**没落盘、没被用、还和加载逻辑冲突**。DSH 那边反而是对的：线性日志 + 折叠视图，**不预挖分支**。

### 1.2 ⭐ `version` 与 `TraceSnapshot` 是同一类病

两个都是**预留了字段但没有任何使用路径**：

- `TraceSnapshot`（A3 已决定删）
- `header.version`（更隐蔽——它看起来"很规范"）

后果：**格式演进没有任何路径**。将来改格式时，没有任何地方能判断"这个文件是老格式还是新格式"，只能靠猜或一刀切。

---

## 2. 压缩侧诊断

| 项 | 性质 | 证据 / 位置 |
|---|---|---|
| **token 是估算，不是真实值** | 准确度 | `estimateTokens` = 字长 / 2（"够触发阈值即可"）——阈值判断与成本统计都建在粗估上 |
| **`prepareCompaction` 里有嵌套查找** | 复杂度 | `for (entry of path) { messageEntries.findIndex(...) }` = O(path × messages) |
| **只处理最近一次压缩** | 抽象缺口 | `buildContext()` 取 `findLastIndex(compaction)`；多次压缩靠 `previousSummary` 单链串起来 |
| **切点靠手工修正** | 已知 | 保留区第一条不能是 `toolResult`，用 `while` 往前挪——B2.1 要升级为 tool-pairing balance |
| **B2.1 三件套未做** | 已排期 | ① compaction entry 补审计字段（被压消息 id 列表 + 摘要模型名）②"摘要必须更小" fail-closed ③ tool-pairing balance —— PLAN 标 `💡 讨论中`，条件触发 |
| **文件只追加不删，无限增长** | **产品化硬伤** | D5 决策"JSONL 只追加不删"——被压的原文永远留在文件里。本地调试无所谓，**作产品则是存储与读取成本** |
| 无 `retainedTail` | 决策 | D4 决策：不引入 |

---

## 3. 分档（**不同档的紧迫性完全不同**）

| 档 | 内容 | 触发条件 |
|---|---|---|
| **A. 便宜（各 ~10 行）** | ① `list()` 只读文件头（title 在首行、preview 在第一条 user 消息——后面几百 KB 读进来就扔）② `version` 读入时校验（不认识就明确报错，而不是静默当新格式）③ **⑥ 按工作目录分组**（2026-09-14 新增，见 §6——**由它把 A 档打开**） | **A3 完成后第一批**（2026-09-14 用户定） |
| **B. 要决策（不写代码，先拍方向）** | ③ **树的去留**：落盘 `leafId` 让树成立，**还是**承认预挖、砍掉分支回到线性？④ 格式版本化 + 迁移机制（对齐 DSH `session-format`） | **开工时具体讨论**（2026-09-14 用户定：不前置决策） |
| **C. 条件触发（等规模/等产品化）** | ⑤ 增量折叠 + 持久投影缓存（抄 DSH `session-projection`）⑥ `readFileSync` 异步化 ⑦ 真实 token 计数（用 provider 返回的 `usage`）⑧ 旧原文的归档/裁剪 ⑨ 索引（会话列表与搜索） | **作产品推出来时** / 会话长到有痛感 / 上多进程 |

> **A 档为什么不立刻做**：当前主线是 A3 Trace Viewer，且 A 档不属于任何人的"痛"。**记为可插队，不抢跑。**

---

## 4. 参考：DSH 怎么解（想学什么 → 去哪找）

| 想学什么 | 去哪找 |
|---|---|
| 格式版本化 + 迁移（v0→v1→v2→v3） | `packages/session/session-format/` + `session-format-v0-to-v1` / `v1-to-v2` / `v2-to-v3` |
| 一能力多后端（jsonl / sqlite） | `packages/session/session-persistence{,-jsonl,-sqlite}/` |
| **按工作目录分组的目录树 + 两种编码强度** | **`packages/session/session-persistence-jsonl/src/format.ts`**（`projectKey` / `projectDir` / `sessionDir` / `encodeSegment`，见 §6.3） |
| 增量折叠 + 持久缓存（解全量重放） | `packages/session/session-projection/` + `session-projection-cache/` |
| 查询 / 搜索 / 事件关系 / 有界窗口 | `packages/session-query/`（详见 `doc/plan/observability.md` A3 补记） |
| 按轮次导航大纲 | `packages/session/session-turn-outline/` |
| 会话统计 / 遥测 | `session-stats/` + `session-telemetry{,-otel}/` |
| 压缩系统（触发/选区/事务/总结/剪枝） | `packages/compaction/`（走读 24 已精读） |

---

## 5. 待定 / 明确不做

**待定（全部推到开工时，不前置）**：
- 树：**留还是砍**？—— **开工时具体讨论**（2026-09-14 用户定）
- **⑥ 分组的形状：甲（会话=文件）还是乙（会话=目录，对齐 DSH）？**——**暂不拍板，等 C6 工作区选择开工时一起定**（2026-09-14 用户定）；详见 §6.2
- 产品形态是什么——多用户？多租户？部署形态（单进程 / 多进程 / serverless）？**这决定 C 档做到哪一步**
- 是否引入第二种存储后端（sqlite），还是继续 JSONL + 改进读取

**明确不做（现在）**：**不打断 A3 主线**——本项在 A3 完成前不开工。A3 之后：**A 档（含新增的 ⑥ 按工作目录分组）第一批**；B/C 档仍排在 C 阶段所有功能之后。

**吸收旧条目**：`B2.1 压缩打磨三件套` 是三件套的"够用版打磨"，本项是"重构级"——**若本项开工，B2.1 直接并入，不单独做**（避免同一处改两遍）。

---

## 6. 按工作目录分组（子项 ⑥，2026-09-14 新增）

> **来源**：A3 讨论中用户指出"会话也没分组，你现在开始 trace 分组了"——分组是**迟早要做**的功能，**优先级提高**。
> **但形状暂不拍板**（2026-09-14 用户定：**等 C6 工作区选择开工时一起定**）。

### 6.1 目标形状（DSH 实证，**是两层不是一层**）

精读 `packages/session/session-persistence-jsonl/src/format.ts`：

```
<root>/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.jsonl
```

**我起初在 PLAN 里写成了 `<root>/<project>/<sessionId>.jsonl`（一层），是错的，已纠正。** DSH 的 `sessionDir()` 给每个会话一个**目录**而非文件，注释写明 "available for future session-local artifacts"——那几代日志（`session.jsonl` / `session.vN.jsonl`）就住在这个会话目录里。

### 6.2 我们要选的形状（甲 / 乙，**待拍板**）

- **甲**：`.sessions/<project>/<sessionId>.jsonl` —— 项目一层，会话仍是文件
- **乙**（对齐 DSH）：`.sessions/<project>/<sessionId>/` —— 会话目录里放主日志 + 审批日志 + 轨迹

**乙多买到的，恰好是我们已知的两个洞**：

- **删会话 = 删一个目录**。今天要碰三类文件、散在两个根目录（`.sessions/<id>.jsonl` + `.sessions/<id>.approval.jsonl` + `.traces/<id>.*.jsonl` 一堆），而 `delete()` **只删主文件**——审批日志与轨迹本来就留成孤儿。
- **归属由结构保证**（老话题：结构不会忘，字段会忘）。

**乙的代价**：`.traces/` 这个独立根目录（`TRACE_DIR` 可配）会消失。但 `.traces/` 与 `.sessions/` **都已经在 `.gitignore`** 里，都是纯本地开发数据 → "独立配置"的价值比初估小。

### 6.3 编码强度判据（值得抄的不是形状，是**这个判据**）

DSH 在**同一个系统里**用了两种强度：

| 段 | 函数 | 性质 |
|---|---|---|
| 项目目录名 | `projectKey(cwd)` | **有损**：`/ \ :` → `-`、非安全字符 `~XXXX`、**截断到 251 字符**；注释明写 intentionally lossy |
| 会话目录名 | `encodeSegment(id)` | **单射（无损）**：每个非安全码元转义成 `~XXXX`，连孤立代理项都还原得出，抗 `../` 与绝对路径 |

**判据 = "撞了的代价"**：项目名撞了只是两个项目混一个目录（`cwd` 仍在会话头里，仍能区分）；会话 id 撞了是**覆盖别人的会话**。所以项目名可以为了"人能看懂"而牺牲单射性，会话 id 不行。

**顺带解释我们为什么用白名单**：`isValidSessionId` 是**校验后拒绝**，DSH 是**转义后接受**。差别在**谁能决定 id**——我们的 id 出自自家 `generateSessionId()`，白名单够用且更简单；DSH 的 id 是可能来自外部的未校验品牌类型，必须转义。**我们的做法不是偷懒，是够用。**

### 6.4 实测：现在做，只会看到一个项目目录

```
Count  Name
   39  E:\work-space\agent-learn\workspace
```

（现存会话第一行 `cwd` 去重后的结果）

**只有一个值**——`workspaceRoot` 今日是全局单值（`config.paths.workspace`），每个会话创建时写进同一个 cwd。

**结论**：分组的形状现在就能定、也能做，但它**真正的价值要等 C6（工作区选择）**——"一个会话可以属于不同工作目录"先成立，分组才从"多一层目录"变成"多项目隔离"。否则落地那天拉开 `.sessions/` 只看到一个 `--E-work-space-agent-learn-workspace--`，像白做。**分组与 C6 是一对，排期绑一起**（分组是架子，C6 是第一个使用者）。

**好消息**：`cwd` 已经写在会话头里（`{"type":"session","version":1,"id":...,"cwd":"E:\\..."}`），老会话迁得动；分组是**路径**问题、格式演进是**内容**问题，**两者正交，不会因为本项改了格式而白做**。

### 6.5 真实成本（实测，不是估的）

**"会话文件在哪"这件事，仓库里有 4 处各自实现**：

| # | 位置 | 现状 |
|---|---|---|
| 1 | `lib/session/manager.ts:37` `sessionPath(id)` | 正主（list / create / rename / delete 都走它） |
| 2 | `app/api/chat/export/route.ts:25` | **自己拼了一遍** `join(config.paths.sessions, …)` |
| 3 | `app/api/chat/_pipeline/context.ts:45` `createSessionStore` | **又拼了一遍** |
| 4 | `lib/permission/approval-log.ts:41` `approvalLogPath` | 审批侧车（同目录不同后缀） |

分组改动清单：**4 个路径构造点 + `SessionManager.list()` 改两层遍历（`manager.ts:42` 现在只 readdir 一层）+ 2 个测试**（`lib/session/manager.test.ts`、`app/api/chat/_pipeline/approval.test.ts`；`lib/session/store.test.ts` 与 `lib/permission/approval-log.test.ts` 收的是完整路径或 `(dir, id)`、不假设层级，**不受影响**）+ 一次性迁移脚本（53 个会话文件按 header 的 `cwd` 挪目录）。**纯代码量级：半天。**

**⭐ 建议分组开工前先做一件半小时的事**：把 4 处路径构造收成一个模块（如 `lib/session/paths.ts`）。理由不是"为了分组"——它**现在就有 3 处是重复的**，改一处漏一处只是时间问题。收完之后分组退化成"改 1 个模块 + `list()` + 测试"。

### 6.6 A3 的耦合面（已隔离，返工≈0）

`listTraceFiles(traceDir, sessionId)` 收的是**一个目录**，不是布局 → 甲或乙落地时，调用方换个目录传进来即可，**函数与签名都不用改**。这是 A3 详案 §3.1 ① 刻意把它单独拆出来的回报。

**老 154 个 trace 文件无论选甲还是乙都归不到组**（`trace_start` 里没有 `sessionId`，补不回来）——不迁移、不删，读取时解析不出合法会话就跳过。
