# C6 / C48 / C49 / C50 · 工作空间（详细设计 + 验收）

> **状态在 `PLAN.md` 那四格 —— 本文件不写状态。**
> **素材来源**：用户 2026-11-10 定项（「用户可以自己选择文件夹作为工作空间；存储按乙方案；列表按工作空间分组；数据根 `~/.statve`」）+ 本机实读（file:line 见下）+ **DSH 一手源码**（`E:\agents-read\deepseek-harness`，2026-11-10 实读，每条带位置）+ `doc/plan/session-compaction-refactor.md` 的「按工作目录分组」（2026-09-14 的材料）。

---

## 一、需求（池子行原文）

| ID | 一句话 |
|---|---|
| **C6** | **新增工作空间**：应用内目录浏览器（列目录 / 新建文件夹 / 面包屑 / 可手输路径）选一个文件夹，它成为一条**工作空间记录**。**每个会话都必须挂在一个已登记的工作空间下才能建。** |
| **C51** | **工作空间管理**：侧栏按工作空间分组，**每个组头直接新建会话**；组头菜单 = **重命名 / 打开文件夹 / 删除工作空间** |
| **C48** | **会话存储按工作空间分组**（乙）：`<数据根>/sessions/<工作空间键>/<会话 id>/`，主日志 / 轨迹**同住一目录**（审批侧车由 C52 删除，不再有第三个文件）；删会话 = 删目录 |
| **C49** | **会话列表按工作空间分组显示**：组标题 = 工作空间显示名，组内按最近活跃排 |
| **C50** | **全局数据根 `~/.statve`**：sessions / workspaces.json /（未来）mcp 都住这里；资源读取顺序 **项目·statve > 项目·agents > 用户·statve > 用户·agents** |

---

## 二、依据（只留写设计要用的，其余在旧详案）

### 2.1 现状（2026-11-10 实读，带位置）

| 事实 | 位置 |
|---|---|
| 会话 = **平铺文件** `.sessions/<id>.jsonl` | `lib/session/manager/index.ts:46-48` |
| `list()` 只扫一层，认 `<合法 id>.jsonl` | `lib/session/manager/index.ts:51-71` |
| `delete()` = 删主文件 + 审批侧车（**不删目录、不删轨迹**）；⚠️ 侧车本身在 **C52** 里被删除 | `lib/session/manager/index.ts:119-133` |
| 摘要**没有 `cwd`**：`id / title / updatedAt / preview` | `lib/session/manager/index.ts:30-37` · `app/services/sessions/types.ts:9-15` |
| `cwd` 已写在会话头 | 写入 `lib/session/store/index.ts:368`；类型 `lib/types.ts` 的 `SessionEntry` |
| **工作空间是模块级常量**：`SessionManager` 单例 | `app/api/sessions/route.ts:28-31` |
| **`toolContext` 也是模块级常量**（文件注释已预判："不挪 = 第一个请求的工作区被所有会话共用，不报错、只静默串味"） | `app/api/chat/_pipeline/context.ts:24-33` |
| 技能根**只有一个**（用户级 `~/.agents/skills`），且明确"这一版不做分层" | `lib/config/index.ts:131-138` · 决策见 `doc/plan/c8-skills.md` |
| 轨迹 = 独立根，一个 run 一个文件 `<sessionId>.<runId>.jsonl` | `lib/config/index.ts:127` · `lib/trace/index.ts:109-117` |

### 2.2 「会话文件在哪」现在有 5 处各自拼（**C52 之后剩 4 处**）

| # | 位置 |
|---|---|
| 1 | `lib/session/manager/index.ts:47`（正主） |
| 2 | `app/api/chat/export/route.ts:26` |
| 3 | `app/api/chat/_pipeline/context.ts:65`（`createSessionStore`） |
| 4 | `lib/permission/approval-log/index.ts:41`（侧车；**C52 会把这个模块整个删掉**） |
| 5 | `lib/trace/index.ts:117`（轨迹文件名） |

漏改不会报错，只会**静默少东西**（导出 404 / 审批写丢 / 轨迹散落）。

### 2.3 DSH 的一手对照（可抄的三样）

| 决策 | DSH 怎么做 | 位置 |
|---|---|---|
| 项目键编码 | 分隔符 `/ \ :` 连串压成 `-`；`[A-Za-z0-9._-]` 保留；其余 `~XXXX`（四位十六进制）；去前导 `-`，空则 `root`；截 251 字；包成 `--…--`。**明确"有损"**（human-navigable） | `session-persistence-jsonl/src/format.ts:225-245` |
| 会话 id 编码 | `encodeSegment` **单射**（无损）——撞了就是覆盖别人的会话 | 同文件；判据见旧详案 §6.3 |
| 无 `cwd` 的会话 | 落到 `_no-cwd` 目录，**不猜不补** | `format.ts:254-256` |
| 数据根 | **必填、无默认**（原话：`process.cwd()` 默认值会随进程 cwd 变更而分散会话文件） | `session-persistence-jsonl/src/index.ts:99-102` |
| 会话目录语义 | 一个会话一个目录，注释写明 **"available for future session-local artifacts"** | `format.ts:259-269` |
| 家目录 | `~/.dsh`（`DSH_HOME` 可覆盖） | `docs/config-catalog.zh.md:400,848,3360,3397` |
| 目录浏览后端 | `list(path?)` 单层/只目录/按名排序/`hidden` 标记/`home` 锚点/`crumbs`/`maxEntries=1000`+`truncated`；`createDirectory(path,name)` **不递归**、`name` 只能是一段 | `packages/host/directory-picker-browse/README.zh.md` |
| 目录浏览安全 | **完全限定路径栅栏**：只收 `C:\…` 或完整 UNC；拒相对路径、拒 `\foo`/`/foo`（无盘符有根形态） | 同上「完全限定栅栏」节 |
| 目录浏览为何敢不限根 | 它是**人**在点；模型拿不到这个能力；模型的约束来自沙箱策略 | 同上 + `docs/subsystems/sandbox.zh.md:43` |

