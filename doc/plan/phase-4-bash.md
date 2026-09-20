# doc/plan/phase-4 —— Phase 4 终端运行（施工补记）

> 来源：PLAN.md 第六章 Phase 4 段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**（含 2026-08-26 受限语言模式乱码根治），保留作施工历史。

## 目标

- 新增 `bash` 工具 + `BashRunner`（`node:child_process`）。
- 能力：执行命令 → 流式吐 stdout/stderr → 超时/终止（Ctrl-C）→ 退出码。
- 安全：命令白名单或确认机制、限制工作目录、禁止交互式 TTY（前期）。
- 对应 pi：`packages/coding-agent/src/core/bash-executor.ts` 和 `exec.ts`。
- 注意：`route.ts` 需 `export const runtime = "nodejs"`（已有）。

## 实现前补记（AGENTS.md：先想清楚再动手）

- **BashRunner**（`lib/tools/bash/bash-runner.ts`）：`spawn(command, { cwd, shell: true, stdio: ["ignore","pipe","pipe"] })`。stdout/stderr 的 `data` 事件逐块清理（去 ANSI 色码/`\r`/二进制垃圾）→ `onChunk` 流式回调 + 滚动缓冲（超 64KB 丢最旧）；`close` 事件拿退出码。**两级终止**：超时（已确认默认 30 秒）或 AbortSignal → `SIGTERM` → 5 秒后 `SIGKILL`。
- **工具签名扩展**：`ToolExecutor` 加可选 `options?: { signal?, onChunk? }`（`lib/tools/types.ts`）——其他 8 个工具零改动。
- **引擎只透传**：`RunAgentLoopOptions` 加 `onToolOutput?`，`executeToolCall` 原样递 signal + onChunk。引擎不理解 onChunk，只搬运。
- **`tool_output` 是旁路帧，不是 AgentEvent**：工具 → route.ts → SSE → 前端实时显示；不进引擎事件流、不进 trace（避免一条 `npm install` 几千块把黑匣子淹掉）。最终输出仍在 `tool_execution_end` 的 result 里带一份（截断后）。
- **run 级取消**：`lib/runControl.ts`（挂 globalThis 的 `Map<runId, AbortController>`，同 `toolApprovals` 模式）；POST /api/chat 创建 controller 注册（同时传给 `complete` 和工具 execute），finally 清理；新接口 `POST /api/chat/stop { runId }` → `abort()`。
- **审批**（已确认）：bash 加入 `TOOLS_NEEDING_CONFIRM` 全量弹框；`cwd` 锁 workspace；`stdin: "ignore"` 天然禁交互式 TTY。
- **诚实边界**：bash 执行任意字符串，`cd ..` 一行就出围栏——**bash 的安全不靠沙箱靠确认**，与文件工具本质不同（规划时已向用户说明）。
- **Windows**：`shell: true` 走 cmd.exe；提示词引导用 Windows 兼容命令，避免 `ls` 等 Unix 专属命令。
- 暂缓：交互式 TTY/pty、命令白名单免确认、Windows 进程树击杀（`taskkill /T`，先单层）、远程执行（SSH/容器）、输出写临时文件全量保留（pi 的 fullOutputPath）。

## 2026-08-26 更新：受限语言模式乱码根治

- **症状**：Windows Smart App Control / WDAC 把 pwsh 压进 ConstrainedLanguage，`.NET 类型创建`被禁 → 旧 preamble 双 pin（`[System.Text.UTF8Encoding]::new()`）整行失败 → 输出仍 GBK → 乱码。
- **正解**：`cmd /c "chcp 65001 >nul & pwsh -NoProfile -EncodedCommand <base64>"`——chcp 是 cmd 内建不碰 .NET，pwsh 启动时读到 65001；base64 传命令避开 cmd 引号解析。详情见 `lib/tools/bash/bash-runner.ts` 文件头注释。

---

## 2026-09-17 追加：C36 —— bash 错误流：可见、可读、可判

> **来源是一条真实会话记录**（`.sessions/s_2026-09-17T00-18-22-102Z_sj9bo2.jsonl`，第 31-33 行是原始证据），**不是设想的缺陷**：模型用 `code-review` 技能跑一条 `Select-String … ForEach-Object { … [Math]::Min(…) }`，**18 个文件全部报错、退出码 0、工具回来是"成功"**。

