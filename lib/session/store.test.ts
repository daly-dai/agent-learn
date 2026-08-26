// ============================================================
// sessionStore.test.ts —— JsonlSessionStore 的压缩切点（回归测试）
// ============================================================
// 背景（2026-08-25 修）：compactIfNeeded 原来按"从尾部取 keepRecentMessages 条"
// 直接切片，若切点恰好落在 toolResult 上，它配对的 assistant toolCall 会被压进
// 摘要——重建上下文时出现"孤儿 tool"（role:"tool" 前面没有带 tool_calls 的
// assistant），真实模型 API（DeepSeek）会 400。
// 修法：切点落在 toolResult 上时往前多保留一条（while 循环），保证保留区第一条
// 不是 toolResult。本测试钉死这个行为。
// ============================================================

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlSessionStore, summarizeEntries } from "./store";
import { createAssistantMessage, createUserMessage, text } from "../message";
import type { AgentMessage } from "../types";

/** 触发准备 + 落盘（B2 ③：prepareCompaction + commitCompaction 两步） */
async function compact(store: JsonlSessionStore, maxTokens: number, keepRecent: number) {
  const prep = store.prepareCompaction(maxTokens, keepRecent);
  if (!prep) return undefined;
  return store.commitCompaction(prep, summarizeEntries(prep.messagesToSummarize));
}

function makeStore(): { store: JsonlSessionStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "session-store-test-"));
  const store = new JsonlSessionStore(
    join(dir, "test.jsonl"),
    dir,
    "test-session",
  );
  return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 造一条带 toolCall 的 assistant 消息 */
function assistantWithToolCall(id: string): AgentMessage {
  return createAssistantMessage(
    [
      {
        type: "toolCall",
        id,
        name: "list_files",
        arguments: { path: "." },
      },
    ],
    "toolUse",
  );
}

/** 造一条 toolResult 消息（配对上面 id） */
function toolResultMessage(id: string, output: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "list_files",
    content: [text(output)],
    details: {},
    isError: false,
    timestamp: Date.now(),
  };
}

describe("compactIfNeeded —— 压缩切点", () => {
  it("切点落在 toolResult 上时，firstKeptEntryId 往前挪到配对的 assistant", async () => {
    const { store, cleanup } = makeStore();

    // 构造一个"切点正好卡在 toolResult 上"的序列：
    // 大量旧 user 消息撑满窗口 → 最后一条 user 后接 assistant(toolCall)+toolResult。
    // keepRecentMessages=2 时，"尾部 2 条"恰好是 assistant+toolResult 的配对，
    // 若直接 slice(-2) 保留区第一条是 assistant（没问题）；要让切点落在 toolResult 上，
    // 需要"尾部 2 条"第一条是 toolResult——即序列末尾是 assistant,toolResult,user...
    // 更直接：塞满旧消息使保留区只有 1 条可留时，切点必然前移。
    //
    // 构造：
    //   [user, assistant(toolCall t1), toolResult(t1), user, ...]
    // 大量 user 填充后，keepRecentMessages=3 时尾部 3 条 = [user, assistant, toolResult]，
    // 切点（第一条）是 user，安全；改用 keepRecentMessages=2 → 尾部 2 条 = [assistant, toolResult]，
    // 第一条 assistant，也安全。真正危险的形态是尾部 2 条 = [toolResult, ...]，即
    // toolResult 成为保留区第一条。我们用超长 user 文本把 token 撑过阈值，
    // 且让 keepRecentMessages 极小（1），此时尾部 1 条若恰是 toolResult，修复前会直接
    // 把 toolResult 当 firstKeptEntryId。
    await store.appendMessage(createUserMessage("第一条"));
    await store.appendMessage(assistantWithToolCall("t1"));
    await store.appendMessage(toolResultMessage("t1", "结果一"));

    // 再追加一条 user + 一条超长 user，让 keepRecentMessages=1 时尾部 1 条是 user（安全）；
    // 然后追加 assistant+toolResult 使尾部 1 条是 toolResult → 修复必须前移。
    await store.appendMessage(createUserMessage("第二条"));
    await store.appendMessage(assistantWithToolCall("t2"));
    await store.appendMessage(toolResultMessage("t2", "结果二"));

    // 触发压缩：maxApproxTokens 设极小，keepRecentMessages=1（最极端切点）
    const entry = await compact(store, 1, 1);
    expect(entry).toBeDefined();
    if (!entry) return;

    // 修复后：firstKeptEntryId 不应指向 toolResult（t2 的结果），
    // 而应指向它配对的 assistant（t2 的调用）或更早。
    const keptEntry = store
      .getEntries()
      .find((e) => e.id === entry.firstKeptEntryId);
    expect(keptEntry).toBeDefined();
    if (!keptEntry || keptEntry.type !== "message") return;

    expect(keptEntry.message.role).not.toBe("toolResult");

    // 重建上下文：保留区第一条不可能是"孤儿 toolResult"——它前面必须有 assistant
    const context = store.buildContext();
    const firstKeptIndex = context.findIndex(
      (m) =>
        m.role === "toolResult" &&
        (m as { toolCallId?: string }).toolCallId === "t2",
    );
    // 若 t2 的 toolResult 在上下文里，它前一条必须是 assistant
    if (firstKeptIndex > 0) {
      expect(context[firstKeptIndex - 1].role).toBe("assistant");
    }

    cleanup();
  });

  it("正常切点（尾部第一条就是 user）不变", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage(assistantWithToolCall("t1"));
    await store.appendMessage(toolResultMessage("t1", "结果一"));
    await store.appendMessage(createUserMessage("二"));
    await store.appendMessage(createUserMessage("三"));

    const entry = await compact(store, 1, 2);
    expect(entry).toBeDefined();
    if (!entry) return;

    // keepRecentMessages=2 时尾部 2 条 = [user"二", user"三"]，第一条是 user（安全），
    // 修复不应改变这个切点——firstKeptEntryId 应指向 user"二"（第 4 条）
    const keptEntry = store
      .getEntries()
      .find((e) => e.id === entry.firstKeptEntryId);
    expect(keptEntry).toBeDefined();
    if (!keptEntry || keptEntry.type !== "message") return;
    expect(keptEntry.message.role).toBe("user");

    cleanup();
  });

  it("切点落在 [toolResult, user] 时前移一条到 assistant（配对保留）", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage(assistantWithToolCall("t1"));
    await store.appendMessage(toolResultMessage("t1", "结果一"));
    await store.appendMessage(createUserMessage("二"));

    const entry = await compact(store, 1, 2);
    expect(entry).toBeDefined();
    if (!entry) return;

    // keepRecentMessages=2 时尾部 2 条 = [toolResult(t1), user"二"]，
    // 修复前 firstKeptEntryId 指向 toolResult（坏）；修复后往前挪一条 → assistant(t1)
    const keptEntry = store
      .getEntries()
      .find((e) => e.id === entry.firstKeptEntryId);
    expect(keptEntry).toBeDefined();
    if (!keptEntry || keptEntry.type !== "message") return;
    expect(keptEntry.message.role).toBe("assistant");

    cleanup();
  });
});

