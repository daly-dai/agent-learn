# doc/plan/c13-slash-commands —— C13 斜杠命令面板（立项补记）

> 来源：PLAN.md "C13 斜杠命令面板·立项补记"段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**⏳ 排队（用户拍板"一步到位"，未开工）**——等 B2 ③ 收尾后做，/compact 手动压缩口子等它落地。

> 触发：用户指出成熟 agent 都有自带斜杠命令（DeepSeek CLI 自带压缩/导出/模型选择/skill 列表；pi `BUILTIN_SLASH_COMMANDS` 22 个内置命令；Reasonix `.reasonix/commands/*.md` 命令即文件；codex `/compact /review`）。我们 PLAN 无此规划——缺口。**决定：直接做命令面板，不做"独立 API + 按钮"中间过渡**（有现成成熟参考项）。

**pi 机制精读结论**（`core/slash-commands.ts` + `interactive-mode.ts:675-773`）：
- **命令模型**：`SlashCommandInfo { name, description, source: "extension"|"prompt"|"skill", sourceInfo }`——命令有来源分类
- **内置命令表**：`BUILTIN_SLASH_COMMANDS`（settings/model/tree/thinking/export/import/compact/…22 个）
- **聚合**：内置 + 提示词模板 + 扩展命令 + 技能（`skill:xxx`）全部转成 SlashCommand 进**同一个自动补全**——命令 = 统一功能入口抽象
- **参数补全**：每个命令可挂 `getArgumentCompletions`（如 /model 补全 `provider/model`、/thinking 补全级别）
- **执行**：斜杠命令在输入时识别（不走模型），各走各的处理逻辑

**我们第一批命令**（对齐 DeepSeek 自带那几项）：
- `/compact`——手动压缩当前会话（**核心**：接 B2 ③ 的 prepare→generate→commit 三步，复用共享函数）
- `/model`——模型选择/展示（config 驱动；切换接口按 selectModel 扩展）
- `/skills`——技能列表（C8 未做，先占位展示"规划中"或列 PLAN）
- `/export`——导出当前会话（下载 JSONL，简单）

**设计**：
- **`lib/commands/` 注册表**：`SlashCommand { name, description, argumentHint?, run(args, ctx) }`——同 ToolRegistry 思路，一命令一文件
- **后端**：`app/api/chat/compact/route.ts`（手动压缩端点，返回 { ok, summary, tokensBefore }）；命令执行 = 调对应 API
- **前端**：输入框识别 `/` 开头 → 命令补全下拉（name + description）→ 选中执行（不走模型，直接调 API）；结果作为系统消息展示
- **验收**：输入 `/` 弹命令列表 → 选 /compact → 会话被压缩 → 前端出现压缩卡片（compactionSummary 渲染已有）；/export 下载会话文件；/model 展示当前模型

**关联**：`compactSession` 共享函数（从 route.ts 抽出的三步）同时服务自动路径（run 结束后）和 /compact 命令——对齐 DSH 的 compactIfNeeded / compactNow 共享底层。

---

## 补记 1：综合调研定案（2026-08-27）

> **触发**：用户要求验证"方案是否综合了多个成熟 agent"→ 精读 codex 命令源码（`codex-rs/tui/src/bottom_pane/`）+ 复核 DSH（node_modules 排除后全文检索）。**结论：原方案方向不变**（`lib/commands/` 注册表 + 命令走 API），但补入 codex 的五个成熟元素；DSH 无命令面板实现，"参考 DSH"的表述为误记，更正。

### codex 机制精读（比 pi 更完整的参考系）

**① 提交验证（`slash_input.rs:35-87`）——`SubmissionValidation { Valid, UnknownCommand(String) }`**
输入以 `/` 开头但名字不在注册表 → 提交时报 UnknownCommand（可给"输入 /help 查看命令"提示），**不是静默当普通消息发**。这是"命令是命令、消息是消息"的硬边界，我们也要：命令拼错必须报错，不能让模型收到 `/copmact` 当正文。
- 例外：`input_starts_with_space`（行首空格）或 name 含 `/`（路径）→ 不拦截——避免粘贴的代码/路径被误判命令。