### 一、与既有计划的关系（开工前先看这节）

| 关系 | 项 | 处置 |
|---|---|---|
| ⚠️ **吸收** | `PLAN.md` 排期表的 **B19**（bash 工具定义测试补齐） | B19 要测的 5 个行为里就有「exitCode≠0 提示」，而 **T3 要改的正是这条判据** —— 同一文件、同一批行为。T3 的验收直接包含 B19 那五条；排期表那行已标 `↪ 并入 C36 T3` |
| **收口** | **C34** 的已知遗留 | C34 落地记录自己写着「② `bash` 那条规矩与它的 `description` 已经不一致（description 多了"可用 dir/type/get-content 等"）」—— **T1 修的就是这条**。不是新事，是闭环 |
| 🔲 **划界（不碰）** | **C22**（已并入 **C24**）+ **B7** | 它们要动的是「截断即丢弃 → 留一份 + 给路径」「生产者上限 vs 模型上限分两层」「bash 输出全量落盘」。C36 **只加"分流"，不碰"限额语义"**：不改 `maxOutputChars` 的含义、不落盘、不加路径回传。**理由**：C22 拒绝开工的理由是"属增强不是缺陷、没有真机数据"——**我们这次也没有**，蹭进去就变成"我觉得更好" |
| ⏸️ **时序** | **C8 T8**（C8 收尾验收，未做）+ 单会话纪律 | 文件零重叠，但**同一时间只让一个会话写这个仓库**（2026-09-16 T3 与并行会话撞在 `prompt/index.ts` 的教训）⇒ **T8 走完才开工** |

### 二、三个断点（同一个根）

我们手里本来有**三路**信息，但只用了半路：

| 信息 | 现状 |
|---|---|
| 退出码 | ✅ 看了 —— 但它**只反映最后一条语句** |
| stdout 字节 | ✅ 收下了 |
| **stderr 字节** | ❌ **和 stdout 混成一锅**（`bash-runner/index.ts:111` 的 `chunks`，两边都 `push`）—— **合并本身是对的**（保序，理由见第四节 Reasonix），但**连一份单独的 stderr 都没留**是白丢的 |

pwsh **每次都告诉我们"有错"**：错误写进 stderr，走管道时被序列化成 CLIXML。**我们收下了、没解、也没看。** 根子是同一个：**只对字节层做处理，对"这是一条报错"毫无感知。**

#### ① 退出码骗人

`ForEach-Object` **自己跑完了**（错在它执行的脚本块里）⇒ 整条管道算成功。**规则：退出码 = 最后一条语句的 `$?`。**

而 `lib/tools/bash/index.ts:48-52` 只在**退出码非 0** 时附一句提示，**`isError` 从来没设过**（我们的 `isError` 通道只有一条：工具**抛错**，见 `lib/agent/index.ts:116-125`）。

#### ② 错误不可读

```
#< CLIXML
<Objs Version="1.1.0.1" …><S S="Error">_x001B_[31;1mInvalidOperation: 无法调用方法。在此语言模式下，方法调用仅在核心类型上受支持。_x001B_[0m_x000D__x000A_</S>
…（同一句又 17 遍）
```

- `sanitize`（`bash-runner/index.ts:129-130`）只认**真 ESC 字节**（`/\x1b\[[0-9;]*m/g`），而 `_x001B_` 是**七个 ASCII 字符** ⇒ **匹配不到、原样放过**
- 真正有用的只有第一句，却被重复 **18 遍**（噪音把信号埋了）

#### ③ 工具没告诉模型语法禁区

模型的写法：`$_.Line.Substring(0,[Math]::Min(120,$_.Line.Length))`

**这条我们早就知道** —— `bash-runner/index.ts:56-62` 的注释里记着 2026-08-26 实测的三禁（建类型 / 属性 setter / 静态方法）。**但它是代码注释，模型看不见**；模型看得见的是 `description`，那里还写着"可用 dir/type/get-content 等"。⇒ 正是 C34 判据的反面：**知识住在工具目录里，却没挂在模型能看见的那一面。**

### 三、实测（本机探针，**5.1 与 pwsh 7 双验，两版一致**）

**退出码规则**（校准用例先过）：

