// ============================================================
// ask-user.test.ts —— ask_user_question（A4，多问题版）
// ============================================================
// 重点测：parseQuestions/parseOptions 校验（fail loud）、
// execute 的旁路回调拿到 questions 数组、回传 answers 的渲染、
// 跳过（空数组）降级、超时文案（非空）原样呈现。
// ============================================================

import { describe, expect, it } from "vitest";
import {
  createAskUserTool,
  parseQuestions,
  parseOptions,
  SKIPPED_TEXT,
} from "../ask-user";

describe("parseQuestions —— 问题列表校验", () => {
  it("非数组抛错", () => {
    expect(() => parseQuestions("bad")).toThrow(/必须是数组/);
  });

  it("空数组抛错", () => {
    expect(() => parseQuestions([])).toThrow(/至少要有 1 个问题/);
  });

  it("超过 4 个问题抛错", () => {
    expect(() =>
      parseQuestions([
        { question: "1" },
        { question: "2" },
        { question: "3" },
        { question: "4" },
        { question: "5" },
      ]),
    ).toThrow(/最多 4 个/);
  });

  it("question 为空抛错", () => {
    expect(() => parseQuestions([{ question: "  " }])).toThrow(/不能为空/);
  });

  it("合法问题数组规整后返回（带/不带 options）", () => {
    const questions = parseQuestions([
      { question: "颜色？", options: [{ label: "红" }, { label: "蓝" }] },
      { question: "语言？" },
    ]);
    expect(questions).toEqual([
      { question: "颜色？", options: [{ label: "红" }, { label: "蓝" }] },
      { question: "语言？" },
    ]);
  });
});

describe("parseOptions —— 单个问题的选项校验", () => {
  it("undefined 返回空数组（无选项=自由回答）", () => {
    expect(parseOptions(undefined)).toEqual([]);
  });

  it("label 为空抛错", () => {
    expect(() => parseOptions([{ label: "  " }])).toThrow(/label 不能为空/);
  });

  it("重复选项抛错", () => {
    expect(() =>
      parseOptions([{ label: "红" }, { label: "红" }]),
    ).toThrow(/重复的选项/);
  });

  it("选项数小于 2 抛错", () => {
    expect(() => parseOptions([{ label: "红" }])).toThrow(/2-6/);
  });

  it("选项数大于 6 抛错", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ label: String(i) }));
    expect(() => parseOptions(many)).toThrow(/2-6/);
  });
});

describe("ask_user_question.execute —— 请求-响应", () => {
  it("onAskUser 收到 questions 数组，回传 answers 后渲染清单", async () => {
    const tool = createAskUserTool();
    let received: unknown;
    const result = await tool.execute(
      {
        questions: [
          { question: "颜色？", options: [{ label: "红" }, { label: "蓝" }] },
          { question: "语言？" },
        ],
      },
      {
        onAskUser: async (questions) => {
          received = questions;
          return ["红", "TypeScript"];
        },
      },
    );
    // 工具确实把 questions 数组原样交给了使用端
    expect(received).toEqual([
      { question: "颜色？", options: [{ label: "红" }, { label: "蓝" }] },
      { question: "语言？" },
    ]);

    const details = result.details as { answers: string[] };
    expect(details.answers).toEqual(["红", "TypeScript"]);
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toContain("1. 颜色？ → 红");
      expect(result.content[0].text).toContain("2. 语言？ → TypeScript");
    }
  });

  it("全部跳过（空数组）返回引导文案", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute(
      { questions: [{ question: "有人吗？" }] },
      { onAskUser: async () => [] },
    );
    expect(result.details).toMatchObject({ skipped: true });
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toBe(SKIPPED_TEXT);
    }
  });

  it("无 onAskUser 回调时降级为跳过（不挂死）", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({ questions: [{ question: "x" }] }, {});
    expect(result.details).toMatchObject({ skipped: true });
  });

  it("python：非空回答（如模型给的自定义文本）原样呈现", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute(
      { questions: [{ question: "自定义答案？" }] },
      { onAskUser: async () => ["我选自定义：绿色"] },
    );
    const details = result.details as { answers: string[] };
    expect(details.answers).toEqual(["我选自定义：绿色"]);
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toContain("我选自定义：绿色");
    }
  });
});
