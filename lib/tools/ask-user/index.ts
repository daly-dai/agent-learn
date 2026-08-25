// ============================================================
// ask_user_question —— 模型向用户提问（A4，多问题选项版）
// ============================================================
// 参考：Reasonix AskCard 完整形态——1-4 问、每题 2-4 选项 + Other answer
// 自定义、逐题作答、进度显示、跳题/返回。codex request_user_input、
// smolagents user_input 佐证：结构化多问题提问是成熟 agent 标配。
//
// 核心机制：旁路回调「请求-响应」——execute 里 `await hooks.onAskUser(questions)`，
// 把「问题数组」一次交回使用端（route.ts 推 SSE 帧带全部 questions → 前端
// AskCard 逐题作答 → 一次 POST 回传 answers[] → resolve）。hooks 走「工厂参数 +
// 闭包烙」（贴 pi），工具不碰前端/route，引擎无感。它是「要等答案」的请求-响应。
//
// 回传 answers[]：每题一个字符串——点选的 option.label / 自定义文本 / 跳过（空串）。
// 超时在使用端兜底（60s 无回答返回超时文案）。
// ============================================================

import type { RegisteredTool, ToolHooks } from "../types";
import { text } from "../../message";

/** 单个可选项（模型给 A/B/C 选项让用户点选） */
export type AskOption = {
  label: string;
  description?: string;
};

/** 一道问题（可带选项；不带 options 则让用户自由回答） */
export type AskQuestion = {
  question: string;
  options?: AskOption[];
};

/** 选项数量上限/下限 */
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 6;
/** 问题数上限 */
export const QUESTIONS_MAX = 4;

/** 用户主动跳过（空回答）时的明确文案——引导模型直接继续，不要追问 */
export const SKIPPED_TEXT =
  "用户跳过了这个问题，无需回答。请基于已有信息继续你手头的任务，不要反复问同一问题。";

export function createAskUserTool(hooks: ToolHooks): RegisteredTool {
  return {
    name: "ask_user_question",
    description:
      "向用户提出 1-4 个问题并等待回答，逐题作答。仅当你需要用户提供信息、做决定或澄清需求时才调用。优先给每道题 2-6 个具体选项让用户点选（比自由输入更快更明确），选项用不上时才问开放式问题。问题要具体。",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description:
            "要问的问题列表（1-4 个）。每道题可带 options（2-6 个选项，用户可点选或自定义补充）。",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "问题文字。",
              },
              options: {
                type: "array",
                description: "可选：2-6 个选项让用户点选。",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description: "选项文字（简短）。",
                    },
                    description: {
                      type: "string",
                      description: "选填：选项说明。",
                    },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["question"],
          },
        },
      },
      required: ["questions"],
    },
    async execute(args) {
      const questions = parseQuestions(args.questions);

      // 请求-响应：闭包烙进来的 hooks——把问题数组交回使用端
      // （route.ts 推帧 → 前端逐题作答 → 回传 answers[]）
      const answers = (await hooks.onAskUser?.(questions)) ?? [];

      if (answers.length === 0) {
        // 无任何回答（全部跳过 / 无回调降级）
        return {
          content: [text(SKIPPED_TEXT)],
          details: { questions, skipped: true },
        };
      }

      return {
        content: [text(formatAnswers(questions, answers))],
        details: { questions, answers },
      };
    },
  };
}

/** 把 questions + 每题回答渲染成给模型的清晰清单 */
function formatAnswers(questions: AskQuestion[], answers: string[]): string {
  const lines = questions.map((q, i) => {
    const ans = answers[i]?.trim() || "（跳过）";
    return `${i + 1}. ${q.question} → ${ans}`;
  });

  return `用户回答：\n${lines.join("\n")}`;
}

/** 规整模型传入的 questions：非法则抛错（fail loud），合法返回规整后的数组 */
export function parseQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) {
    throw new Error("ask_user_question: questions 必须是数组");
  }

  if (raw.length === 0) {
    throw new Error("ask_user_question: questions 至少要有 1 个问题");
  }

  if (raw.length > QUESTIONS_MAX) {
    throw new Error(
      `ask_user_question: 最多 ${QUESTIONS_MAX} 个问题（收到 ${raw.length}）`,
    );
  }

  const questions: AskQuestion[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error(
        "ask_user_question: 每个问题必须是对象 { question, options? }",
      );
    }

    const record = item as Record<string, unknown>;
    const question =
      typeof record.question === "string" ? record.question.trim() : "";

    if (!question) {
      throw new Error("ask_user_question: question 不能为空");
    }

    const options = parseOptions(record.options);

    questions.push(options.length > 0 ? { question, options } : { question });
  }

  return questions;
}

/** 规整单个问题的 options：undefined = 无选项，非法则抛错 */
export function parseOptions(raw: unknown): AskOption[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error("ask_user_question: questions[i].options 必须是数组");
  }

  const options: AskOption[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error(
        "ask_user_question: 每个 option 必须是对象 { label, description? }",
      );
    }
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!label) {
      throw new Error("ask_user_question: option 的 label 不能为空");
    }
    if (seen.has(label)) {
      throw new Error(`ask_user_question: 重复的选项：${label}`);
    }
    const description =
      typeof record.description === "string" ? record.description.trim() : "";

    seen.add(label);
    options.push(description ? { label, description } : { label });
  }

  if (
    options.length > 0 &&
    (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX)
  ) {
    throw new Error(
      `ask_user_question: options 数量必须是 ${OPTIONS_MIN}-${OPTIONS_MAX}（收到 ${options.length}）`,
    );
  }

  return options;
}