| 最后一句是 | exit |
|---|---|
| `[Math]::Min(1,2)` | 1 |
| `"end"; [Math]::Min(1,2)` | 1 |
| 失败**之后**接一句成功的 `Write-Output "end"` | **0** ← 洗白 |
| `… ForEach-Object { [Math]::Min(…) }`（管道结尾） | **0** ← **模型就是这个形状** |
| `try { … } catch { … }` | 0 |

**语法分界**：

| 探针 | powershell.exe 5.1 | pwsh 7.6.6 |
|---|---|---|
| `"hello".Substring(0,2)` | ✅ `he` | ✅ `he` |
| `[Math]::Min(1,2)` | ❌ `MethodInvocationNotSupportedInConstrainedLanguage` | ❌ 同 |
| `[int]"5"` | ✅ `5` | ✅ `5` |
| `[System.Text.UTF8Encoding]::new($false)` | ❌ `CannotCreateTypeConstrainedLanguage` | ❌ 同 |
| `$ExecutionContext.SessionState.LanguageMode` | `ConstrainedLanguage` | `ConstrainedLanguage` |

⇒ **被禁的是 `[类型]::静态方法()` 与类型创建，不是方法调用**（字符串是核心类型）。最后一行还是**运行时判定当前模式**的手段。

### 四、五家对照（一手，文件:行）

> **口径同 C34**：「五家」= 五个**参考项目**（pi / DSH / Reasonix / codex / opencode），**我们另列**。

⚠️ **CLIXML：五家全无处理**（codex / DSH 全库搜 `CLIXML` 零命中）—— **没有作业可抄**。

| | stdout/stderr | 模型怎么知道失败 |
|---|---|---|
| **pi** | 合并（`description` 明说 `Returns combined stdout and stderr`） | `exitCode !== 0` → **抛错**，输出拼进错误消息（`harness/tools/bash.ts:137-141`） |
| **codex** | `stdout` / `stderr` / `aggregated_output` **三个字段**（分开 + 保序合并**都给**）；而 Windows 沙箱侧的 spawn 原语把"怎么接"做成**可选项** —— `StderrMode { MergeStdout, Separate }`（`windows-sandbox-rs/src/process.rs:200-205`，2026-09-18 从 `PLAN.md` 的 C36 行搬入并回读一手源码核对） | `exit_code == 0 ? Completed : Failed`（`core/src/tools/events.rs:540-544`） |
| **DSH** | **两条 collect 流**；给模型时合并并打 **`[stderr]`** 段标（`shell/bash-local/src/index.ts:337-339`） | **`[exit code: N]` 标记后缀**，`isError` 只给 spawn 错误/中止（`shell/tool-bash/src/render.ts:53-57`） |
| **opencode** | `stdout` / `stderr` / `all` 三视图 | **不告诉模型**（exit 只进 UI 的 `metadata.exit`；`<shell_metadata>` 只管超时/中止，`tool/shell.ts:582-592`） |
| **Reasonix** | ⭐ **合并（同一个 writer）** —— `cmd.Stdout` 与 `cmd.Stderr` 指向**同一个** `io.MultiWriter`（`internal/shellrun/runner.go:112-120`） | `State`（Completed / Failed / TimedOut / Cancelled）+ `FailurePhase` + `Err`；**仅在失败时**给 `OutputTail`，成功时清空（`runner.go:62-77,171-188`） |
| **我们** | 合并、无标记 | `[命令退出码：N]` 标记后缀 |

**四条结论**：

1. ⭐ **流分离：分开三家**（codex / DSH / opencode）、**合并两家**（pi / **Reasonix**）+ 我们 —— **不是"我们是孤例"**（这条最初写错过，Reasonix 那家漏读了）
2. ⭐ **Reasonix 给了"拆流"的反面理由，必须正面回应**：它把两个流指向**同一个 writer**，注释写着「**Two MultiWriters would mean two pipes, and combined output would be reordered per stream**」—— **拆成两条 pipe，合并视图就按流重排了**；同文件 `65-68` 还写明共用一条 pipe 的代价是"只取 stderr 尾巴"已不可能，但「**失败前最后那几个字节就是诊断**」。
   ⇒ **所以 T2b 不拆 pipe**：保持**单管道**（有序的合并缓冲原样保留），只**在单管道上多攒一份 stderr 缓冲**（`proc.stderr.on("data")` 本来就知道来源，零成本）。**DSH 那种"把 stderr 整体挪到最后"正是 Reasonix 指出的代价** —— 不采用。
