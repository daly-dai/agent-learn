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
