# doc/plan/observability —— 可观测性与轨迹（Trace）

> 来源：PLAN.md 第四章（2026-08-26 PLAN 拆解时移入 doc/plan/）。**横切地基**——不是某个阶段的功能，而是贯穿全程的设计；L2 已实现（`lib/trace.ts`），L3 Trace Viewer 排队（A3）。

## 为什么把"轨迹"当作一等公民

这个项目的核心会越来越依赖 AI 生成，失控是迟早的。失控时的第一反应不应该是"猜"，而是"读轨迹"。所以可观测性不是某个阶段的功能，而是贯穿全程的横切地基——**Event Timeline 是实时仪表盘，轨迹（Trace）是黑匣子**。

能不能"追责"到具体一步，取决于三件事：

1. 每个事件有**稳定序号 `seq`** 和**归属 `runId`**，顺序和归属不会被多会话、并发、重试搞乱。
2. 每个关键步骤有**快照 snapshot**（上下文 token、leafId、模型名、工具 I/O、错误堆栈）。
3. 轨迹**持久化且可回放**——离线也能重绘出同样的时间线，把"哪一步开始错"钉死。

## 三层视图（对应三个成熟度）

| 层 | 名字 | 时机 | 内容 | 现状 |
| --- | --- | --- | --- | --- |
| L1 | 实时事件流（Event Timeline） | run 进行中 | 边跑边推的 `AgentEvent` | ✅ 已有 |
| L2 | 持久轨迹（Trace / 黑匣子） | 每次 run 落盘 | `事件 + 快照`，JSONL 追加 | ✅ 已有（`lib/trace.ts`） |
| L3 | 可视化回放（Trace Viewer） | 事后调试/展示 | 按 turn 分泳道、工具调用↔结果配对、token 用量、step 前进 | ⏳ **A3 进行中**（方案已定，见文末补记） |

关键设计：**不动 `types.ts` 里现有的 `AgentEvent`**。轨迹是"事件 + 快照"的一层包装，引擎和前端不用大改，轨迹作为横切层叠加在现有五层之上。这符合"内核稳定、能力外挂"。

## TraceEntry 数据模型（示意）

```ts
// 轨迹条目：包装 AgentEvent，额外带定位和快照信息
type TraceEntry = {
  seq: number;         // 全局递增，决定顺序
  runId: string;       // 本次 run 唯一 id（多会话/并发/重试不串）
  ts: number;          // 墙钟时间
  turn?: number;       // 属于第几轮
  event?: AgentEvent;  // 原有事件（复用 types.ts，不改）
  snapshot?: {         // 每步快照，用于回放/诊断
    contextTokens?: number;
    leafId?: string;
    model?: string;
    toolInput?: unknown;   // 工具入参快照
    toolOutput?: unknown;  // 工具输出快照
    errorStack?: string;
  };
};
```

## 轨迹要回答的调试问题

| 调试问题 | 轨迹里的答案 |
| --- | --- |
| 模型为什么调了这个工具？ | 该 turn 的 assistant 消息 + 工具入参快照 |
| 工具结果为什么是错的？ | 工具 I/O 快照 + 错误堆栈 |
| 上下文为什么爆了？ | 每步 `contextTokens` 快照 + 压缩事件 |
| 哪一步开始偏离预期？ | `seq` 定位 + 回放到该步 |
| 这次和上次有什么不同？ | 两个 `runId` 的轨迹 diff |

## 轨迹落在路线图的哪里

- **Phase 0**：给事件流补 `seq`/`runId`/`ts`，先落盘成最简 JSONL 轨迹（L2 打地基）。✅ 已做
- **Phase 1**：session store 本身就是轨迹的一部分（`id`/`parentId`/`leafId`），此时把"消息轨迹"和"事件轨迹"统一，实现回放。✅ 已做
- **Phase 6**：做 L3 Trace Viewer（参考 pi 的 `export-html`），把轨迹渲染成可读的调试视图。⏳ A3

参考源码：

- pi 事件/遥测：`pi/packages/agent/src/harness/events.ts`、`telemetry.ts`
- pi 会话 JSONL：`pi/packages/agent/src/harness/session/jsonl/{codec,storage,repo}.ts`
- pi 可视化导出：`pi/packages/coding-agent/src/core/export-html/{index,ansi-to-html,tool-renderer}.ts`

## "失控防线"（针对 AI 开发核心会漂移）

