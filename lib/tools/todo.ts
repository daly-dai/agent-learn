// ============================================================
// todo_write —— 更新任务清单（Phase 5 task 面板）
// ============================================================
// 整表替换语义（抄 DSH todo 走读 07）：模型每次把「认为现在的全部任务」
// 写出来，替代上一次的列表——幂等，错了下次全量纠正，不做增量编辑。
//
// 为什么是整表替换：增量编辑（add/update/delete）需要模型维护"当前列表
// 的 diff"，容易漂移；整表替换时模型只需写出"现在该有什么"。
//
// 低危工具：只改会话内的 todo 列表，不碰文件，所以不进 TOOLS_NEEDING_CONFIRM。
// 写会话走旁路回调（onTodoWrite）：工具不碰 store，把列表交回使用端落盘——
// 和 bash 的 onChunk 同一个模式，引擎只透传。
// ============================================================

import type { RegisteredTool } from "./types";
import type { TodoItem } from "../types";
import { text } from "../message";

export type TodoCounts = {
  pending: number;
  inProgress: number;
  completed: number;
};

export function createTodoTool(): RegisteredTool {
  return {
    name: "todo_write",
    description:
      "记录并更新当前工作的任务清单。每次调用发送整个列表，它会替换之前的列表（没有部分更新、没有单条编辑）。复杂任务开始前先列出任务，任务状态变化时更新整表。状态：pending（未开始）/ in_progress（进行中）/ completed（已完成）；同时最多一个进行中。",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "完整的任务列表，替换之前的列表。",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "任务内容——一句祈使句。",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "任务状态。",
              },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    async execute(args, options) {
      const todos = validateTodos(args.todos);

      // 旁路回调：整表交回使用端（route.ts 落盘会话 + 推 SSE 帧）。
      // await 保证工具结果返回时 todo 已入库（落盘顺序确定）。
      await options?.onTodoWrite?.(todos);

      const counts = countTodos(todos);
      return {
        content: [
          text(
            `已更新任务清单：${counts.pending} 待办，${counts.inProgress} 进行中，${counts.completed} 已完成。`,
          ),
        ],
        details: { todos, counts },
      };
    },
  };
}

// ------------------------------------------------------------
// 校验与统计（模块级纯函数，无状态，便于理解与将来补单测）
// ------------------------------------------------------------

/** 把模型传入的参数规整成合法 TodoItem[]：trim 非空、去重、最多一个进行中。
 *  非法输入直接抛错（fail loud）——错误会变成 isError 工具结果回给模型，
 *  模型看到"哪里错了"后自行修正。 */
export function validateTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("todo_write 参数 todos 必须是数组");
  }

  const todos: TodoItem[] = [];
  const seen = new Set<string>();
  let active = 0;

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("todo 必须是对象 { content, status }");
    }

    const record = item as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content.trim() : "";

    if (!content) {
      throw new Error("todo 的 content 不能为空");
    }
    if (seen.has(content)) {
      throw new Error(`重复的 todo：${content}`);
    }

    const status = record.status;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") {
      throw new Error(`todo 的 status 必须是 pending/in_progress/completed（收到 ${String(status)}）`);
    }

    seen.add(content);
    if (status === "in_progress") active += 1;
    todos.push({ content, status });
  }

  if (active > 1) {
    throw new Error(`同时只能有一个进行中的任务（当前 ${active} 个）`);
  }

  return todos;
}

function countTodos(todos: TodoItem[]): TodoCounts {
  const counts: TodoCounts = { pending: 0, inProgress: 0, completed: 0 };
  for (const todo of todos) {
    if (todo.status === "pending") counts.pending += 1;
    else if (todo.status === "in_progress") counts.inProgress += 1;
    else counts.completed += 1;
  }
  return counts;
}
