# B1 审批升级三步 —— 详案

> 状态：⏳ 排队（2026-08-26 定案，待用户确认后开工）
> 参考：Reasonix `internal/permission/bash_readonly.go` + `internal/shellsafe/*.go`；CodeWhale `crates/execpolicy/src/approval_mode.rs` + `crates/tui/src/approval_log.rs`

## 一、功能描述

现在 bash 和所有写操作**全量弹框**（`app/api/chat/route.ts` 的 `TOOLS_NEEDING_CONFIRM`）。三步升级：

1. **① 只读命令放行**：`Get-Content foo.txt` / `git status` / `dir` 这类只读命令不再弹框，直接执行（写操作照旧弹框）
2. **② 分级模式**：审批从"二元（弹/不弹）"升级为信任档位（suggest 默认 / bypass 全放 / never 全拒），env 可切
3. **③ 审批日志**：每次弹框 + 用户决定落 JSONL（审计 + 复盘），成对校验防日志损坏

## 二、参考对照与取舍

### ① 只读命令放行（核心教学点：静态命令分析）

**抄 Reasonix shellsafe** 的设计：

- `readOnlyCommands`（单命令表）：cat/head/tail/ls/find/grep/echo/pwd/whoami/wc/stat/ps/diff/man/… + **PowerShell 观察性 cmdlet**（get-childitem/get-content/get-item/get-location/get-process/select-string/…）——Reasonix 已为 pwsh 列了窄表，我们直接适配
- `readOnlyPrefixes`（子命令表）：`git log/status/diff/show/tag/blame/grep/ls-files/rev-parse/…`、`go vet/doc/list`、`npm ls/view` 等——**子命令不在表里 = 不自动放行（fail-closed）**：`git push`、`git branch`（无 list 旗标）都不放行
- **fail-closed 规则**（关键安全底线）：
  - 命令含 shell 语法特征（`|` `&` `;` `<` `>` `$` `"` `'` 反引号 等）→ **不自动放行**（管道/重定向/替换可走私写操作）
  - 危险参数拦截（Reasonix `nestedReadOnlyArgsSafe`）：`find -exec/-delete`、`sort -o`、`git diff --output`、`sed -i` 等"只读命令带写参数"→ 不自动放行

**取舍（诚实交代）**：Reasonix 用 Go 的 `mvdan.cc/sh/v3` 完整 bash AST 解析器（能精确处理管道/替换/重定向）；我们 JS/TS **没有同等解析器**，方案用**词法近似**：

- 取命令首词（trim → split 空白 → 去引号）→ 查只读表
- 含任何 shell 语法特征 → 直接 fail-closed（弹框）
- **后果**：`Get-Content a.txt` 放行，`Get-Content a.txt | Select-String x` 弹框（保守）——**宁可多弹框，不可漏放行**。这是安全边界，不是可用性妥协。

### ② 分级模式（信任档位）

**抄 CodeWhale `approval_mode.rs` 四档**：Suggest（默认）/ Auto（自动审查）/ Bypass（YOLO）/ Never。

我们做**三档**（Auto 暂不做，见"为什么不做"）：

| 档位 | 行为 | 用途 |
| --- | --- | --- |
| `suggest`（默认） | 现状 + ①只读放行 | 日常 |
| `bypass` | 除 secret 硬拦截外全部 allow | 调试/教学演示（YOLO） |
| `never` | 需确认工具全部 block | 演示/保险 |

- 配置：`lib/config.ts` `approval.mode`，env `APPROVAL_MODE` 覆盖（对齐现有 env 口子风格）
- **Shift+Tab 循环切换**（CodeWhale 交互）：**本次不做**，后端模式接口就位、前端 UI 留给用户自己调

### ③ 审批日志（审计 + 复盘）

**抄 CodeWhale `approval_log.rs` 核心**：

- `ApprovalReceipt`：`{ phase: "asked" | "decided", approvalId, toolCallId, toolName, outcome?, createdAt }`
- JSONL **append-only** 追加（`<id>.approval.jsonl`，放会话 JSONL 同目录 `.sessions/`）
- **成对校验**（抄 `ApprovalReplay`）：asked 必须有唯一匹配 decided、id 不重复、approvalId == toolCallId——日志损坏能发现，不静默
- 不做的：锁文件（我们单进程无并发写竞争，CodeWhale 的 8 线程竞争测试场景我们用不上）

