# 归档：七、Phase 0 实现要点（DeepSeek 适配器）

> 来源：PLAN.md 第七章（2026-08-26 PLAN 拆解时归档）。Phase 0 施工单，**已实现并提交**（`lib/deepseekModel.ts` 等），保留作历史参考。

### 6.1 接口约定
- Base URL：`https://api.deepseek.com`（OpenAI 兼容；也接受 `/v1` 前缀）。
- 鉴权：`Authorization: Bearer <DEEPSEEK_API_KEY>`。
- 模型：`deepseek-chat`（支持工具调用）；`deepseek-reasoner` 是思考模式，历史上**不支持** function calling（以官方文档为准），所以做 agent 工具循环先用 `deepseek-chat`。

### 6.2 消息转换（进模型前）
把 `AgentMessage[]` 转成 OpenAI messages：
- `user` → `{ role: "user", content: text }`
- `assistant` → `{ role: "assistant", content, tool_calls: [...] }`（tool call 的 `arguments` 转成 JSON 字符串）
- `toolResult` → `{ role: "tool", tool_call_id, content }`（**`tool_call_id` 必须与上面的 tool call id 对齐**，丢了模型就不知道结果对应哪次调用）

### 6.3 响应转换（出模型后）
写 `toTeachingAssistantMessage()`（对应 `build-08-real-model.md`）：
- `content` → `{ type: "text", text }`（`null` 时不生成空文本块）
- `tool_calls[].function.arguments` → **先 `JSON.parse`**，失败时包装成 `isError` 的 tool result，别让进程崩
- `finish_reason === "tool_calls"` 或 `toolCalls.length > 0` → `stopReason: "toolUse"`

### 6.4 流式（关键坑）
- 请求带 `stream: true`，逐行读 SSE，`data: [DONE]` 结束。
- `delta.content` 逐段累积成文本；`delta.tool_calls[i].function.arguments` 也是分片 JSON 字符串，**必须按 index 累积，finish 后再 parse**，不能每段都 parse。
- 文本累积过程发 `message_update` 事件（前端 `applyFrame` 里现在的注释已经预留了这个位置）。

### 6.5 错误收尾
- HTTP 401/429/500 → `AssistantMessage.stopReason = "error"` + `errorMessage`。
- 网络断流 → 已累积文本作为 partial 发出，仍发 `message_end` 或错误事件。

> 完整对照参考：`E:\agents-read\how-pi-agent-works\docs\project\build-08-real-model.md`，以及可运行示例 `how-pi-agent-works/examples/demos/05-openai-compatible.ts`。