3. **失败判据五家五种、没有一个解决"退出码骗人"** —— pi 抛错 · codex 事件态 · **DSH `[exit code: N]` 后缀且 isError 只给 spawn 错误/中止（和我们现有机制同款）** · opencode 不告诉模型 · Reasonix `State` / `FailurePhase` / `Err` + 只在失败时给 `OutputTail` ⇒ **修 ① 是延长 DSH 那套标记机制，不是换机制**（最初想翻转 `isError`，已撤回）
4. 顺手可抄的一条：**DSH 在源头抑制颜色** —— `NO_COLOR=1` / `TERM=dumb` / `PAGER=cat` / `GIT_PAGER=cat`（注释说 "the same set Codex hardcodes"）⇒ **先别产生，再谈洗掉**

⚠️ **不能照抄回去的**：**DSH 的编码 preamble 就是那个"双 pin"**（`shell/pwsh-local/src/index.ts:49`），而**本文件上一节已记着它在受限模式下整行失败** —— 这条我们领先。

### 五、方案（三块 → 三个 task，各自独立验收）

**T1 · bash 把"自己的规矩"告诉模型**（对应 ③，独立可交）

- 落点：`lib/tools/bash/index.ts` 的 `RegisteredTool.guidelines`（C34 建好的管道，**第一次实用**）
- 两条：① 受限模式**禁 `[类型]::静态方法()` 与类型创建**，用 `-gt` / `-lt` / `if` 替代；可查 `$ExecutionContext.SessionState.LanguageMode` ② 结果是 stdout/stderr **合并**返回（**保序，不区分来源**）
- `description` 补一句「返回 stdout 与 stderr 合并后的文本」（工具**是什么**归 description，C34 分工）
- 反引号安全已核实：`lib/tools/index.test.ts:89` 的过滤器是 `/^[a-z][a-z_]*$/`，`[Math]::Min` 不在范围

**T2 · 输出：源头抑制 + 留一份 stderr + 解人话**（对应 ②）

- **2a 抄 DSH**：spawn 注入 `NO_COLOR` / `TERM=dumb` / `PAGER=cat` / `GIT_PAGER=cat`
- **2b 留一份 stderr（⚠️ 受 Reasonix 修正，不拆 pipe）**：**保持单管道**（有序的合并缓冲**原样保留**），只在 `proc.stderr.on("data")` 那一侧**多攒一个数组**（本来就分得清来源，零成本）。`BashResult` 加 `stderr` 字段备查；**模型侧主输出的形状不变**（仍是保序的合并文本）。**不做** DSH 那种"把 stderr 整体挪到最后"（理由见第四节结论 2）
- **2c 自己想（无作业可抄）**：新纯函数 `readPwshErrors(text)`，落 `lib/process-output/`（它已是"子进程输出"的横切点）
  - 认 `#< CLIXML` → 取每条 `<S S="Error">` → 解 `_xHHHH_` 转义 → 去 ANSI → **按内容去重计数**
  - **不认得的输入原样返回**（不吞信息）
  - 产出形如：`[pwsh 报错 ×18]` 换行 `无法调用方法。在此语言模式下，方法调用仅在核心类型上受支持。`
  - **为什么必须去重**：18 遍同一句是噪音，**"×18"才是信息**

**T3 · 判据加一条标记**（对应 ①，依赖 T2）

| 退出码 | 解出的 pwsh 报错 | 输出尾部标记 |
|---|---|---|
| ≠ 0 | — | `[命令退出码：N]`（现状不动） |
| **= 0** | **> 0 条** | `[退出码为 0，但 stderr 有 N 条报错]` |
| = 0 | 0 条 | 无 |

- **为什么不抛错**：DSH 的 `isError` **只给 spawn 错误/中止**；抛错会误伤 `grep 无匹配`（退出码 1 但完全正常）；且会改模型看到的形状，回归面比它修的病大
- **吸收 B19**：把判据抽成**纯函数**（现在内联在 `execute` 里、要真 spawn 才能测，而沙箱里 spawn 管道 EPERM）→ 测四种组合 + B19 原有的五条行为