---

## 三、决策清单（已拍板；每条一句理由）

| # | 决策 | 理由 |
|---|---|---|
| 1 | 数据根 = `~/.statve`（`STATVE_HOME` 可覆盖） | 应用数据与用户项目分离；对齐 DSH `~/.dsh` |
| 2 | 会话呈**乙**布局；轨迹住会话目录 | 删会话 = 删目录；孤儿由结构灭掉 |
| 3 | **轨迹不并进 `session.jsonl`** | 轨迹是"事件 + 定位"（`seq/ts/turn`、`tool_permission` 改写前后参数、耗时），会话日志是"模型上下文"；一个 run 一个文件才能保证**有界**（轨迹单文件已到 1.15MB，会话最大 124KB） |
| 4 | **每个会话必须先选工作空间** | "没选工作空间的新会话"这个状态不存在 ⇒ 归属不明类 bug 消失 |
| 5 | 围栏根 = 会话头 `cwd`（每请求取值） | 引擎不关心目录，只有工具需要；常量会静默串味 |
| 6 | 越界 = **危险操作审批**，且**不记忆** | 人有权放行一次，但"永久信任越界"不该存在 |
| 7 | 资源四层优先级，**同 key 覆盖不合并** | 合并会让"这技能哪来的"不可答 |
| 8 | 老会话**全删**，不写迁移 | 用户定：不留历史包袱 |
| 9 | 项目级 `.statve`/`.agents` **只读，不自动创建** | 那是用户的目录；应用不该往里写 |
| 10 | v1 目录浏览器 = **列表 + 面包屑 + 手输路径 + 新建文件夹**（不做 Miller 分栏） | 分栏是视觉设计，先过 `frontend-design`；DSH 的分栏是它的产品选择，不是我们的必需 |
| 11 | **工作空间是一条记录**（id + path + title），不是"从会话 `cwd` 推导出来的分组" | 只有"有记录"才能重命名 / 删除 / 打开文件夹（UI 稿已拍板：组头带菜单） |
| 12 | **重命名只改显示名**，不动磁盘文件夹 | 显示名是给眼睛的、文件夹名是给系统的；改真文件夹会让编辑器/终端/git 工作树引用全部失效 |
| 13 | **删除工作空间只删记录**，会话留在磁盘 → 归入「未登记的工作空间」组 | 删除一条**记录**不该等于删数据；真要删会话有单独的入口 |
| 14 | **同名工作空间允许存在**，靠重命名区分（不靠路径） | 侧栏明确不显示路径（用户定）；同名是"两个 src"的现实，用 title 解决 |
| 15 | **打开文件夹 = 服务端 `explorer.exe <path>`**，只收已登记 id、只给人用 | 本地应用本来就在用户机器上跑；模型拿不到这个接口（同目录浏览器的安全立场） |
| 16 | **删掉 `approval.jsonl`**（C52） | 审批决策已经逐条写进轨迹（`lib/agent/index.ts:271` 发 `tool_permission` 事件）；而侧车**只有人写、没人读**（`loadApprovalReceipts` 的调用者只有测试）⇒ 保留等于多一个文件、一条路径、一套 141 行模块陪跑 |
| 17 | **删 `paths.traces` / `TRACE_DIR`**（2026-11-11 用户定） | 轨迹住会话目录后，"全局轨迹根"这个概念不存在了 |
| 18 | **删 `paths.skillsRoot` / `SKILLS_ROOT`** | 技能改四层解析函数（4.8），测试直接传参，不靠环境变量 |
| 19 | **删 `paths.workspace`** | 它是"模块级常量串味"的根源；工作空间只从会话头来 |

---

## 四、详细设计

### 4.0 全景

```
                    ┌─────────────── 用户界面 ───────────────┐
  选工作空间 ──────▶│ 目录浏览器（C6）  侧栏分组（C49）      │
                    └───────┬───────────────────┬───────────┘
                            │ POST /api/sessions │ GET /api/sessions
                            ▼                    ▼
                   workspace 必填          分组键 = cwd
                            │
        ┌───────────────────┴────────────────────┐
        │ 会话层 lib/session                      │
        │  paths（唯一的路径拼法）                │
        │  manager（create/list/rename/delete）   │
        └───────┬──────────────────┬─────────────┘
                │                  │
        ┌───────▼───────┐   ┌──────▼────────────┐
        │ 数据根         │   │ 请求上下文         │
        │ ~/.statve      │   │ cwd → ToolContext │
        │ sessions/…     │   │ → 围栏根（C6/C48）│
        └───────┬───────┘   └──────┬────────────┘
                │                  │
      <键>/<id>/session.jsonl  工具层（文件/bash）
               trace.<runId>.jsonl  │ 越界 → 审批（4.6）
                                    ▼
```

### 4.1 数据根与目录布局

```
C:\Users\<用户>\.statve\                 ← STATVE_HOME（默认 homedir()/.statve）
└─ sessions\                             ← 会话根（唯一）
   ├─ --E-work-space-my-proj--\          ← 项目键（projectKey(cwd)，有损、可读）
   │  └─ s_2026-11-10T02-11-33-123z_a1b2c3\   ← 会话目录（encodeSegment：无损、单射）
   │     ├─ session.jsonl                ← 会话（模型上下文）
   │     └─ trace.<runId>.jsonl          ← 轨迹（一个 run 一个文件）
   └─ _no-cwd\                           ← 防御位：读到没有 cwd 的坏数据才落这（正常不出现）
```

