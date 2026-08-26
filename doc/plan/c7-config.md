# doc/plan/c7-config —— C7 前置 · 配置整合（施工补记）

> 来源：PLAN.md "C7 前置·配置整合"段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**骨架已建并提交**（`lib/config.ts`，2026-08-25）；**C7 设置页 UI 未做（排队）**。

> 触发：用户要求"项目里零零散散的配置（写死在代码里）都要变成可配的"，且要为多 provider（不止 DeepSeek）留口子。这是 C7 设置页（PLAN 13.3 C7 行）的前置——先有统一配置入口，设置页 UI 才能读写它。

**已完成（2026-08-25）**：`lib/config.ts` = 全项目配置唯一入口。结构：
- `config.provider`：当前厂商（默认 deepseek），每厂商自带 `contextWindow/reserveTokens/keepRecentTokens/keepRecentMessages`（压缩阈值随 provider 走）
- `config.modelSecrets`：apiKey / mockMode（适配层用）
- `config.paths`：workspace / traces / sessions（环境变量可覆盖）
- `config.approval` / `config.bash`：超时等行为参数
- `shouldCompact()`：对齐 pi 触发判断（`token > 窗口 - 预留`）

**2026-08-26 增补（env 测试口子）**：`CONTEXT_WINDOW`（默认 1_000_000）/ `RESERVE_TOKENS`（默认 16_384）/ `KEEP_RECENT_MESSAGES`（默认 8）/ `MIN_COMPACT_TOKENS`（默认 400，经济性检查 D6）/ `MAX_TURNS`（默认 16）全部 env 可覆盖；`.env.local` 已恢复正常值（测试口子用完即还原）。

**已收编的硬编码**：route.ts 路径/压缩阈值/审批超时、sessions/route.ts 路径、deepseekModel 的 model/baseUrl/debug、bash-runner 超时/输出上限。全部经 `lib/config.ts`，环境变量可覆盖。

**将来（C7 设置页，未做）**：
- **UI 读写**：设置页把配置持久化（写 `config.json` 或类似），不再只靠 `.env.local`——对齐 pi `.pi/` 配置即文件思想（PLAN 十二节五规律 1）
- **provider 注册**：加 Anthropic / OpenAI / ollama 时 = `lib/config.ts` 的 PROVIDERS 加一项 + 适配器 + route.ts 分支（骨架已留）
- **审批策略可配**（B1 关联）：`TOOLS_NEEDING_CONFIRM` 等从硬编码变配置

**原则**：配置是"横切关注点"（综述 13.1 注），不进引擎；`lib/config.ts` 是唯一入口，引擎/工具不直接读 `process.env`。
