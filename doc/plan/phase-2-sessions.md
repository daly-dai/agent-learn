# doc/plan/phase-2 —— Phase 2 多个会话（施工补记）

> 来源：PLAN.md 第六章 Phase 2 段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**，保留作施工历史。

## 目标

- 一个 session = 一个 JSONL 文件。`SessionManager` 负责 list/create/rename/delete（switch 只是换前端用的 sessionId）。
- 前端加左侧会话列表；切换会话 = 前端换 `sessionId`，所有 API 调用随之切换。
- 这一步之后，"对话面板"就有了会话维度。

## 实现前补记（AGENTS.md：先想清楚再动手）

- 会话身份：id = 文件名（稳定身份，如 `s_<时间戳+随机>`）；显示名 = `title ?? id`。`SessionEntry` 的 session 头加可选 `title` 字段（向后兼容：旧文件没有就回退显示 id）；**重命名只改头里的 title，不改文件名**——id 是身份，title 是给人看的名字。
- 接口分工：`/api/sessions` 管「会话本身」（GET 列表 / POST 新建 / PATCH 重命名 / DELETE 删除）；`/api/chat` 管「会话里的对话」（POST 发消息 / GET 历史 / DELETE 清空当前会话消息）。**清空 ≠ 删除**，两个都保留。
- `SessionManager` 只管目录级操作（list/create/rename/delete/sessionPath）；对话读写仍用 `JsonlSessionStore`（每请求新建，保持「内存 = 磁盘」）。`list()` 轻量扫目录：解析头 + 数消息 + 首条用户消息预览 + 文件 mtime 当更新时间。
- **安全（必须）**：sessionId 必须匹配 `^[a-zA-Z0-9_-]+$` 否则 400——否则 `join(sessionDir, "../../x.jsonl")` 路径越界。这是 tools.ts 路径沙箱（resolveInsideWorkspace）的精神在会话层的补课。
- 前端：新 `useSessions` hook 管列表 + currentId；`useAgentRun({sessionId})` 所有 fetch 带 sessionId，sessionId 变化时清空本地状态并拉新会话历史。删除当前会话后自动切到列表第一个。
- 布局：`.deck` 两列变三列 `240px minmax(0,1fr) 348px`（侧栏 + 对话面 + 轨迹）；侧栏视觉沿用走纸记录仪语言（明度分层 + 等宽字体）。
- 暂缓：会话树分支切换（`switchLeaf`，那是会话内的岔路）、标题自动生成（从首条消息摘）、归档/排序、并发写锁。
