# doc/plan/phase-3 —— Phase 3 文件增删改查（施工补记）

> 来源：PLAN.md 第六章 Phase 3 段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**，保留作施工历史。

## 目标

- 扩展 `ToolRegistry`：`read_file`（已有）、`write_file`（任意路径）、`edit_file`（旧串→新串替换）、`delete_file`、`grep`、`find`、`list_files`（已有）。
- 保留并强化路径沙箱（`resolveInsideWorkspace`）。
- 对应 pi：`packages/agent/src/harness/tools/{read,write,edit,edit-diff,path-utils}.ts` + `packages/coding-agent/src/core/tools/{find,grep,ls}.ts`。

## 实现前补记（AGENTS.md：先想清楚再动手）

- 新工具清单（参数见 `lib/tools/` 各工具文件）：`write_file`（任意路径 + 自动建父目录）、`edit_file`（唯一 oldText→newText 替换：找不到/多处都报错回给模型）、`delete_file`、`grep`（正则搜内容，无效正则转 isError）、`find`（文件名 `*` 通配）。全部复用 `resolveInsideWorkspace`。
- **write_note 保留并存**（已确认）：它是「只写 notes/」的低危特例，`write_file` 是通用入口——同一种能力两种危险等级，审批策略不同（教学点）。
- **edit_file 形态**（已确认）：形态 A 最简版「唯一 oldText→newText 替换」。模糊匹配（智能引号/破折号归一化，pi 的做法）和 diff 式编辑都留作扩展。
- **审批策略**（已确认）：读类（list/read/find/grep）默认放行；写类（write_note/write_file）放行但拦截「secret/秘密」文件名；**delete_file 默认 block**（演示审批机制），`ALLOW_FILE_DELETE=true` 环境变量可放行——「策略配置」的教学样例。
- **grep 细节**（已确认）：JS 正则；默认最多 50 条匹配，超出提示「共 N 条，显示前 M」；每行截断 200 字符；读文件失败（二进制等）跳过不崩。
- 暂缓：edit 模糊匹配、diff 式编辑、符号链接逃逸防护、二进制识别、并发写锁、前端删除确认弹窗（等 Phase 5/6 的交互通道）。
- **人工确认（已确认：全部写操作弹框 + 60s 超时自动拒绝）**：`write_note`/`write_file`/`edit_file`/`delete_file` 每次调用都弹框让用户当场允许/拒绝，不再依赖硬编码策略。实现：`beforeToolCall` 是 async 钩子——识别写/改/删 → SSE 推新帧 `tool_permission_request`（toolCallId/工具名/参数）→ await 挂起的 Promise（`lib/toolApproval.ts` 的 pending 注册表，globalThis 挂载防 dev 多 worker 不共享）→ 前端弹框 → `POST /api/chat/approve` 回传决定 → resolve 放行/拦截。60 秒不点自动拒绝（block 结果回给模型解释）。硬性安全策略（secret/秘密 文件名）仍不弹框直接拦。**`ALLOW_FILE_DELETE` 开关被弹框机制取代，移除**。会话/全局「记住选择」留待以后。
- 测试：Phase 6 补框架；`tools.ts` 是全项目最适合先补单测的模块（纯函数 + node:fs），届时从这里开始。