**`projectKey(cwd)` 算法（照抄 DSH `format.ts:225-245`）**：

1. 分隔符 `/ \ :` 连续出现只保留**一个** `-`
2. `[A-Za-z0-9._-]` 原样保留；`~` 与其它字符转义成 `~XXXX`（码元十六进制、四位大写）
3. 去掉开头的 `-`；结果为空用 `root`
4. 截断到 251 字符，外面包 `--…--`

示例：`E:\work-space\my-proj` → `--E-work-space-my-proj--`

**为什么项目段可以有损、会话段不行**：项目段撞了只是两个项目混一个目录，**`cwd` 仍在会话头里，区分得开**；会话 id 撞了 = **覆盖别人的会话**。判据是"撞了的代价"。

⚠️ **截断撞名的已知风险**：两个路径前 251 字相同 → 同键。**接受**（DSH 同款取舍），但要在会话头保留 `cwd` 原值作为唯一身份；验收里有一条用例（两个超长路径同前缀 → 同目录但 `cwd` 不同、仍能区分）。

### 4.2 路径的唯一真相：`lib/session/paths/index.ts`

把 2.2 的拼法（**C52 之后 4 处**）**全部收进一个模块**（新模块，纯函数、无 IO、node 可测）：

```ts
export function projectKey(cwd: string): string
export function projectDir(root: string, cwd: string | undefined): string
export function sessionDir(root: string, cwd: string | undefined, id: string): string
export function sessionLogPath(root: string, cwd: string | undefined, id: string): string   // <sessionDir>/session.jsonl
export function tracePath(root: string, cwd: string | undefined, id: string, runId: string): string // <sessionDir>/trace.<runId>.jsonl
export function encodeSegment(id: string): string   // 单射
export function isValidSessionId(id: string): boolean
```

- **调用方不许再 `join(...)` 拼会话路径**：`SessionManager`、`export/route.ts`、`_pipeline/context.ts`、`TraceRecorder` 全部改成调这里。
- ⚠️ **C52 删掉 `lib/permission/approval-log` 之后**，这一层少一个调用方；删它之前，`approvalLogPath` 仍由本模块提供。
- 轨迹文件名**去掉了 `sessionId` 前缀**：归属由**目录**保证，文件名只承载 `runId`（"结构不会忘，字段会忘"的同一课）。

### 4.2b 工作空间注册表（C51）

```ts
// lib/workspace/index.ts
export type Workspace = {
  id: string          // uuid；**永不用路径当 id**（路径会被规范化重写，引用锚点必须稳定）
  path: string        // canonical realpath：软链、尾斜杠、`..` 全解析
  title: string       // 显示名，默认 = path 最后一段；重名允许
  createdAt: string
  updatedAt: string
}
```

- **存储**：`<数据根>/workspaces.json`；写用**临时文件 + rename**（同 `manager.rename` 的理由：dev server 反复重启，进程被杀在中途会把 json 截断）。实际内容长这样：

```json
{
  "version": 1,
  "workspaces": [
    { "id": "6f1c8a0e-…", "path": "E:\\work-space\\agent-learn\\workspace",
      "title": "workspace", "createdAt": "2026-11-10T06:20:11Z", "updatedAt": "2026-11-10T06:20:11Z" },
    { "id": "9a02d4b1-…", "path": "D:\\work\\my-proj",
      "title": "my-proj", "createdAt": "2026-11-10T07:02:55Z", "updatedAt": "2026-11-10T07:02:55Z" }
  ]
}
```

  ⚠️ **里面一条会话都没有**。会话列表永远从 `sessions/` 目录扫出来；注册表只在**新增 / 改名 / 删除工作空间**时被写 —— **新建会话不写注册表**（它只是把 `path` 抄进会话头）。
- **可重建**：注册表丢了不致命 —— 启动时扫一遍会话头，把没登记过的 `cwd` 补成记录（标题 = 末段名）。这正是 DSH 的 bootstrap（`packages/workspace/workspace/src/index.ts:634-700` 的 `BootstrapGroup`）。最坏损失是**手工改过的名字**。
- **唯一性**：以 `path` 的 canonical 字符串为唯一键（同一个文件夹不能登记两次）⇒ 重复登记返回 409
- **会话归属**：**不另存 `workspaceId`**，仍靠会话头 `cwd` 与记录 `path` 比对 —— 少一个会漂的字段（本项目已经栽过两次"结构不会忘，字段会忘"）
- **未登记的工作空间**：磁盘上有会话，但 `cwd` 不在注册表里（删过记录 / 手工放进去的旧会话）⇒ 列表里归到「未登记」组，**仍可打开文件夹、仍可在里面新建会话**

### 4.2c 建会话：`workspaceId` 必填

```ts
// POST /api/sessions
{ workspaceId: string, title?: string }   // 成功 → { id: string }
```