| 防线 | 做法 |
| --- | --- |
| 协议即真相 | `types.ts` 是唯一事实源；改协议先改这里并全量 typecheck |
| 轨迹即黑匣子 | 出问题先读轨迹，不靠猜；能回放到"哪一步开始错" |
| 阶段提交 + 测试 | 每个 phase 一次 `git commit`；loop/sessionStore/tools 补单测 |
| 小内核 + 清晰边界 | 内核尽量不改，新能力加在适配层/产品层 |
| 每次 run 独立 runId | 多会话、并发、重试都不串轨迹 |

---

# A3 实现前补记（2026-09-14 定案）

> **参考源**：DSH `packages/client/ui-trajectory`（**我上轮漏找过——"trajectory" 不含 "trace"，正则没命中**）。本文的形态决策基本照抄它，差异单列。

## 0. 需求（用户拍板，2026-09-14）

| # | 决策 |
|---|---|
| a | tab 放**对话列顶部**（与 `nameplate` 一排） |
| b | 切到轨迹 tab，**输入框仍在**（浮层常驻——复用 B17④ 的模式） |
| c | 轨迹**实时跟随尾部**，**向上滚动则暂停**跟随 |
| d | **`trace-rail` 保留组件代码、但页面上不再渲染**（2026-09-14 定：只留回滚能力，不要视觉冗余）；新功能稳定后整体删除代码 |
| e | 当前会话的**多次 run 拼成一条连续时间线**，run 之间加分隔标记 |
| f | **暂不做跨会话**（不做全局 `/traces` 页） |

## 1. 参考：DSH ui-trajectory 是什么

- **位置**：对话视图环（`conversation.view`）里的一个 tab，与 Chat **平级切换** ← 与需求 a 同构
- **形态**：**按轮次组织的事件记录表 + 固定在表上方的交互式时间概览**；每条记录可打开**检查器**（token 用量 / 耗时 / **输入 / 输出** / 图片 / 附件）
- **分组**：user / assistant / tool / 嵌套子工具 / **compaction**，标示轮次与步骤边界
- **长历史的四个处理**（都抄）：
  1. 打开时**定位到尾部**，向上**按需分页**加载更早
  2. **只渲染可见行**（虚拟滚动；初始只从尾部 50 个 Node 派生）
  3. 流式**跟随尾部**，向上滚动则暂停
  4. **进行中的记录只显示开始标记，不虚构耗时** ← 杜绝假数据
- **纯投影**：从共享会话窗口组装记录，**不读也不改** Chat 的快照

### 我们与 DSH 的硬差异（决定实现）

| | DSH | 我们 |
|---|---|---|
| 会话数据 | **一条连续日志** | **一个 run 一个 trace 文件** |
| 事件来源 | `session-projection`（增量折叠 + 持久缓存） | `readTrace()` 逐行读文件 |
| 后果 | Trajectory 直接投影即可 | **必须跨文件聚合 + 造会话级坐标** |

## 2. 抄什么 / 不抄什么

| ✅ 抄 | ❌ 不抄（为什么） |
|---|---|
| tab 形态（与 Chat 平级切换） | cordis DI seam + 提供方二件套（我们没 50 个包） |
| `turn_start.seq` 当**跳转锚点**（session-turn-outline） | SQLite 全文索引（用不上） |
| **有界窗口读取**（`readEvent{seq, before, after}`） | wire 整值推送 + `session-projection-cache`（我们按需读文件） |
| 预览**封顶**（prompt 50 / response 120 字符） | 嵌套子工具（我们没 subagent） |
| **虚拟行**（只渲染可见） | 时间概览的 TTFT/解码时间细分（太细，二期） |
| 跟随尾部 + 滚动暂停 | 会话谱系 lineage（我们没 fork） |
| 进行中不虚构耗时 | session-telemetry-otel（那是 C5） |
| **surface 三态**（current / shadowed / log-only） | |

## 3. 我们的设计

### 3.1 数据层（三处改动）

**① 轨迹文件按会话归属（本方案的地基，2026-09-14 用户拍板）**

现状：`.traces/run_<时间戳>_<随机>.jsonl`——**一个 run 一个文件，而且文件里没有任何字段说明它属于哪个会话**（实测现有 154 个文件的 `trace_start` 只有 `runId` / `model` / `ts`）。所以"打开某个会话的轨迹"今天**不是慢，是不存在**：没有任何索引能回答"这个 run 是谁的"。

