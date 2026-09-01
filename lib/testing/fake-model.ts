// ============================================================
// fake-model.ts —— 测试用假模型（B16：引擎零测试补齐）
// ============================================================
// 从 summarize.test.ts 的私有 FakeModel 提炼成共享基建（消重）：
// 测 runAgentLoop / generateSummary 时，不 mock 网络、不调真实 API，
// 用一个脚本式假模型驱动引擎走完整个循环。
//
// 两种用法（构造签名二选一）：
//   - 响应序列：new FakeModel([msg1, msg2]) —— 第 i 次 complete 返回第 i 条。
//     超出序列时重复最后一条（测 maxTurns 护栏时模型"每次都返回 toolCall"
//     只需两条即可，不必造 maxTurns 条）。
//   - handler 函数：new FakeModel((input) => ...) —— 每次调用动态生成响应，
//     可在函数体内断言 input（比如摘要提示词内容，见 summarize.test.ts）。
//
// 每次 complete 的输入都被记录进 calls：测试可以断言"模型第 N 轮看到了
// 什么"（如 block 后的 isError 工具结果是否真的进了 context）——这是
// pi 用 llmCalls 计数只能间接验证、我们能做到直接验证的超集能力。
// ============================================================

import type { AssistantMessage } from "../types";
import type { CompleteInput, TeachingModel } from "../model";

type Handler = (
  input: CompleteInput,
) => AssistantMessage | Promise<AssistantMessage>;

export class FakeModel implements TeachingModel {
  /** 每次 complete 的输入（含 messages：引擎传进来的上下文快照） */
  readonly calls: CompleteInput[] = [];

  private readonly handlers: Handler[];

  constructor(responses: AssistantMessage[] | Handler) {
    this.handlers = Array.isArray(responses)
      ? responses.map((message) => () => message)
      : [responses];

    if (this.handlers.length === 0) {
      throw new Error("FakeModel 需要至少一个响应");
    }
  }

  async complete(input: CompleteInput): Promise<AssistantMessage> {
    this.calls.push(input);

    // 超出响应序列时重复最后一条（见文件头注释：护栏测试的友好行为）
    const index = Math.min(this.calls.length - 1, this.handlers.length - 1);
    return this.handlers[index](input);
  }
}
