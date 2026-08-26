# doc/plan/phase-5 —— Phase 5 task 面板（施工补记）

> 来源：PLAN.md 第六章 Phase 5 段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**，保留作施工历史。

## 目标

- 引入"任务/计划"概念：模型产出 todo list，前端渲染成可勾选面板；或你手动拆任务，agent 逐条执行。
- 后期可加 subagent 委派（把子任务交给子 agent 跑，汇总结果）。DSH 和 pi 的扩展系统都是这个方向。
- 先做最简单版：session 内持久化一个 todo 数组 + 面板展示，跑通再谈多 agent。

## 实现前补记（2026-08-22，来源：走读 07 DSH todo + 走读 18 Reasonix TodoPanel）

**核心思想：todo 是会话事件，不是独立存储**（DSH 走读 07）——`SessionEntry` 加 `type: "todo"` 条目，与对话同生命周期、可回放、可审计。前端形态抄 Reasonix TodoPanel（走读 18）：进度徽章 + 当前任务 + 折叠。

- **数据模型**（`lib/types.ts`）：`TodoItem = { content: string; status: "pending" | "in_progress" | "completed" }`；`SessionEntry` 加 `{ type: "todo", id, parentId, timestamp, todos: TodoItem[] }`。
- **工具**（`lib/tools/todo.ts` 新文件）：`todo_write`，**整表替换语义**（工具描述写明"Send the ENTIRE list every call, it REPLACES the previous list"——幂等，模型不会漂移）；校验 content trim 非空 + 去重 + 最多一个 in_progress（教学版固定单 active，allowParallel 留扩展）；返回 `counts { pending, inProgress, completed }` + 完整 todos（给模型的即时反馈）；**不进 `TOOLS_NEEDING_CONFIRM`**（低危：只改会话内 todo 列表，不碰文件）。
- **写会话机制**（仿 onToolOutput 旁路模式，引擎只透传）：`ToolExecutorOptions` 加 `onTodoWrite?: (todos) => void`；todo 工具 execute 调它；route.ts 注入 `(todos) => store.appendTodo(todos)`；`lib/agent.ts` executeToolCall 原样透传（与 onChunk 同模式，其他工具零改动）。
- **Store**（`lib/session/store.ts`）：`appendTodo(todos)`（复用 appendEntry）+ `getLatestTodos()`（叶子回溯找最新 todo 条目）。
- **API**（`app/api/chat/route.ts`）：POST 新增 SSE 帧 `{ type: "tool_todo", todos }`（run 中实时更新面板），done 帧带 `todos`（权威值）；GET 返回 `todos`（挂载/刷新恢复）。
- **前端**（`app/components/task-panel/` 新组件）：进度徽章 `done/total` + 当前任务（in_progress）+ 状态标签 + 折叠（默认折叠）；数据源 = GET todos（初始）+ tool_todo 帧（run 中）+ done 帧（最终）；**只读展示**（todo 唯一写者是模型，与 DSH/Reasonix 一致——"可勾选"改为"可查看进度"，勾选交互暂缓）。
- **系统提示词**：加 todo_write 工具说明（复杂任务先列任务清单，任务完成/进度更新时调用）。
- **验收标准**（改自第十三节 A1）：模型在复杂任务时产出 todo_write 调用 → 会话落盘 → 前端面板显示进度 → 刷新/切换会话不丢。

## Phase 5 增补（2026-08-24）：TodoPanel 关闭交互（抄 Reasonix todoVisibility）

> 背景：调研 7 项目（DSH/tether/Reasonix/CodeWhale/codex/pi/我们）发现"关闭"分三派——不提供（DSH/我们）、随时可关（tether 抽屉级/CodeWhale /rail off）、**未完成强制可见 + 全完成才可关**（Reasonix）。选 Reasonix 式，因为它最符合 todo 面板的存在意义：任务没做完不该被藏起来，关闭是"清理已看完的清单"的单向动作。

- **判定是派生状态，不是事件点**：`show = todos.length > 0 && (有未完成 || !dismissed)`——每次渲染根据当前 todos + dismissed 重算（GET 恢复 / tool_todo 帧 / done 帧三条数据路径自然触发），幂等纯函数，不需要"记住上次判定"。只有两个事件：初始读 localStorage、点 X 写 localStorage。
- **dismissed 只对"全完成"生效**：只要有未完成任务，强制显示（忽略 dismissed）→ 新任务到来面板自动复活，无需额外逻辑。
- **存储**：`localStorage`，key 按 sessionId 隔离（`todoPanel:dismissed:<sessionId>`）——纯前端状态，后端零改动（todo 数据仍在会话里，面板可见性是前端视图状态）。
- **改动范围**：`app/components/task-panel/index.tsx`（加 `useState(dismissed)` + 全完成时头部显示 X 按钮 + `show` 判定）+ `task-panel.module.css`（X 按钮样式，沿用走纸记录仪笔色 `--pen-signal` 或 `--ink-faint`）。
- **验收**：任务全完成 → 面板出现 X → 点击后面板消失 → 刷新仍消失（localStorage）→ 模型写新任务（未完成）→ 面板自动复活 → 切换会话互不影响（按 sessionId 隔离）。

## 2026-08-26 更新：todo 面板最后一项卡 in_progress 修复

- **根因**：todo 是"模型行为的镜像"——面板显示 = 模型最后一次 todo_write 的整表；模型做完任务后没再调 todo_write 全标 completed，面板就停在 in_progress。
- **修法**：系统提示词补硬规则"任务全部完成时，必须再调用一次 todo_write 把整表所有条目标记为 completed，不要留 in_progress 尾巴"。
- **注意**：已发生的会话不会自动修复（旧表停在原地），下次模型写 todo 时按新规则走。