**形状 = 方案 C：`.traces/<sessionId>.<runId>.jsonl`**

- 沿用项目**既有约定**：同一会话的兄弟文件用**文件名**表达，不是目录。先例就在隔壁——`.sessions/<sessionId>.jsonl` + `.sessions/<sessionId>.approval.jsonl`（B1 审批日志）
- **列某会话的轨迹 = `readdir` + 前缀过滤 → 0 次文件内容读取**（.traces 现在 154 文件 / 25MB / 单个最大 1.15MB，逐个读头是不可接受的）
- `isValidSessionId` = `/^[a-zA-Z0-9_-]+$/` **不含 `.`**，所以"首个 `.` 之前"就是会话 id，解析无歧义
- **一个 run 一个文件 → 单文件不会无界增长**（上限就是单次 run 的量级），验收标准里"打开 877KB 不卡"才是按正确上限估的

**为什么不选方案 B（`.traces/<sessionId>/<runId>.jsonl`）**：给 trace 引入一个**会话层自己都没有的目录层级**（`.sessions/` 平铺、53 个文件、0 个子目录），会让"同会话文件族"出现两种心智模型。

**为什么不选方案 D（`.traces/<sessionId>.jsonl`，一个会话一个文件）**：它跟 `.sessions/<sessionId>.jsonl` 完全同名同构、最"对称"（DSH 正是这个形状——它的"轨迹"就是会话日志本身，所以根本不需要"run 属于谁"这个绑定），但它把 `.sessions/` 那个**正在被 C18 诊断为待修**的形状（单文件只追加、无界增长）又复制一层到 trace 上。**在准备修的病的形状上再盖一层，不合适。**

**⭐ 不在 `trace_start` 里加 `sessionId` 字段（有意为之）**：文件名已经是唯一真相，再加一个字段就是**第二个真相**，两者可能漂移——这个项目已经栽过两次同类跟头（`header.version` 从不被读、`TraceSnapshot` 无人传），教训是"**结构不会忘，字段会忘**"。归属用**文件名**（结构）表达，runId 仍在 `trace_start` 里（本来就有）——这样 `readdir` 拿会话、读首行拿 runId，两边各有一份真相、互不重复。

**⚠️ 与"按工作目录分组"的关系（2026-09-14 用户指出："会话也没分组，你现在开始 trace 分组了"）**：分组是**路径**问题、C18 是**文件内容**问题，**两者正交**，不会因为 C18 改了格式而白做；分组所需的 `cwd` **现成写在会话文件头里**（`{"type":"session","version":1,"id":...,"cwd":"E:\\..."}`），老会话也迁移得动。**分组迟早要做（用户定），但排在 A3 之后、并进 C18 的 A 档**（理由：C18 A 档本来就是"`list()` 只读文件头"，跟分组要"列目录 + 读头拿 cwd"是同一段代码，改两次不如改一次）。分组落地后本层形状变成 `.traces/<project>/<sessionId>.<runId>.jsonl`。

**⭐ A3 与路径布局的耦合面：只有一处**。把 A3 的每层过一遍——折叠层收 `TraceRun[]`、`TraceRecorder` 的目录由调用方传入、视图收 `TraceFold`、tab 接线只是切显示，**全都与布局无关**；唯一受影响的是"给定 sessionId 找到它的轨迹文件"。所以先做完 A3 不会白做，**但那个函数要单独放成 `lib/trace-files.ts`**——这不是为分组预挖参数（那是"预挖空壳"），而是它本身就是一个内聚单元（会话 → 轨迹文件），分组时只改它的内部实现、签名不变。

**①-b 调用点**：`TraceRecorder.create(dir, model)` 的 `dir` 由 `_pipeline/context.ts:63` 传入，改成传**文件基底名**（或把 sessionId 一起传进去拼文件名）。`sessionId` 在 `createRequestContext(params)` 里已经在手，**一行透传**。不碰红线（红线是 `lib/agent/index.ts`）。

**② 两层读取（性能关键）**

| 函数 | 读什么 | 用途 |
|---|---|---|
| `readTraceMeta(filePath)`（新） | **首行 + 尾行**（首行：runId / model / ts；尾行：是否是 `trace_end`） | 列表与聚合，**不解析全部** |
| `readTrace(filePath)`（已有，不动） | 全部条目 | 详情回放 |
| `readTraceWindow(filePath, fromSeq, count)`（新，可选） | 某 seq 窗口 | 按需加载某一轮 |