1. 取注册表记录；**不存在 → 404**（"工作空间不存在"）
2. `realpath(record.path)` 复核：目录**还在**吗 → 不在则 **409**（"这个工作空间对应的文件夹不见了"），**不自动重建、不改登记**
3. 会话头 `cwd` 写 **canonical path**
4. `sessionDir(root, cwd, id)` 落盘：**先写到临时目录** `<id>.tmp-<rand>/，头写成功后再 `rename` 成 `<id>/`**（同 `manager.rename` 的原子性理由：半创建的会话目录 = 列表里一个"打不开的会话"）

**没有默认值**：不传 `workspaceId` = 400。⇒ "不属于任何工作空间的会话"这个状态**不存在**。

### 4.2d 工作空间管理 API（只给人用，不进工具清单）

| 方法 | 路径 | 入参 | 行为 |
|---|---|---|---|
| GET | `/api/workspaces` | — | 全部记录（按 `updatedAt` 倒序） |
| POST | `/api/workspaces` | `{ path }` | canonical 校验 → 建记录（`title` = 末段）→ 409 若已存在 |
| PATCH | `/api/workspaces` | `{ id, title }` | **只改显示名**；空串 400；重名允许 |
| DELETE | `/api/workspaces?id=` | — | **只删记录**；返回 `{ ok: true, unregisteredSessions: n }` 让界面能说"还有 n 个会话归到未登记组" |
| POST | `/api/workspaces/open` | `{ id }` | 服务端 `explorer.exe <path>`（见 4.7b） |

`path` 一律先过 `isFullyQualifiedPath`（4.7 的那个栅栏）+ `realpath` 必须是目录。

### 4.3 会话创建：`workspace` 必填

（已由 **4.2c** 取代：入参从裸路径改为 `workspaceId` —— 路径只允许来自登记表，界面不需要也不应该自己拼路径。）

### 4.4 列表与分组

`GET /api/sessions` 返回形状**只加一个字段**：

```ts
type SessionSummary = { id: string; title?: string; updatedAt: number; preview?: string; cwd: string }
```

`list()` 的实现：`readdir(root)` → 每个项目目录 → `readdir(projectDir)` → 每个会话目录 → 读 `session.jsonl` 头 + 首条 user 消息（现有逻辑不变，只是多走一层目录）。**坏目录跳过、不挂整个列表**（保持现有 `summarizeSessionFile` 的语义）。

**分组是纯函数**（`app/lib/session-groups/index.ts`，node 可测、不碰 React）：

```ts
export type SessionGroup = {
  key: string            // workspace.path（未登记组用 ""）
  title: string          // workspace.title（未登记组用「未登记的工作空间」）
  workspaceId?: string   // 未登记组没有
  sessions: SessionSummary[]
}
export function groupSessions(sessions: SessionSummary[], workspaces: Workspace[]): SessionGroup[]
```

规则（每条都要有单测）：

1. 会话按 `cwd` 匹配 `workspace.path` 归组；匹配不到（或 `cwd === ""`）归**未登记组**
2. 组的顺序 = `workspaces.updatedAt` 倒序；**未登记组永远排最后**
3. 组内按 `updatedAt` 倒序
4. 标题直接取 `workspace.title`（**不显示路径**）；同名允许 —— 界面上就是两个同名组，靠重命名区分
5. **组头始终显示**（它带 新建 / 重命名 / 打开 / 删除 四个动作；"只有一个组就隐藏"的规则作废）
6. 空工作空间显示一行虚线入口 `＋ 在这里开第一个会话`
7. **每个组先渲染 5 条**（按 `updatedAt` 倒序取前 5），下面一行 `展开其余 N 个`；展开状态**只存在界面**、不落盘；组内不足 6 条时这一行不出现

### 4.5 围栏根：从模块常量变成请求参数

**删掉** `app/api/chat/_pipeline/context.ts:30-33` 的 `toolContext` 常量，改成工厂：

```ts
export function createToolContext(params: { workspaceRoot: string; skillsRoots: string[] }): ToolContext
```

改动点（按依赖顺序）：

| 文件 | 改什么 |
|---|---|
| `_pipeline/context.ts` | 删常量；`createRequestContext` 里**读会话头拿 cwd** → `createToolContext`；`createSessionStore` 也要 cwd |
| `app/api/chat/route.ts:114` | 传入 `workspaceRoot` 改为"从会话头读" |
| `app/api/chat/commands/route.ts`（`GET /api/chat/commands`） | 现在也吃 `toolContext` → 改成按 `sessionId` 读头取 cwd；**必须带 `sessionId`，没有就 400**（技能清单依赖会话的工作空间，没有它无法回答） |
| `lib/tools/index.ts` | 工厂签名**不变**（仍收 `workspaceRoot: string`）；`skillsRoot` → `skillsRoots: string[]`（见 4.8） |

⚠️ **一条硬性不变量（要写成测试）**：`ToolContext` **不许**出现在模块作用域。做法是给它加一条"谁能 new"的纪律 + 一条跨会话测试（两个不同 cwd 的会话交叉请求，断言各自的工具根不同）。这条测试是**防回归**的，不是防现在的 bug —— 现在还没串，是因为只有一处`toolContext`。

### 4.6 越界 → 危险操作审批

今天：`resolveInsideWorkspace` 越界**直接抛错**（`lib/tools/path-utils/index.ts:21-46`）。改成**先问人**。

**① 分类（纯函数，新文件 `app/lib/tool-escape/index.ts`）**

```ts
export type EscapeClass = { kind: "inside" } | { kind: "outside"; targets: string[] }
export function classifyEscape(call: ToolCallContent, workspaceRoot: string): EscapeClass
```

- 覆盖带路径参数的工具：`read_file`/`write_file`/`edit_file`/`delete_file`/`grep`/`find`/`list_files`（取各自路径参数名；`list_files` 缺参按 `.`）
- 解析用 `resolve(workspaceRoot, input)`（**不**抛错，只判内外）
- `bash`：**不做静态越界判定、不拒绝**（命令里的路径靠解析必然骗人：引号、变量、管道）。改的是**自动放行的口子**：`isReadOnlyBash` 目前对只读命令直接放行（`_pipeline/approval/index.ts:118-125`）—— 于是 `Get-Content C:\Users\…\.env` 会被静默放行。新增一条粗筛：只读命令文本里出现**别的盘符 / `..` / `~` / UNC** ⇒ **不再自动放行，转为弹框**（一行提示"这条命令可能读到工作空间之外"），**批准即执行**（宽松，不拦）。这条粗筛**只影响提示、不影响能否执行**
- `write_note` 等不碰工作空间的工具：`inside`

**② 决策（接进现有纯函数 `decideToolCall`）**

在 `_pipeline/approval/index.ts` 里，**在 `blockSecretWrite` 之后、模式分支之前**插入：

| 审批模式 | 越界时 |
|---|---|
| `bypass` | **block**（理由："这次不问你" ⇒ 答案是"不行"；越界不是便利问题） |
| `never` | **block**（现有语义已是"需确认的一律拒绝"） |
| `suggest` | **request**，帧里带 `danger: { kind: "outside-workspace", targets }` |

⇒ **越界 = 升级成"更危险的弹框"**，不是"放行"。

**③ 放行需要一次性通行证**

问题：批准了，工具里的 `resolveInsideWorkspace` 还会抛错。所以加**每请求一份**的放行表：

```ts
export type EscapePermits = { grant(targets: string[]): void; consume(target: string): boolean }
```

- 只由 `approve` 路由在**人确认后**调用 `grant`
- 围栏：`resolveInsideWorkspace` 先查 `consume(target)`，命中才放行，且**一条只能用一次**
- **不记忆**：不写 `approval-memory` 的会话记忆，不写 `approval-log` 的持久规则 —— 下一次同一条越界还会弹
- 单测：`grant` 一次 → 第一次 `consume` true、第二次 false

**④ 界面**：`tool_permission_request` 帧加 `danger` → 弹框用危险样式、列出**绝对路径**、按钮文案「仍要执行」。不新增一套弹框，复用 B1 的审批面。

### 4.7 目录浏览 API（C6）

两个接口，**只给人用、不进工具清单**（模型看不到）：

```
GET  /api/workspaces/browse?path=<绝对路径>          → 列一层
POST /api/workspaces/browse { path, name }          → 在 path 下建一个子目录
```

`GET` 返回：

```ts
{
  path: string,                 // 当前层（canonical）
  home: string,                 // 家目录锚点
  parent: string | null,        // 上一层（根为 null）
  crumbs: { name: string; path: string }[],   // 根→当前的祖先链，每节可跳
  entries: { name: string; path: string; hidden: boolean }[],
  truncated: boolean            // 超过 maxEntries 时为 true
}
```

规则（每条对着 DSH 的实证）：

| 规则 | 细节 |
|---|---|
| **完全限定路径** | 只收 `C:\…` / 完整 UNC；**拒**相对路径、拒 `\foo` / `/foo`（无盘符有根，`isAbsolute` 会放行但实际解析到当前盘） |
| 默认层 | 不带 `path` → 家目录 |
| **盘符快捷** | 列表顶部一排 `C:\ D:\ E:\ …`（只列真实存在的盘符）—— Windows 上从家目录点不到别的盘，这是必须的出口。⚠️ DSH **没有**这条（它靠 home 锚点 + 面包屑 + 可编辑路径），我们比它多一条 |
| 只列目录 | 不带文件；指向目录的软链跟随，断链/坏链跳过 |
| 排序 | 按名字（**大小写不敏感**比较，稳定 —— DSH 只说按名排序，我们补一条确定性） |
| 上限 | `maxEntries = 1000`，超出置 `truncated: true`（隐藏项也计入） |
| 隐藏项 | 由**后端**标记（Windows：点前缀或隐藏属性），**前端决定是否显示**（v1 默认不显示 + 一个开关） |
| 建目录 | **不递归**；`name` 必须**单段**（不含分隔符、不是 `.`/`..`）；已存在 → 409 |
| 失败 | 统一 `{ error }`；扫到一半失败不返回半截列表（宁可报错） |

⚠️ **为什么可不限根**：这是**人的操作面**，模型没有这个工具；真正约束模型的是 4.5/4.6 的围栏与审批。

### 4.7b 打开文件夹（C51）

```
POST /api/workspaces/open  { id }
```

- 查记录 → 取 `path` → `spawn("explorer.exe", [path], { detached: true, stdio: "ignore" })` 后 `unref()`（不阻塞请求、不拖住 dev server 进程）
- **只收已登记的 id**：不接受任意路径，模型也没有这个工具
- Windows 专属；其它平台返回 **501** 并说明"当前只在 Windows 上实现"
- 目录已被删 → **409**（"文件夹不在了"），不静默成功

### 4.8 资源四层优先级（C50）

```ts
// lib/resources/index.ts（新）
export function resolveResourceRoots(params: { cwd: string; home: string }): string[]
// 顺序：[<cwd>/.statve, <cwd>/.agents, <home>/.statve, <home>/.agents]
```

- **skills**：`loadSkills(roots: string[])` 改多根——**同 name 取第一个命中**，其余忽略；每个 `Skill` 增加 `root` 出处（诊断与界面能说"这技能从哪来"）；不存在的根**静默跳过**，但在 `diagnostics` 里记一条（不吵，但查得到）
- **只读**：我们**绝不**在项目里创建 `.statve` / `.agents`
- **MCP（未来）**：复用同一解析器，不另写一套
- ⚠️ `lib/config/index.ts:131-138` 那条"技能只做一个根"的决策**作废**，按 `AGENTS.md` 第 10 条在 `doc/plan/c8-skills.md` 追加补记（保留原文，注明时间线）

### 4.9 删除语义

```ts
async delete(id: string): Promise<void>   // = rm(sessionDir, { recursive: true, force: true })
```

- 先解析会话目录；**目录不存在** → 抛"会话不存在"（保持现有 404 语义）
- 一次删掉：会话日志 + 全部轨迹（整个会话目录）
- **不做**回收站/软删/撤销（另一个迭代）
- 找不到 `cwd` 的坏会话：按 `_no-cwd` 目录解析，删得到

**删工作空间 ≠ 删会话**（决策 13）：`DELETE /api/workspaces` 只删 `workspaces.json` 里那一条记录；会话目录**一个字节不动**，下一次列表刷新它们就出现在「未登记的工作空间」组里。要真删会话，走会话自己的删除入口。

### 4.10 老数据清理（一次性，不写迁移）

- 删 `E:\work-space\agent-learn\.sessions\`（37 个文件）与 `.traces\`（33 个文件）
- **先列清单给用户过目 → 确认 → 删**（两者都在 `.gitignore`，删了不进 git 历史）
- **不写脚本进仓库**：这是一次性动作，脚本会变成"没人敢删的遗留"

### 4.11 失败模式表（"知道它什么时候会失败"）

| # | 失败 | 症状 | 防线 |
|---|---|---|---|
| F1 | 4 处路径漏改一处 | 导出 404 / 轨迹散落，**不报错** | 路径只有一处拼法（4.2）+ 三处集成用例 |
| F2 | `toolContext` 没挪干净 | 所有会话共用第一个工作空间，**不报错** | 跨会话测试（4.5）+ 模块级禁 new 的纪律 |
| F3 | 越界被静默放行 | 模型写到工作空间外 | `classifyEscape` 单测 + 真机弹框用例 |
| F4 | 越界批准被"记住" | 第二次同路径不再弹 | 单测：`grant` 一次性 + 不写 approval-memory |
| F5 | `projectKey` 截断撞名 | 两个超长同前缀路径混一个目录 | 头里 `cwd` 是真身份；用例覆盖 |
| F6 | 目录浏览接相对路径 | 悄悄解析到服务器当前盘 | `isFullyQualifiedPath` 单测（含 `\foo`、`/foo`） |
| F7 | 半创建的会话目录 | 有目录没 header → 列表崩 | `list()` 跳过坏目录（现有语义） |
| F8 | 老客户端不带 `workspace` | 400（**这是期望行为**） | 契约测试 |

### 4.12 删掉审批侧车（C52）

- **删什么**：`lib/permission/approval-log/`（模块 + 测试）、`route.ts:275,286` 两处写入、`SessionManager.delete` 里的侧车删除、路径模块里的 `approvalLogPath`
- **为什么**：决策已进轨迹；侧车无读者（见决策 16）
- **代价（写进已知限制）**：不再有"独立成表"的审批史；要查"这个会话批准过什么"= 翻该会话目录下的 `trace.*.jsonl`，按 `tool_permission` 事件筛
- **独立性**：**独立一个 commit**（不混进存储改造），改到 `route.ts` 的两个调用点，但**不碰 `lib/agent/index.ts`**

### 4.13 实现契约（签名 / 错误码 / 参数名 / 配置去留）

> 这一节的存在理由：上面的设计说的是"**该有什么行为**"，这一节说的是"**代码长什么样**"。没有它，实现时会现场发明签名与错误码，事后无法复核。

#### A. 模块导出（签名即契约）

**`lib/session/paths/index.ts`**（纯函数，无 IO）

```ts
projectKey(cwd: string): string                    // 空串 → 抛错
encodeSegment(id: string): string                  // 单射；非法码元 → ~XXXX
projectDir(root: string, cwd: string | undefined): string
sessionDir(root: string, cwd: string | undefined, id: string): string
sessionLogPath(root: string, cwd: string | undefined, id: string): string          // <dir>/session.jsonl
tracePath(root: string, cwd: string | undefined, id: string, runId: string): string // <dir>/trace.<runId>.jsonl
isValidSessionId(id: string): boolean              // 从 manager 迁入，语义不变
```

**`lib/workspace/`** —— 纯的与碰盘的分开

```ts
// model.ts（纯）
export type Workspace = { id: string; path: string; title: string; createdAt: string; updatedAt: string }
export function defaultTitle(path: string): string        // 末段；盘符根（C:\）→ 盘符本身
export function validateTitle(title: string): string      // trim；空 / >60 字 → 抛 WorkspaceError
export function upsertOnBootstrap(records: Workspace[], sessions: { id: string; cwd: string }[]): Workspace[]
// store.ts（碰盘；写入全部走模块内一条写队列，Promise 串行）
export async function loadWorkspaces(home: string): Promise<Workspace[]>   // 文件不存在 → []
export async function createWorkspace(home: string, path: string, title?: string): Promise<Workspace>
export async function renameWorkspace(home: string, id: string, title: string): Promise<Workspace>
export async function deleteWorkspace(home: string, id: string, sessionCwds: string[]): Promise<{ removed: Workspace; unregisteredSessions: number }>
```

**错误类型：一种、带 `code`**

```ts
export class WorkspaceError extends Error {
  code: "corrupt" | "not-found" | "duplicate" | "invalid-title" | "invalid-path" | "not-a-directory"
}
```

> 不用一堆子类：调用方只需要**一个 switch** 把 code 翻成 HTTP 码；7 个子类会让路由里出现 7 个 `instanceof`。

#### B. 错误码表（前端弹什么，全看这张）

| 接口 | 失败 | 码 | 文案 |
|---|---|---|---|
| `GET /api/workspaces` | — | 200 | `{ workspaces }`（`updatedAt` 倒序） |
| `POST /api/workspaces` | 缺 `path` | 400 | 缺少 path |
| | 非完全限定（相对 / `\foo`） | 400 | 路径必须是完全限定的绝对路径 |
| | 不存在 / 不是目录 | 400 | 路径不存在或不是文件夹 |
| | 已登记（canonical 相同） | **409** | 这个文件夹已经是工作空间（带 `workspaceId`） |
| | 注册表损坏 | 500 | 工作空间注册表损坏：workspaces.json |
| `PATCH /api/workspaces` | 缺 id/title · title 空白或 >60 字 | 400 | 名字不能为空，且不超过 60 字 |
| | id 不存在 | 404 | 工作空间不存在 |
| `DELETE /api/workspaces` | id 不存在 | 404 | 工作空间不存在 |
| | 成功 | 200 | `{ ok: true, unregisteredSessions: n }` |
| `POST /api/workspaces/open` | id 不存在 | 404 | 工作空间不存在 |
| | 目录已消失 | **409** | 这个工作空间的文件夹不在了 |
| | 非 Windows | **501** | 打开文件夹目前只支持 Windows |
| | 启动失败 | 500 | 打不开资源管理器 |
| `POST /api/sessions` | 缺 `workspaceId` | 400 | 缺少 workspaceId |
| | 记录不存在 | 404 | 工作空间不存在 |
| | 目录已消失 | 409 | 这个工作空间的文件夹不在了 |
| `GET /api/chat/commands` | 缺 `sessionId` | 400 | 缺少 sessionId |
| `GET /api/workspaces/browse` | 非完全限定 | 400 | 路径必须是完全限定的绝对路径 |
| | 不存在 / 不可读 / 不是目录 | 400 | 目录读不到 |
| `POST /api/workspaces/browse` | name 非法（含分隔符 / `.` / `..`） | 400 | 名字只能是一层，不能含分隔符 |
| | 已存在 | 409 | 同名文件夹已经存在 |

#### C. 越界分类要用的工具参数名（实读 `lib/tools/*/index.ts`）

| 工具 | 路径参数 | 缺省 | 参与越界判定 |
|---|---|---|---|
| `read_file` / `write_file` / `edit_file` / `delete_file` | `path` | — | ✅ |
| `grep` / `find` / `list_files` | `path` | `"."` | ✅ |
| `write_note` | `fileName`（已净化在 notes 目录内） | `note.md` | ❌ |
| `bash` | `command` | — | ❌ 只做粗筛 |

**bash 粗筛**（只影响"要不要弹框提示"，**不影响能否执行**）：命中任一条 ⇒ 不再自动放行、转弹框

```
[A-Za-z]:[\\/]                    别的盘符
\\\\[A-Za-z0-9_.-]+\\             UNC
(^|[\s"'=])\.\.([\\/]|\s|$)       ..
(^|[\s"'=])~([\\/]|\s|$)          ~
```

#### D. 配置项去留（2026-11-11 用户定：**三个全删**）

| 配置 | 决定 |
|---|---|
| `STATVE_HOME` | **新增**：`config.paths.home = env("STATVE_HOME", resolve(homedir(), ".statve"))` |
| `config.paths.sessions` | 改为 `join(home, "sessions")`；`SESSION_DIR` **保留**为覆盖口（测试/沙箱要用） |
| `config.paths.traces` | **删除**，`TRACE_DIR` 一起删 —— 轨迹住会话目录，没有"全局轨迹根"这回事 |
| `config.paths.skillsRoot` | **删除**，`SKILLS_ROOT` 一起删 —— 改成 `resolveResourceRoots({ cwd, home })`，测试直接传参 |
| `config.paths.workspace` | **删除** —— 它是"模块级常量串味"的根源；工作空间只从会话头来 |

> 结构性收益：`lib/config` 里不再有"全局工作区 / 全局轨迹 / 全局技能根"三个概念，**落盘位置不再取决于进程从哪里启动**。

### 4.14 组件拆分与状态归属

| 组件 | 位置 | 一句话职责 |
|---|---|---|
| `WorkspaceGroup` | `app/components/workspace-group/` | 一个工作空间的组头（名字 / 计数 / ＋ / ⋯菜单）+ 它下面的会话行 |
| `SessionList`（改） | `app/components/session-list/` | 只负责渲染分组列表，不再管单行形态 |
| `SessionRow`（保持不动） | 同目录 | 一行会话的 4 种形态 |
| `DirectoryBrowser` | `app/components/directory-browser/` | 对话框：盘符条 + 面包屑 + 列表 + 行内新建 + 页脚 |
| `ui/menu`（复用） | 已有 | 组头菜单、行内菜单 |

**状态归属**（第 11.9 条的分界：hook 管状态与副作用，纯函数管数据变换）

| 状态 / 计算 | 归属 | 理由 |
|---|---|---|
| `sessions` + `workspaces` 列表、当前会话、CRUD | **hook** `use-workspaces`（+ 扩展 `use-sessions`） | 有请求、loading、错误态 |
| 分组结果 `SessionGroup[]` | **纯函数** `groupSessions(sessions, workspaces)` | 无副作用 ⇒ node 可测 |
| 「展开其余 N 个」 | `WorkspaceGroup` 本地 `useState` | 纯界面态，不落盘 |
| 组头菜单开合 | `WorkspaceGroup` 本地 `useState` | 同上 |
| 对话框开合 / 当前路径 / 条目 / 新建输入 | **hook** `use-directory-browse` | 有 `fetch`、有 `AbortController` 取消、有失败态 |
| 面包屑 / 盘符 / 路径截断 | **纯函数** `app/lib/directory-path` | 字符串变换 |
| 越界判断 | **纯函数** `app/lib/tool-escape` | 纯的 |

**从原型到组件的「继承 / 改动」**：组头、菜单三项、空空间虚线条、对话框骨架、行内新建 —— **继承**；**改动**只有一处：原型里还没有**盘符条**，写代码时补上；会话行 4 态**不动**（`SessionRow` 已有）。

### 4.15 提交切分（i2 的五步 → 10 个 commit）

```
1  feat(paths)：路径纯函数 + 单测
2  feat(workspace)：注册表 model + store + 单测
3  feat(sessions)：分组纯函数 groupSessions + 单测
4  feat(tools)：越界分类 classifyEscape + 单测
5  refactor(config)：数据根 ~/.statve + 路径收敛（4 处）+ 删三个全局配置
6  refactor(permission)：删审批侧车 approval.jsonl（C52，独立 commit）
7  refactor(tools)：ToolContext 常量 → 每请求 + 技能多根
8  feat(api)：workspaces / sessions / browse / open
9  feat(ui)：侧栏分组 + 目录浏览器
10 docs：详案补记 + i2 终态
```

每一步的判据：`tsc --noEmit` 通过 · `pnpm lint` 干净 · 只碰本步该碰的文件 · **`lib/agent/index.ts` 全程零改动**。

---

## 五、验收

### 5.1 单测 seam（纯函数优先，node 环境、不需要 jsdom）

| 模块 | 用例数 | 判据 |
|---|---|---|
| `lib/session/paths` | 8 | `projectKey`：反斜杠/盘符/中文/emoji/超长截断/空串抛错/前导 `-` 去重；`encodeSegment` **单射**（不同 id 不出同段）；`..` 与绝对路径不出目录 |
| `app/lib/session-groups` | 6 | 分组/组序/组内序/标题消歧/`_no-cwd`/单组标记 |
| `app/lib/tool-escape` | 6 | 7 个工具 × 内/外；`bash` 返回 `inside`（显式已知限制） |
| `_pipeline/approval` 扩展 | 6 | 越界 × 三种模式；secret 优先于越界；非越界不受影响 |
| `EscapePermits` | 2 | 一次性消费；未 grant 时围栏照常抛错 |
| `lib/resources` + `loadSkills` 多根 | 6 | 四层顺序；同 key 覆盖不合并；根不存在静默跳过；`root` 出处正确 |
| 目录浏览栅栏 | 6 | `C:\x` 通过；`\foo`/`/foo`/相对路径拒绝；单段名校验；排序确定性；截断标记 |
| `lib/workspace` 注册表 | 6 | canonical 去重（同一个文件夹登记两次 → 409）；`title` 默认取末段；重命名只改 `title`；删记录返回未登记会话数；json 坏文件 → 报错而不是当空；原子写不产生半截文件 |
| `groupSessions` 与注册表联动 | 4 | 匹配 `cwd`；未登记组排最后；同名两组都出现；组头始终存在 |

### 5.2 集成与真机（dev server + 浏览器）

| # | 步骤 | 期望 |
|---|---|---|
| I1 | 新建会话时必须选工作空间 | 不选 → 建不了（按钮禁用/400） |
| I2 | 选 `E:\…\proj-a` 建会话 | 落盘 `~/.statve/sessions/--E-work-space-proj-a--/<id>/session.jsonl`；头里 `cwd` 是 canonical 路径 |
| I3 | 两个会话（A、B 不同工作空间）交叉发消息 | 各自的工具根不同（读同一相对路径得到不同结果）——**F2 的验收** |
| I4 | 在工作空间外写文件 | 弹**危险**确认框、显示绝对路径；拒绝 → 失败；允许 → 成功；**再试一次仍弹** |
| I5 | 导出会话 / 审批日志 / 轨迹 | 三处都在新目录下（F1 的验收） |
| I6 | 删会话 | 整个会话目录消失（含轨迹） |
| I7 | 侧栏列表 | 按工作空间分组；只有一个组时**不显示组标题**；同名文件夹能区分 |
| I8 | 目录浏览器 | 逐级进入、面包屑可跳、能新建文件夹、手输路径可直达 |
| I9 | 重命名工作空间 | 侧栏名字变了；**磁盘上的文件夹名不变**（用资源管理器核） |
| I10 | 删除工作空间 | 组消失、会话仍在；列表出现「未登记的工作空间」组，里面的会话能打开、能继续聊 |
| I11 | 组头 `＋` | 在该工作空间里建档，落盘在该工作空间的目录下；不再询问工作空间 |

### 5.3 出口判据

`tsc --noEmit` 0 · `pnpm lint` 0 · 单测全绿 · 上表 I1–I11 全过 · **`git diff` 不含 `lib/agent/index.ts`**（红线零改动）· **全仓 grep 不到 `TRACE_DIR` / `SKILLS_ROOT` / `WORKSPACE_ROOT` / `paths.workspace`**（4.13 D 的删净判据）

---

## 六、不做（本迭代明确排除）

- 老数据迁移（全删）
- 会话中途切换工作空间（换 = 新建）
- 回收站 / 软删
- MCP（C1 未开工）
- Miller 分栏那种目录浏览器形态（v1 简版；要升级先过 `frontend-design`）
- `bash` 命令内容的越界静态分析（显式已知限制，见 F3）

## 七、⚠️ 还差什么才能开工

- [ ] **视觉细节**：分组标题的样式、目录浏览器的形态 —— 按 `AGENTS.md` 第 11.8 条，动手前必须先 `skill(frontend-design)` + 读 `workspace/prototype-*.html` 与 `app/globals.css` 的 token 表，产出「继承 / 改动」两栏提案后由用户拍板
- [ ] 用户对本文「三、决策清单」10 条与本「五、验收」的范围确认