## 三、实施方案

### 新增文件

| 文件 | 内容 |
| --- | --- |
| `lib/permission/readonly.ts` | 只读命令表 + `isReadOnlyBash(command)` 纯函数（词法拆分 + fail-closed） |
| `lib/permission/readonly.test.ts` | 只读判定单测（表覆盖 + fail-closed 各形态） |
| `lib/permission/approval-log.ts` | `appendApprovalReceipt` / `loadApprovalReceipts` / 成对校验 |
| `lib/permission/approval-log.test.ts` | 追加/读回/成对校验单测 |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `lib/config.ts` | `approval.mode: "suggest" \| "bypass" \| "never"`（env `APPROVAL_MODE`，默认 suggest） |
| `app/api/chat/route.ts` | `handleToolApproval`：bash 分支先查 `isReadOnlyBash` → 放行；按 mode 分支；弹框记 asked、决定记 decided |

### 验收标准

1. `Get-Content foo.txt`、`git status`、`dir` → **不弹框**直接执行
2. `Set-Content`、`git push`、`rm` → 仍弹框
3. 含管道/重定向/变量/引号的命令（`Get-Content a \| Select-String x`、`git status > out.txt`）→ 仍弹框（fail-closed）
4. `APPROVAL_MODE=bypass`：写命令不弹框直接执行；`=never`：写命令直接拒绝
5. 每次弹框 + 决定落 `.approval.jsonl`，成对完整；重启后能读回
6. `tsc --noEmit` + vitest 全绿

## 四、为什么不做（讨论结论记录）

- **不做完整 shell 解析器**：JS 无 mvdan/sh 等价物，词法 + fail-closed 已守住安全底线；完整解析器是"精确度"不是"安全性"（fail-closed 下两者都安全，只是弹框率不同）
- **Auto 档暂不做**：与 suggest 行为等价（都是"自动审查 + 弹框"），做了是空档，等有"危险分级"需求再补
- **Shift+Tab 循环 UI 不做**：用户 UI 自己调，后端接口就位即可
- **日志锁文件不做**：单进程追加无并发竞争，CodeWhale 的多线程场景我们用不上

## 五、教学点（做完复盘用）

1. **静态命令分析的信任边界**：词法近似 vs 完整 AST——精确度取舍 + fail-closed 原则（安全底线不靠猜）
2. **审批 = 信任模型**：二元弹框 → 信任档位（suggest/bypass/never），Bypass/Never 是学习环境的调试工具
3. **审计日志设计**：append-only JSONL + 成对校验——简单可靠，日志损坏能发现
4. **为什么"只读放行"安全**：放行的不是"命令"而是"已证明无副作用的行为"（Known + 零写入 + 无语法走私）

---

## 六、实现后补记（2026-08-26 完成，实测 + 用户反馈）

> 按 AGENTS.md 第 10 条：同功能演进记在一个文件，保持时间线。

### 实际实现与方案的差异（决策变更）

1. **④ 前端面板：方案"UI 留给用户" → 实际做了**。用户期望 B1 增强包含前端（Reasonix 的确认面板有三档选项），且我最初的设计被用户否了两次：
   - 第一版"小尺寸居中模态 + 三档递进填充"→ 用户嫌**小家子气**
   - 第二版抄 Reasonix 布局（**内嵌消息流卡片**，非模态）：header 警告图标 + subject（工具+参数）+ actions 按钮带快捷键徽标（Y/A/P/N）→ 用户认可
   - 用户追加三点修正：① 卡片出现要 scrollToEnd（否则贴输入框像"浮在上面"）② **按钮独占一行**（全宽纵向）③ **bash 命令从 JSON 壳提取单独渲染**（大字代码样式，其他工具才渲染 JSON）