> ⚠️ **`readTrace()` 会跳过 `trace_start` / `trace_end` 两行元信息**（`lib/trace.ts:121` 的过滤条件）——所以"这个 run 是正常结束还是中途崩了"这个信息**只有读末行才知道**，`readTrace` 给不了。这正是 `readTraceMeta` 存在的理由：**尾行是不是 `trace_end`，就是 run 完整性的判据**（服务崩掉的文件尾部没有 `trace_end`，界面上该标出来而不是假装正常）。
>
> 实现注意：**"只读首末行"不等于 `readFile` 后 `split("\n")[0]`**——那还是把 1MB 全读进来了。要真的只读首末：首行读文件头一小段（~1KB），尾行走 `fstat` 拿 size 再从末尾读一小段。

**③ 会话级坐标（解决多 run seq 重复）**

每个 run 的 `seq` 都从 1 开始 → 拼接后重复。**会话级坐标 = `runIndex:seq`**（或按时间戳排序后编 `globalSeq`），跳转/选中都用它。

### 3.2 视图层

```
对话列顶部：[ 对话 | 轨迹 ]   ← 新增 tab 状态
├─ 对话 tab → 现有转录稿 + 输入框
└─ 轨迹 tab → 记录表（按轮次分组）+ 顶部时间概览
              └─ 输入框仍在（B17④ 浮层模式）
```

- 记录表：**按 turn 分组**，每组内是记录行（user / assistant / tool / compaction）
- 每条记录可展开看**输入 / 输出原文**
- **只渲染可见行**（虚拟滚动）
- 实时跟随尾部；向上滚动暂停
- surface 标记：`current`（在模型上下文里）/ `shadowed`（被压缩替换）/ `log-only`

### 3.3 新代码 / 删除清单

| 动作 | 路径 |
|---|---|
| **新增** | `lib/trace.ts` 扩展（sessionId + meta + window） |
| **新增** | `lib/trace-files.ts`（**会话 → 轨迹文件的唯一耦合点**：`readdir` + 前缀过滤列出某会话的轨迹；分组落地时只改它的内部实现） |
| **新增** | `app/api/traces/route.ts`（按 sessionId 列 run 的 meta） |
| **新增** | `app/api/traces/[runId]/route.ts`（读一个 run 的 entries/window） |
| **新增** | `app/lib/trace-steps/`（纯函数：`TraceEntry[]` → 记录 + 大纲 + 会话级坐标）**← 单测挂这里**（`index.ts` + `index.test.ts`，AGENTS.md 6.5 硬规则） |
| **新增** | `app/components/trace-viewer/`（记录表 + 时间概览 + 检查器） |
| **删除（阶段 1 就做）** | `TraceSnapshot` 死类型（`lib/trace.ts`）+ 详案里的对应段落 |
| **保留代码 / 断开接线（阶段 1）** | `app/components/trace-rail/`（整目录）+ `app/lib/trace-fold.ts` **文件留在仓库**，但从 `page.tsx` **移除渲染与它专属的接线**（`import` / `<TraceRail>` / `rows` useMemo / `traceRef` / 吸附滚动）——留作**回滚能力**，不占页面 |
| **整体删除（阶段 2：新功能稳定后）** | 上面两个文件一起删，**不拆散** |
| **修改** | `lib/trace.ts`（文件名带会话前缀）、`_pipeline/context.ts`（透传 sessionId 拼文件名）、`app/page.tsx`（tab 状态 + 换组件）、`globals.css`（注释） |

> **为什么删 `TraceSnapshot`**：事件协议里**早就有** `tool_execution_start.args` / `tool_execution_end.result` / `tool_permission.*` / `message.usage` / `compaction.*`——快照字段是**过度设计**（提前设计了，结果没人用）。这是个教学点。

## 4. "能定位"要做成一等功能（对应掌握度考核）

课程表的考核是"**拿一个 `.traces/*.jsonl`，不看代码说出哪一步开始错**"。所以：