### 六、明确不做

| 不做 | 为什么 |
|---|---|
| 注入 `$ErrorActionPreference='Stop'` | 改的是**用户命令的行为** —— 部分失败会变成半路中断 |
| 改成 pi 那样抛错 | 见 T3；且那条也只覆盖退出码，修不了本问题 |
| 输出落盘 / 改限额语义 | 归 **C22 → C24** 与 **B7**（同一条管道，要划清） |
| 用 DSH 的双 pin preamble | **我们已在受限模式下证明它整行失败** |
| 动 `lib/agent/index.ts` | **红线**，本项不涉及 |

### 七、验收

- **`readPwshErrors`**：**夹具 = 本文档第二节那段真 CLIXML 原文**（真管道产出，合 `AGENTS.md` 第 11.5 条夹具规则）
- **判据**：抽成纯函数后测四种组合
- **bash 投稿**：进提示词，且不撞 `prompt/index.test.ts`（已核实：第 82-90 行只断言"名字出现" + `length > 0`，**无精确条数**；第 135-153 行用的是**注入的假 guidelines**，与真实注册表隔离）
- `tsc --noEmit` + 全量 vitest（`app/api/repos/_lib/git` 那 5 条 EPERM 失败是**既有**沙箱限制）
- **T1 / T2 / T3 各自独立 commit、各自验收**

### 八、同源旁证：本机 pwsh 的 `Get-Content` 静默吞换行（**不在 C36 范围，但要记一笔**）

2026-09-17 查工时**当场撞见同一场病**：读 `PLAN.md` 时，不同工具报出的行数**互相对不上**。逐层查到根：

| 读法 | 行数 | 字符数 |
|---|---|---|
| `Get-Content PLAN.md`（默认） | **230** ❌ | 53264 ❌ |
| `Get-Content PLAN.md -Encoding utf8` | 307 ✅ | 45029 ✅ |
| Node `readFileSync(…, "utf8")`（真值） | 307 ✅ | 45029 ✅ |

**77 个换行被吞**：本机 harness 跑的是 **Windows PowerShell 5.1**（`PSEdition=Desktop`，可执行文件 `…\v1.0\powershell.exe`），而 **5.1 的 `Get-Content` 默认编码是 ANSI(GBK)** —— UTF-8 汉字的尾字节（0x80–0xBF）落在 GBK 合法首字节区间，把紧跟的 `\n`(0x0A) 当成双字节字符的尾字节吃掉了。

**它不报错、不给警告**，只是安静地给出**错误的行号和错误的内容** —— 与 C36 三个断点**同一场病**（工具静默给出错误结果，调用方看不出）。

**顺带解开一个悬案**：DSH 的 `ENCODING_PREAMBLE`（`shell/pwsh-local/src/index.ts:49`，就是那个**双 pin**）在受限语言模式下**每条命令都报 `CannotCreateTypeConstrainedLanguage`** —— 所以那个 pin 在本机**根本没生效**。**这正是本文件 2026-08-26 那节记的坑，在 DSH 自己的 harness 上是活的**；我们的 `cmd + chcp 65001` 正是为绕开它。

### 九、落地记录（施工补记）

#### T1（2026-09-20 · commit `0fdd82c`）

- **改动**：`lib/tools/bash/index.ts`（+`guidelines` 两条、`description` 补一句）+ **新增** `lib/tools/bash/index.test.ts`（5 条用例，从 `createBashTool()` 真实产出上断言，不手拼字符串）。
- **红 → 绿**：改前 4 条挂（`guidelines` 是空串、`description` 里没有「合并」）→ 改后 `lib/tools` **23 文件 / 297 用例**全过；`tsc --noEmit` 0。
- ⚠️ **施工中撞到的一个真实边界（下次写规矩还会撞）**：`lib/tools/index.test.ts:89` 的反引号扫描把**反引号包着的全小写单词**当工具名去核对 ⇒ 规矩正文里 `if` / `stdout` / `stderr` **不能加反引号**（加了当场红，而且报错信息看着像"提到了不存在的工具"）。`[类型]::静态方法()` / `-gt` / `$ExecutionContext…` 天然不在扫描范围（首字符不是小写字母）。
- **一处刻意如此**：`description` 与 `guidelines` 各有一句「合并」—— 不是 C34 禁的重复：**`description` 答形状**（返回什么），**`guidelines` 答读法**（报错可能夹在中间，别只看结尾）。
- **验收⑥ 的影响面已实测**：`app/api/chat/_pipeline/prompt/index.test.ts` 的断言只要求"投稿都渲染出来 + 条数 > 0"，不钉条数 ⇒ 加两条规矩不会撞它（真注册表那条用例已跑绿）。

