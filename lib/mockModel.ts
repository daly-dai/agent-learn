// ============================================================
// MockModel —— 教学用模拟模型
// 不依赖任何 API Key，根据用户输入关键词决定行为
// 对应 teaching-agent/src/server/agent/mockModel.ts
// ============================================================

import type { AssistantMessage, ToolResultMessage } from "./types";
import { createAssistantMessage, messageText, text } from "./message";
import type { CompleteInput, TeachingModel } from "./model";

// 模拟真实模型的网络延迟（毫秒）。真实的 LLM 一次请求要几百毫秒到几秒，
// 加上这个延迟后，SSE 流式输出才能"看得见"——否则所有事件瞬间发完，看不出先后。
// 如果不需要演示流式，把 DELAY 改成 0 即可。
const DELAY_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockModel implements TeachingModel {
  async complete(input: CompleteInput): Promise<AssistantMessage> {
    await sleep(DELAY_MS);
    const last = input.messages[input.messages.length - 1];
    if (!last) {
      return createAssistantMessage([text("还没有上下文。")]);
    }

    // 上一轮是工具结果 → 基于结果生成最终答案
    if (last.role === "toolResult") {
      return this.answerFromTool(last);
    }

    // 不是用户消息 → 等待
    if (last.role !== "user") {
      return createAssistantMessage([
        text("当前没有新的用户目标，我会等待下一条输入。"),
      ]);
    }

    // 根据用户输入关键词决定是否调用工具
    const userText = messageText(last).toLowerCase();

    if (this.includesAny(userText, ["列出", "文件列表", "list", "files"])) {
      return createAssistantMessage(
        [
          {
            type: "toolCall",
            id: `call_${Date.now()}_list`,
            name: "list_files",
            arguments: { path: "." },
          },
        ],
        "toolUse",
      );
    }

    if (this.includesAny(userText, ["读取", "read", "打开", "查看", "内容"])) {
      return createAssistantMessage(
        [
          {
            type: "toolCall",
            id: `call_${Date.now()}_read`,
            name: "read_file",
            arguments: { path: this.pickFile(userText) },
          },
        ],
        "toolUse",
      );
    }

    if (this.includesAny(userText, ["写", "笔记", "note", "保存"])) {
      const fileName = this.includesAny(userText, ["secret", "秘密"])
        ? "secret-note.md"
        : "agent-loop-note.md";
      return createAssistantMessage(
        [
          {
            type: "toolCall",
            id: `call_${Date.now()}_write`,
            name: "write_note",
            arguments: {
              fileName,
              content: "Agent Loop = context -> model -> tool execution -> tool result -> next model request.",
            },
          },
        ],
        "toolUse",
      );
    }

    // 默认：直接文本回答
    return createAssistantMessage([
      text(
        "教学版 Agent 收到你的问题。\n\n" +
        "当前 MockModel 会在你提到以下内容时调用工具：\n" +
        "• **列出文件** → 调用 list_files\n" +
        "• **读取/查看** → 调用 read_file\n" +
        "• **写笔记/保存** → 调用 write_note\n\n" +
        '其他问题会直接回答。试试说「列出工作区文件」或「读取 agent-notes.md」。',
      ),
    ]);
  }

  private answerFromTool(toolResult: ToolResultMessage): AssistantMessage {
    const output = messageText(toolResult);

    if (toolResult.isError) {
      return createAssistantMessage(
        [text(`工具 ${toolResult.toolName} 执行失败：${output}`)],
        "stop",
      );
    }

    if (toolResult.toolName === "list_files") {
      return createAssistantMessage([text(`我已经列出工作区文件：\n${output}`)]);
    }

    if (toolResult.toolName === "read_file") {
      return createAssistantMessage([
        text(`我读取到了文件内容。关键内容如下：\n${output}`),
      ]);
    }

    if (toolResult.toolName === "write_note") {
      return createAssistantMessage([text(`笔记已经写入：${output}`)]);
    }

    return createAssistantMessage([text(`工具结果：${output}`)]);
  }

  private includesAny(input: string, keywords: string[]): boolean {
    return keywords.some((keyword) => input.includes(keyword));
  }

  private pickFile(input: string): string {
    if (input.includes("agent")) return "agent-notes.md";
    if (input.includes("package")) return "package.json";
    return "README.md";
  }
}