describe("buildContext —— 压缩摘要消息类型（B2，2026-08-25）", () => {
  it("压缩后产出 compactionSummary 而不是伪装 user（前端能认出是压缩卡片）", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage(assistantWithToolCall("t1"));
    await store.appendMessage(toolResultMessage("t1", "结果一"));
    await store.appendMessage(createUserMessage("二"));
    await store.appendMessage(createUserMessage("三"));

    await compact(store, 1, 2); // 触发压缩
    const context = store.buildContext();

    // 摘要消息必须是 compactionSummary 类型，不是 user
    const first = context[0];
    expect(first.role).toBe("compactionSummary");
    if (first.role !== "compactionSummary") return;

    // 摘要内容正确（含被压缩的旧消息）
    expect(first.summary).toContain("user");
    expect(first.summary).toContain("assistant");

    cleanup();
  });
});

describe("prepareCompaction —— B2 ③ LLM 摘要准备（2026-08-25）", () => {
  it("第二次压缩时 previousSummary 携带上一次的摘要（信息链不断，pi 增量更新）", async () => {
    const { store, cleanup } = makeStore();

    // 第一轮：塞满消息并压缩
    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage(assistantWithToolCall("t1"));
    await store.appendMessage(toolResultMessage("t1", "结果一"));
    await store.appendMessage(createUserMessage("二"));
    await store.appendMessage(createUserMessage("三"));

    const firstPrep = store.prepareCompaction(1, 2);
    expect(firstPrep).toBeDefined();
    if (!firstPrep) return;
    // 第一次压缩：没有旧摘要
    expect(firstPrep.previousSummary).toBeUndefined();
    await store.commitCompaction(firstPrep, "## Goal\n第一轮目标");

    // 第二轮：新消息进来，再次触发压缩
    await store.appendMessage(createUserMessage("四"));
    await store.appendMessage(createUserMessage("五"));
    await store.appendMessage(createUserMessage("六"));

    const secondPrep = store.prepareCompaction(1, 2);
    expect(secondPrep).toBeDefined();
    if (!secondPrep) return;

    // 关键：第二次压缩必须带上第一次的摘要（否则旧信息永久丢失）
    expect(secondPrep.previousSummary).toBe("## Goal\n第一轮目标");
    // 待压区不应包含第一次压缩点之前被压过的原文（它们由 previousSummary 代表）
    const texts = secondPrep.messagesToSummarize.map((m) =>
      m.role === "user" ? m.content.map((c) => c.text).join("") : "",
    );
    expect(texts.some((t) => t.includes("一"))).toBe(false);

    cleanup();
  });

  it("tokensToSummarize 字段提供经济性检查的输入（Reasonix D6）", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage(assistantWithToolCall("t1"));
    await store.appendMessage(toolResultMessage("t1", "结果一"));
    await store.appendMessage(createUserMessage("二"));
    await store.appendMessage(createUserMessage("三"));

    const prep = store.prepareCompaction(1, 2);
    expect(prep).toBeDefined();
    if (!prep) return;

    // 待压区域有内容 → token 数 > 0（route.ts 拿它跟 config.agent.minCompactTokens 比）
    expect(prep.tokensToSummarize).toBeGreaterThan(0);
    expect(prep.tokensToSummarize).toBeLessThanOrEqual(prep.tokensBefore);

    cleanup();
  });

  it("没超限时 prepareCompaction 返回 undefined（不触发压缩）", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage(createUserMessage("二"));

    // 消息太少（<= keepRecentMessages）不压
    expect(store.prepareCompaction(1, 5)).toBeUndefined();
    // token 没超阈值不压
    expect(store.prepareCompaction(10_000, 1)).toBeUndefined();

    cleanup();
  });
});