#### T2（2026-09-20 · commit `11ea094`）

- **改动**：`lib/process-output/index.ts`（+`readPwshErrors` / +`stripPwshClixml`）；**新增** `lib/process-output/test-fixtures.ts`（真管道样本，两处测试共用）；`lib/tools/bash/bash-runner/index.ts`（+`bashProcessEnv`、`BashResult +stderr`、抽 `createRollingBuffer`）；`lib/tools/bash/index.ts`（+`cleanBashOutput` 并接进 `execute`）。
- ⭐ **原方案被施工改掉一处，理由是实测出来的**：计划写的是 `readPwshErrors(text)`（喂合并输出）。但 **CLIXML 的样文我们自己的文档里就抄着**（本文件第二节），模型一条 `Get-Content doc/plan/phase-4-bash.md` 就会把同形文本打到 **stdout** 上 ⇒ 按合并输出判定会把一份**正常读出来的文档**改写成「[pwsh 报错 ×20]」—— 正是 C36 要治的"工具静默给出错误结果"。**改成只信 `stderr`**（CLIXML 的家），摘机器话才动合并输出那一份；这条写成了 ⭐ 用例。
  - ⇒ 顺带把计划里"`BashResult.stderr` 备查"改成**真消费者**（CLIXML 解码的输入）——"备查"没有消费者，正是本项目点过名的「预挖空壳」病。
- **合并 ≠ 分不清**：保序的单管道合并照旧（Reasonix 的反面理由见第四节结论 2），只多攒一份 stderr（零成本）。
- **夹具订正一处**：真样本数出来是**同一条报错 ×20**，本文件第二节当时写的是"18 遍"（粗估）。
- ⚠️ tsc 抓到一次：测试里手编 `{ PATH: "x" }` 当环境夹具 → 本项目 `ProcessEnv` 要求 `NODE_ENV` 必填（Next.js 的类型增强）。改成展开**真实的 `process.env`**（生产调用方传的就是它）。
- **红 → 绿**：14 条挂 → `lib/process-output` + `lib/tools/bash` 3 文件 / 32 用例全过。
- **真 spawn 探针**（跑完即删，不入库）：`1..3 | ForEach-Object { [Math]::Min(1,2) }` → 退出码 0 / stdout 空 / stderr 334 字符 CLIXML → `readPwshErrors` count=3。**探针顺带证明 2a 生效**：解出来的报错里**已经没有 ANSI 色码**（09-17 那次原文里是 `_x001B_[31;1m`）—— 源头不产生，就不用洗。

#### T3（2026-09-20 · commit `f68e11d`）

- **改动**：`lib/tools/bash/index.ts`（+`bashStatusNote` 四格判据；`cleanBashOutput` 顺带交出 `pwshErrorCount`，同一个 stderr 不解析两遍）+ 用例 13 条。
- **吸收 B19**：它那五条行为（空命令报错 / 终止提示 / 退出码提示 / 无输出占位 / ToolResult 形状）全部落地。做法 = **判据抽成纯函数** + `vi.spyOn(BashRunner.prototype, "run")` **把执行器换掉**（工具逻辑与"谁去执行"无关）⇒ 从"必须有真进程"变成"不需要"，沙箱 EPERM 不再是拦路虎。
- **为什么不抛错**（本节的取舍）：抛错会误伤「退出码 1 但完全正常」的 `grep 无匹配`，还会改掉模型看到的结果形状（`isError` 通道）⇒ 回归面比它修的病大。**延长既有标记机制（DSH 形状），不换机制。**
- **两个信号都有时只报退出码**：报错正文（×N + 人话）已经在正文里，同一件事不说两遍。
- **变异检验**：把 `readPwshErrors(stderr)` 故意改成 `readPwshErrors(output)` → **正好那条 ⭐ 守卫用例变红、其余 21 条不动**（验完逐字还原）⇒ 那条用例测在点子上。
- **端到端真机证据**（走真工具的真 spawn 探针）：模型看到
  `[pwsh 报错 ×3]` / `InvalidOperation: 无法调用方法。在此语言模式下，方法调用仅在核心类型上受支持。` / `[退出码为 0，但 stderr 有 3 条报错]`；
  对照（`Write-Output 'ok'`）→ `ok`，**一个字都不加**。