1. 出错记录（`isError` / 审批拦截）**标红**
2. **「跳到下一个错误」**（同编译器的"下一个错误"）
3. 每条记录展开看**输入 / 输出原文**（这是找出"入参就已经错了"的唯一途径——对话界面看不到工具参数）
4. 抄 `session-query` 的 **`traceEvent` 事件关系**：`replacedBy` / `replacementChain` → **压缩的替换链**（旧消息被摘要替换，能追出来）
5. **run 级失败也要落盘**（2026-09-14 施工中发现并接上）：`app/api/chat/route.ts` 的 `catch` 原来**只把错误发给 SSE、不记轨迹**；而 `finally` 无论如何都会执行 → 仍然写 `trace_end` → **崩掉的 run 和跑成功的 run 在轨迹文件里长得一模一样**，而 `runPipeline` 自己没有 try/catch（`_pipeline/` 只 `recorder.record(AgentEvent)`），所以抛异常型失败在轨迹里**零痕迹**。修法 3 行：`let runError` → catch 里记下 → `recorder.end({ messages, error: runError })`（`JSON.stringify` 丢掉 `undefined` 的键，正常收尾不会多出字段）。
   - **⚠️ 两个语义必须分开**：`completed` = **文件写完了**（末行是不是 `trace_end`）；`summary.error` = **这次运行跑得怎么样**。崩掉的 run 是 "**`completed: true` + `error: "..."`**"——文件的完整性没问题，是这次运行失败了。不要把它们混成一个"状态"。
   - 顺带：这 3 行让 `TraceMeta.summary.error` 从"**预留字段**"变成有使用路径的字段——否则本次提交就等于又造了一个 `header.version` / `TraceSnapshot`（同类病：写了、没人保证它对）。

## 5. 验收标准

| # | 验收 |
|---|---|
| 1 | 顶部两个 tab 可来回切换；轨迹 tab 下输入框仍在且可发消息 |
| 2 | 轨迹只显示当前会话；多次 run **按时间连成一条**且 run 之间有分隔 |
| 3 | 能按 turn 前进/后退；工具调用与结果**配对**展示 |
| 4 | 每条记录可见 **token / 耗时 / 输入 / 输出** |
| 5 | **打开 877KB 轨迹不卡**（只渲染可见行） |
| 6 | 跑动中切到轨迹 tab 能实时跟随；向上滚动即暂停 |
| 7 | 错误记录标红 + 可跳到下一个错误 |
| 8 | `TraceSnapshot` 已删除；**页面上不再出现 `trace-rail`**（文件仍在仓库）；接线清理干净、无残留未使用变量 |

**回归**：`tsc --noEmit` + `pnpm test`（沙箱内 vitest 不可用，需本地跑）。

## 6. 风险 / 待定

- ~~**会话级坐标的具体形式**~~ ✅ **已定并落地**：`runIndex:seq`（`app/lib/trace-steps/index.ts`，12 用例覆盖跨 run 唯一 + 排序）；`globalSeq` 重编号方案不采用——它需要先把所有 run 读全才能编号，与"列表不读内容"直接冲突
- **⚠️ 归属不写进字段、只写进文件名**（2026-09-14 定）：代价是**文件被单独拷走就丢了会话归属**。接受——调试黑盒本来就是"要拷就带着 runId（首行有）回去找原文件"；换来的是不出现"文件名与字段两个真相"。**若将来改主意，这是唯一要翻的决策点**
- **⚠️ `readTraceMeta` 的"只读首末行"必须真的只读首末行**：`readFile` + `split("\n")[0]` 是最容易写出的假实现（1MB 还是全读进来了）。首行走文件头 ~1KB、尾行走 `fstat` + 从末尾读——这两步要单独测
- **老 154 个 trace 文件归不到会话**（`trace_start` 里没有 sessionId，且**补不回来**）：不迁移、不删，读取时"文件名解析不出合法 sessionId 就跳过"。**不是选型变量**（A/B/C/D 四种方案下都一样）
- **时间概览（Overview）一期做不做**：DSH 的是一条可拖选/缩放的时间轴。建议**一期先不做**，先出"记录表 + 检查器"，概览二期
- **`trace-rail` 的回滚路径**（2026-09-14 用户定"代码保留、页面不展示"）：文件留在仓库，恢复 = 重接 `page.tsx` 那几行（组件 API 未变，git 历史里有原接线）。**代价**：仓库里会有一段时间的"未使用组件"——靠**阶段 2 整体删除**收口，别忘了
- **沙箱限制**：vitest 跑不了（vite 8 spawn 触发命名管道 EPERM），单测写完需本地跑
