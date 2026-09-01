// ============================================================
// summarize.test.ts —— 摘要生成（B2 ③）单元测试
// ============================================================
// 覆盖：
//   - serializeConversation：各角色序列化（User/Assistant/toolCall 参数摘要/
//     toolResult 截断/compactionSummary 原样带过）
//   - generateSummary：正常返回 / error 返回 null / 空输出返回 null /
//     previousSummary 增量（UPDATE prompt）
// ============================================================

import { describe, expect, it } from "vitest";
import {
  generateSummary,
  serializeConversation,
} from "./summarize";
import {
  createAssistantMessage,
  createCompactionSummaryMessage,
  createUserMessage,
  messageText,
  text,
} from "./message";
import type { AgentMessage, UserMessage } from "./types";
import { FakeModel } from "./testing/fake-model"; // B16：共享假模型基建

/** 取 user 消息的纯文本（断言提示词内容用） */
function userText(message: AgentMessage): string {
  return messageText(message as UserMessage);
}

describe("serializeConversation —— 消息 → 文本", () => {
  it("序列化 user / assistant 文本 / 工具调用 / 工具结果", () => {
    const messages: AgentMessage[] = [
      createUserMessage("帮我写排序"),
      createAssistantMessage(
        [
          text("好的，我来写"),
          {
            type: "toolCall",
            id: "c1",
            name: "write_file",
            arguments: { path: "sort.ts", content: "长内容…" },
          },
        ],
        "toolUse",
      ),
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "write_file",
        content: [text("已写入 sort.ts")],
        details: {},
        isError: false,
        timestamp: 0,
      },
    ];

    const out = serializeConversation(messages);

    expect(out).toContain("[User]: 帮我写排序");
    expect(out).toContain("[Assistant]: 好的，我来写");
    // 工具调用：参数只摘要成 key 列表（Reasonix D7：防长 JSON 泄漏）
    expect(out).toContain(
      "[Assistant tool calls]: write_file({path, content} (2 keys))",
    );
    expect(out).toContain("[Tool result]: 已写入 sort.ts");
  });

  it("toolResult 超过 2000 字符被截断（pi：防工具输出撑爆摘要请求）", () => {
    const long = "x".repeat(3000);
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read_file",
        content: [text(long)],
        details: {},
        isError: false,
        timestamp: 0,
      },
    ];

    const out = serializeConversation(messages);
    expect(out.length).toBeLessThan(2200);
    expect(out).toContain("more characters truncated");
  });

  it("compactionSummary 原样带过（多次压缩时供增量合并）", () => {
    const messages: AgentMessage[] = [
      createCompactionSummaryMessage("## Goal\n旧目标", 100, Date.now()),
    ];

    const out = serializeConversation(messages);
    expect(out).toContain("[Compaction summary]: ## Goal");
  });

  it("空内容消息不产生空行", () => {
    const messages: AgentMessage[] = [
      createUserMessage("只有一条"),
      createAssistantMessage([text("")]),
    ];
    const out = serializeConversation(messages);
    expect(out).toContain("[User]: 只有一条");
    expect(out).not.toContain("[Assistant]:");
  });
});

describe("generateSummary —— 调模型生成摘要", () => {
  it("正常返回：请求结构正确（独立请求、不带工具、含 conversation 与格式指令）", async () => {
    const model = new FakeModel((input) => {
      expect(input.systemPrompt).toContain("summarization assistant");
      expect(input.tools).toEqual([]); // 摘要请求不带工具
      expect(input.messages).toHaveLength(1);
      expect(input.messages[0].role).toBe("user");

      const prompt = userText(input.messages[0]);
      expect(prompt).toContain("<conversation>");
      expect(prompt).toContain("[User]: 帮我写排序");
      expect(prompt).toContain("## Goal"); // EXACT 格式指令
      expect(prompt).toContain("## Files and Code"); // DSH 吸收段
      expect(prompt).not.toContain("<previous-summary>"); // 首次压缩不带旧摘要

      return createAssistantMessage([text("## Goal\n写排序算法")]);
    });

    const summary = await generateSummary(model, [
      createUserMessage("帮我写排序"),
    ]);
    expect(summary).toBe("## Goal\n写排序算法");
  });

  it("有 previousSummary 时用 UPDATE prompt 并携带旧摘要（pi 增量更新）", async () => {
    const model = new FakeModel((input) => {
      const prompt = userText(input.messages[0]);
      expect(prompt).toContain("<previous-summary>");
      expect(prompt).toContain("旧目标");
      expect(prompt).toContain("PRESERVE all existing information");
      expect(prompt).not.toContain("Create a structured context checkpoint");

      return createAssistantMessage([text("## Goal\n合并后的目标")]);
    });

    const summary = await generateSummary(
      model,
      [createUserMessage("新消息")],
      { previousSummary: "## Goal\n旧目标" },
    );
    expect(summary).toBe("## Goal\n合并后的目标");
  });

  it("模型返回 error → null（降级信号，不把假摘要当真）", async () => {
    const model = new FakeModel(() => ({
      role: "assistant",
      content: [text("[模型错误] 失败")],
      stopReason: "error",
      usage: { input: 0, output: 0, totalTokens: 0 },
      timestamp: Date.now(),
    }));

    expect(
      await generateSummary(model, [createUserMessage("x")]),
    ).toBeNull();
  });

  it("模型返回 aborted → null", async () => {
    const model = new FakeModel(() => ({
      role: "assistant",
      content: [text("（请求已中止）")],
      stopReason: "aborted",
      usage: { input: 0, output: 0, totalTokens: 0 },
      timestamp: Date.now(),
    }));

    expect(
      await generateSummary(model, [createUserMessage("x")]),
    ).toBeNull();
  });

  it("空输出 → null（DSH D9：fail-closed，不落半截摘要）", async () => {
    const model = new FakeModel(() => createAssistantMessage([text("   ")]));

    expect(
      await generateSummary(model, [createUserMessage("x")]),
    ).toBeNull();
  });
});