#### 收口（2026-09-20）

- **三个断点全闭上**：退出码骗人（T3 标记点明）· 错误不可读（T2 人话 + 去重）· 模型不知道语法禁区（T1 的规矩进提示词）。
- **验收读数**：`lib/tools/bash` + `lib/process-output` **3 文件 / 45 用例**全过；`tsc --noEmit` 0；全量 **736 passed / 1 failed**（那条是**既有假红**：`lib/skill/index.test.ts` 的隐藏技能守卫按子串匹配，隐藏技能 `teach` 是 `slidev` 描述里 "teaching materials" 的子串 —— 与 C36 无关，`git stash` 验过，已入池 **C43**）。
- **明确没做**（划界，理由见第六节）：输出落盘 / 改限额语义（C22→C24 与 B7）；注入 `$ErrorActionPreference='Stop'`（会改用户命令的行为）；改成 pi 那样抛错。
- **红线自检**：三个 commit 的 `git diff --cached --name-only` 都不含 `lib/agent/index.ts`（本项不涉及引擎）。

### 十、真机验收清单（2026-09-20 加 · **待用户跑**）

> 为什么还要这一步：前面所有证据都是**代码层**（45 用例）与**真 spawn 探针**（真 CLIXML）。
> 但 C36 的验收判据是"**模型据此改行为**"—— 那要模型自己在真实链路里跑一条命令才算数。
> ⚠️ 沙箱起不了 dev server（`next dev` fork 报 EPERM），所以只能由用户在本地跑。
>
> **准备**：`pnpm dev` → `localhost:3000`；确认 `MOCK_MODE=false` 且 `DEEPSEEK_API_KEY` 在环境里
> （`.env.local` 里没有 key，key 在用户 shell）。bash 每次会弹审批框 → 批准。

| # | 发什么 | 期望（过） | 失败长相 |
|---|---|---|---|
| **S1** | 「用 bash 跑这条命令，然后告诉我它成功了吗：`1..3 \| ForEach-Object { [Math]::Min(1,2) }`」 | ① 工具结果里有 `[pwsh 报错 ×3]` + `InvalidOperation: 无法调用方法。…` + `[退出码为 0，但 stderr 有 3 条报错]` ② **模型说"这条命令报错了/失败了"** | 工具结果是一坨 `#< CLIXML …`；或模型说"执行成功" |
| **S2** | 「用 bash 在 `PLAN.md` 里搜一个肯定不存在的词 `zzz不存在zzz`」 | 尾部是 `[命令退出码：1]`，且**模型理解为"没找到"**（不是"工具崩了"） | 模型把"没匹配"说成失败/崩溃 |
| **S3** | 「用 bash 把 `doc/plan/phase-4-bash.md` 里含 `CLIXML` 的行原样抓出来」 | 那些行**原样**出现（`#< CLIXML…` / `<S S="Error">…`），**没有**被换成「[pwsh 报错 ×N]」，也没有 `[退出码为 0，但 stderr 有 N 条报错]` | 文档内容被**改写**成报错摘要 ⇒ 说明判据又看回合并输出了 |
| **S4**（观察项，非硬判据） | 「用 bash 统计 `PLAN.md` 里最长的行有多少字符」 | 理想：它不再写 `[Math]::Max(...)`（受限模式禁区），改用管道（如 `Measure-Object -Maximum`）；若仍踩，**它自己认得这条报错并改写法**（规矩给了替代写法与自查手段） | 踩了禁区、且把报错当"成功"、不换写法 |

**报告粒度**：逐条说"过 / 没过"，**贴工具结果原文最好**（那是能回填 `.traces/` 的证据）。S1 是主判据，S3 是"判据只信 stderr"的端到端验证。