**② 行首/首行检测（`slash_input.rs:89-127`）**
- `bare_command`：只取**第一行**解析（`text.lines().next()`），rest 为空 → 裸命令
- `should_parse_on_dequeue`：`!text.starts_with(' ') && text.trim().startsWith('/')`——**行首无空格 + trim 后以 / 开头**才在出队时按命令解析
- 结论：命令识别只看首行、不看多行；开头空格是退出符（不是行首）

**③ `parse_slash_name` 纯函数（`prompt_args.rs`）——seam 原型**
`line → Option<(name, rest, rest_offset)>`：strip `/` → 取到首个空白前的 name → rest = trim_start 后的参数 → **rest_offset = 参数在原文中的偏移**（光标/选区编辑用）。无状态、可单测——这就是我们 `lib/commands/parse.ts` 要抄的形状。

**④ 行内参数（inline_args + rest_offset）**
`InlineCommand { command, rest, rest_offset }`：命令声明 `supports_inline_args()` 才接受行内参数（`/model gpt-4o` 是行内；`/skills` 不支持行内，裸执行）。区分"带参数命令"和"不带参数命令"是命令模型的一等概念，不是字符串尾处理。

**⑤ 别名与条件显示**
- 别名：`slash_command.rs` 用 strum 标注，如 `#[strum(to_string = "pwd", serialize = "cwd")]`——**主名进 popup 列表、别名只认不显**（`ALIAS_COMMANDS = [Quit, Btw]` 注释：每个唯一动作在列表只出现一次）；`/quit=/exit`、`/stop=/clean`
- 条件显示：`BuiltinCommandFlags`（slash_commands.rs）门控——Plan 在 collaboration modes 关闭时隐藏、Usage 在 token activity 关闭时隐藏、ElevateSandbox 在 Windows 降级沙箱才显示；**popup 与 composer 共享同一份过滤**（`commands_for_input`，command_popup.rs 注释 "Keep built-in availability in sync with the composer"）
- 对我们的启示：我们暂时没有 Plan/Apps/Usage 这类功能开关，但**命令模型里保留 `available: (ctx) => boolean` 字段**（默认 true），C 阶段功能上线时按开关隐藏，不重构。

### DSH 复核结论（更正误记）

DSH（deepseek-harness）**无斜杠命令面板实现**：node_modules 排除后全仓检索 `slash`/命令相关零命中。原 08-26 记"参考 DSH"为误记。DSH 的组合机制是 cordis DI + slot 注册表（`packages/client/ui-conversation/src/client/apply.ts`）：组件之间零 import，靠 `slots.register` 占座 + `renderSlot` 求值 + `sessions.provide` 能力分发 + `declare module` 类型合并。**启示**：DSH 的 slot 模式是"30+ 包并行、谁都能往别人 UI 塞东西"的组织形态；我们单仓库无此需求，`lib/commands/` 注册表 Map（同 ToolRegistry）就是对的——抽象服务于组织形态，不是越抽象越好。

### seam 更新（B8 ① 先写单测的纯函数层）

`lib/commands/parse.ts`（纯函数，无依赖，单测友好）：
- `parseSlashName(line): { name, rest, restOffset } | null`——抄 codex `parse_slash_name`
- `validateSubmission(text, registry): { ok: true } | { ok: false, name }`——抄 `SubmissionValidation`（行首空格/含 / 不拦截）
- `isSlashCommandLine(text): boolean`——`!starts_with(' ') && trim().startsWith('/')`（首行语义）

`lib/commands/index.ts`（注册表）：
- `SlashCommand { name, description, aliases?, supportsInlineArgs?, available?(ctx), run(args, ctx) }`——合并 pi 的 source 分类与 codex 的 alias/inline/flags

### 决策问题（等用户拍板）

- **Q1 注册表位置**：A（推荐）`lib/commands/` 独立目录（同 `lib/tools/`，命令=工具家族的第二成员）；B `_pipeline/commands.ts` 塞管线旁（不推荐：命令是产品功能不是管线部件）
- **Q2 第一批范围**：A（推荐）先只做 `/compact` 一个，走通"parse → 注册 → popup → 执行 → 结果卡片"全链路再批量；B 一次性 `/compact /model /skills /export` 四个（参考项齐但联调面大）
- **Q3 命令分类**：`/model /skills` 纯前端（读 config / 展示列表，不走 API）；`/compact /export` 后端（调 API）。分类影响执行器接口：`run` 是同步（前端）还是 async（后端）——建议统一 async + `ctx` 携带 `api` 通道，前端命令不填即可
