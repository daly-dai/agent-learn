// ============================================================
// todo.test.ts —— todo_write 的校验与统计（Phase 5 配套）
// ============================================================
// validateTodos 是模块级纯函数（设计时就为单测留的接口），
// countTodos 未导出，所以通过 createTodoTool().execute 的结果断言 counts。
// 边界用例 = PLAN.md A2 验收标准：空 content / 重复 / 双 in_progress 抛错。
// ============================================================

import { describe, expect, it } from "vitest";
import { createTodoTool, validateTodos } from "../todo";

describe("validateTodos —— 整表校验", () => {
  it("非数组抛错", () => {
    expect(() => validateTodos("not-array")).toThrow(/必须是数组/);
    expect(() => validateTodos(42)).toThrow(/必须是数组/);
  });

  it("空数组合法（清空清单）", () => {
    expect(validateTodos([])).toEqual([]);
  });

  it("合法列表返回规整后的数组", () => {
    const todos = validateTodos([
      { content: "  写测试  ", status: "in_progress" },
      { content: "跑测试", status: "pending" },
      { content: "提交", status: "completed" },
    ]);
    expect(todos).toEqual([
      { content: "写测试", status: "in_progress" },
      { content: "跑测试", status: "pending" },
      { content: "提交", status: "completed" },
    ]);
  });

  it("content 为空（或纯空白）抛错", () => {
    expect(() => validateTodos([{ content: "", status: "pending" }])).toThrow(
      /content 不能为空/,
    );
    expect(() => validateTodos([{ content: "   ", status: "pending" }])).toThrow(
      /content 不能为空/,
    );
  });

  it("重复 content 抛错", () => {
    expect(() =>
      validateTodos([
        { content: "重复", status: "pending" },
        { content: "重复", status: "pending" },
      ]),
    ).toThrow(/重复的 todo/);
  });

  it("非法 status 抛错", () => {
    expect(() =>
      validateTodos([{ content: "x", status: "doing" }]),
    ).toThrow(/status 必须是/);
    expect(() =>
      validateTodos([{ content: "x", status: undefined }]),
    ).toThrow(/status 必须是/);
  });

  it("两个 in_progress 抛错（教学版固定单 active）", () => {
    expect(() =>
      validateTodos([
        { content: "a", status: "in_progress" },
        { content: "b", status: "in_progress" },
      ]),
    ).toThrow(/只能有一个进行中/);
  });

  it("非对象条目抛错", () => {
    expect(() => validateTodos(["plain-string"])).toThrow(/必须是对象/);
  });
});

describe("todo_write.execute —— 统计反馈（counts）", () => {
  it("返回三类计数与完整清单", async () => {
    const tool = createTodoTool();
    const result = await tool.execute(
      {
        todos: [
          { content: "a", status: "pending" },
          { content: "b", status: "in_progress" },
          { content: "c", status: "completed" },
        ],
      },
      {}, // options 可为空：onTodoWrite 是可选的旁路回调
    );
    expect(result.details).toMatchObject({
      counts: { pending: 1, inProgress: 1, completed: 1 },
    });
    const details = result.details as { todos: unknown[] };
    expect(details.todos).toHaveLength(3);
  });

  it("校验失败时 execute 抛错（fail loud）", async () => {
    const tool = createTodoTool();
    await expect(tool.execute({ todos: "bad" }, {})).rejects.toThrow(
      /必须是数组/,
    );
  });
});