2. **② 模式切换：方案"env 切" → 实际加运行时切换**。用户指出前端没配置入口；查证 pi/codex/DSH/CodeWhale/Reasonix **全部有运行时切换入口**（/settings、/permission、Shift+Tab）——三档模式不是自创（pi 的 ask/always/never 与我们一一对应）。新增 `lib/approvalMode.ts`（globalThis 可变）+ `/api/chat/approval-mode` 接口 + 前端三档控件（建议/YOLO/禁止，语义色实心）
3. **outcome 扩展**：`"approved" | "approved-session" | "approved-persist" | "denied" | "timeout"`——日志里能区分用户选了三档里的哪一档（审计信息量）
4. **记忆实现**：session = globalThis 内存 Map（`Map<sessionId, Set<toolName>>`，跨 worker 可见）；persist = `.sessions/approval-rules.json`（`{ tools: [...] }` 排序数组）。**存储位置 = 信任有效期**（内存=本会话，磁盘=跨会话）
5. **判定顺序**（信任成本从便宜到贵）：一直允许（磁盘）→ 本会话允许（内存）→ 只读静态分析（fail-closed）→ 弹框
6. **面板位置再改（2026-08-26，用户要求"像 askUser 悬浮在输入框位置"）**：审批卡从"消息流内嵌"挪到**底部决策区**（与 askUser 卡共用 `decisionBar` 容器，输入框隐藏、卡片占据其位置，钉在底部永远可见）。触发原因：内嵌在消息流里要滚动才能看到；askUser 卡钉在输入区不用找。连带：`scrollToEnd` 依赖去掉 pendingApproval（卡不在消息流里了）、`.askBar` 更名 `.decisionBar`（提问卡/审批卡共用）。**保留了原设计的非模态与快捷键 Y/A/P/N**——只是位置变了

### 踩过的坑（下次别踩）

- **测试描述里的中文引号**（`"记住后跨"读取"可见"`）被 TS 当成字符串边界 → TS1005。测试文案避免嵌套引号
- **卡片"浮在输入框上"**：不是布局 bug，是 `pendingApproval` 变化没触发 `scrollToEnd`——卡片出现在视口底部。滚动依赖要加 `pendingApproval`
- **bash 参数是 `{ command: "..." }` JSON 壳**：直接渲染 JSON 用户看不清命令，要提取 `args.command` 单独渲染
- **按钮横向一排**用户不接受，要**独占一行全宽**（操作台大档位感）

### 单元测试审查（2026-08-26，vitest 方法论：枚举分支对照覆盖）

**发现 4 处实现缺陷（测试没兜住）**——同一类："子命令表只读、但参数能走私写操作"，对照 Reasonix `nestedReadOnlyArgsSafe` 参数级检查逐条核对才暴露：

| 命令 | 原判定 | 修复 |
| --- | --- | --- |
| `git tag v1.0`（创建 tag） | 误放行 | 拦截（只在列出时只读） |
| `go env -w GOBIN=x` | 误放行 | 拦截（env -w/-u） |
| `npm audit fix` | 误放行 | 拦截（audit fix） |
| `cargo check/doc` | 误放行 | cargo 整表去掉 → fail-closed |

**教训**：fail-closed 的底线是"宁可多弹框，不可漏放行"，这 4 处全是**漏放行**方向；补测试要靠对照参考源码的参数级检查清单，不是凭感觉。另补：decided 必须带 outcome（审计核心信息）、损坏 JSON fail-closed、脏数据空集兜底、append 重复 ask 拒绝。

**补测后**：readonly 22 + approval-log 14 + approval-memory 10 = 46 用例（permission 目录），全量 20 文件 164 用例全绿。

### 参考项目查证结论（回答"三档是不是自创"）

| 项目 | 档位 | 切换入口 |
|---|---|---|
| pi | ask / always / never | /settings |
| codex | on-request / never | CLI |
| DSH | workspace-write(ask) / danger-full-access(never)，outcome 有 yolo | /permission + UI |
| CodeWhale | Auto / Bypass / Suggest / Never | Shift+Tab |
| Reasonix | yolo / auto 等 | 模式命令 |

→ 信任档位是参考项目普遍设计，运行时切换入口也是标配——都做了。
