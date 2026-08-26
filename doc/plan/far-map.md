# doc/plan/far-map —— 远期功能地图（开源 Agent 盘点提炼）

> 来源：PLAN.md 第十二章（2026-08-26 PLAN 拆解时移入 doc/plan/）。定位：**很后期**——主线（Phase 5/6）走稳后再回头。每一项都已确认"长在哪个接缝"，**不需要为此改架构**——这是"接缝由需求逼出来"的运用：先登记在路线图（文档级预留），需求真来了再实现。
> 完整施工单（含三阶段排期与验收标准）见主 PLAN 第十三节 13.3 排期表。

## Top 5（按"学到的东西 ÷ 改动量"排序）

| # | 功能 | 参考 | 长在哪 | 前置 |
|---|---|---|---|---|
| 1 | **仓库地图（repo map）** | [Aider](https://aider.chat/docs/repomap.html) | `lib/tools/` 新工具 `repo_map`：解析 import 引用边 + 按任务关键词 BFS 选相关文件压进上下文 | 无 |
| 2 | **Skills（.md 即技能）** | Claude Code / pi `.pi/skills/` / DSH `packages/skill` | `app/api/chat/route.ts` 的 systemPrompt 组装处 + 根目录 `skills/` 目录（加载函数按描述注入） | 无 |
| 3 | **分级权限（auto/plan/ask）** | Cline / Roo Code / Codex | `app/api/chat/route.ts` 的 `TOOLS_NEEDING_CONFIRM` 判定处：弹框加"本次会话记住"→ 会话级偏好 → 命中即放行；plan 档 = 模型只出计划 | 无 |
| 4 | **hooks 化**（`beforeToolCall` → 钩子注册表） | Claude Code / DSH `packages/hooks` | `lib/agent.ts`（引擎只触发、不实现，同 `onToolOutput` 透传模式）；`lib/hooks.ts` 注册表 `onBeforeTool`/`onAfterTool` | 无 |
| 5 | **代码执行器（Python 沙箱）** | smolagents `local_python_executor` | `lib/tools/` 新工具 `python`：复用 BashRunner 的进程管理 + stdout 捕获，"代码即动作" | 无 |

## 远期其他项

| 功能 | 参考 | 长在哪 | 前置 |
|---|---|---|---|
| MCP 生态 | Cline / smolagents `mcp_client.py` | ToolRegistry 注册外部工具源 | 工具系统稳定后 |
| 沙箱容器 | OpenHands / DSH `packages/sandbox` | BashRunner 同级的新 Runner（真隔离） | 安全课题单独立项 |
| 多智能体（handoffs 交接） | OpenAI Agents SDK | `runAgentLoop` 嵌套调用（子智能体=再跑一个 loop） | Phase 5 子智能体委派 |
| 定时任务 | DSH `packages/schedule` | 产品层新 Runner | 无 |
| 分析面板 | OpenHands / DSH `packages/feedback` | trace L3 Viewer（Phase 6）的延伸 | Phase 6 |
| 个人行为偏好 | 各家配置体系 | 设置页 + 系统提示词注入 | 设置页之后 |

## 五个共同规律（判断"要不要学"的尺子）

1. **配置即文件**：`.pi/skills/*.md`、"设置页"的本质是读写配置文件，不是独立系统。
2. **hooks 是标准扩展点**：Claude Code、DSH 都有 hooks 包；我们的 `beforeToolCall` 已是雏形。
3. **记忆分层是标配**：上下文（短期）→ 摘要（长期）→ 外部记忆；我们已到"真摘要"层（B2 ③ 完成），外部记忆未做。
4. **权限分级是共识**：auto / plan / ask 三档；我们已在"ask 全量"这一档。
5. **成熟产品必有沙箱**：OpenHands 容器、Codex 双层、DSH sandbox；我们是"路径沙箱 + 人工确认"的轻量版。
