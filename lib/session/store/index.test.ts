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
import { JsonlSessionStore, summarizeEntries } from ".";
import { createAssistantMessage, createUserMessage, text } from "../../message";
import type { AgentMessage, SessionEntry } from "../../types";

/** B18：find 类型守卫用（保留区第一条必须是 message 条目） */
type MessageEntry = Extract<SessionEntry, { type: "message" }>;

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

describe("prepareCompaction —— 压缩切点（B18：describe 改名，方法已从 compactIfNeeded 演进为两步）", () => {
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
    // B18：expect 失败即测试失败，这里用非空断言收窄类型——原 `if (!entry) return`
    // 会让后续类型检查意外时静默通过，fail-loud 更诚实
    const prep = entry!;

    // 修复后：firstKeptEntryId 不应指向 toolResult（t2 的结果），
    // 而应指向它配对的 assistant（t2 的调用）或更早。
    // B18：find 直接过滤 type === "message"，让类型不匹配时断言失败而不是静默通过
    const keptEntry = store
      .getEntries()
      .find(
        (e): e is MessageEntry =>
          e.id === prep.firstKeptEntryId && e.type === "message",
      );
    expect(keptEntry).toBeDefined();
    const kept = keptEntry!;

    expect(kept.message.role).not.toBe("toolResult");

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
    const prep = entry!;

    // keepRecentMessages=2 时尾部 2 条 = [user"二", user"三"]，第一条是 user（安全），
    // 修复不应改变这个切点——firstKeptEntryId 应指向 user"二"（第 4 条）
    const keptEntry = store
      .getEntries()
      .find(
        (e): e is MessageEntry =>
          e.id === prep.firstKeptEntryId && e.type === "message",
      );
    expect(keptEntry).toBeDefined();
    expect(keptEntry!.message.role).toBe("user");

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
    const prep = entry!;

    // keepRecentMessages=2 时尾部 2 条 = [toolResult(t1), user"二"]，
    // 修复前 firstKeptEntryId 指向 toolResult（坏）；修复后往前挪一条 → assistant(t1)
    const keptEntry = store
      .getEntries()
      .find(
        (e): e is MessageEntry =>
          e.id === prep.firstKeptEntryId && e.type === "message",
      );
    expect(keptEntry).toBeDefined();
    expect(keptEntry!.message.role).toBe("assistant");

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
    // B18：expect 已断言 role，这里用类型守卫收窄（原 if return 在断言失败时
    // 会静默通过——role 检查本应让测试红，改为显式抛错 fail-loud）
    if (first.role !== "compactionSummary") {
      throw new Error("上下文第一条应为 compactionSummary");
    }

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
    const first = firstPrep!;
    // 第一次压缩：没有旧摘要
    expect(first.previousSummary).toBeUndefined();
    await store.commitCompaction(first, "## Goal\n第一轮目标");

    // 第二轮：新消息进来，再次触发压缩
    await store.appendMessage(createUserMessage("四"));
    await store.appendMessage(createUserMessage("五"));
    await store.appendMessage(createUserMessage("六"));

    const secondPrep = store.prepareCompaction(1, 2);
    expect(secondPrep).toBeDefined();
    const second = secondPrep!;

    // 关键：第二次压缩必须带上第一次的摘要（否则旧信息永久丢失）
    expect(second.previousSummary).toBe("## Goal\n第一轮目标");
    // 待压区不应包含第一次压缩点之前被压过的原文（它们由 previousSummary 代表）
    const texts = second.messagesToSummarize.map((m) =>
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
    const p = prep!;

    // 待压区域有内容 → token 数 > 0（route.ts 拿它跟 config.agent.minCompactTokens 比）
    expect(p.tokensToSummarize).toBeGreaterThan(0);
    expect(p.tokensToSummarize).toBeLessThanOrEqual(p.tokensBefore);

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

// ============================================================
// 会话日志语义（原名"会话树语义"，B18 ② 补齐；C18 砍树后改名）
// 这是 Phase 5 task 面板 + 统计读数盘的地基行为。
// ⚠️ 原 3 个 switchLeaf 用例已随树一起删掉——它们测的是一个
//    **生产代码零调用**的能力，删掉是决策的一部分（C18 详案 §7.5）。
// ============================================================
describe("会话日志语义 —— todo / 统计", () => {
  it("appendTodo + getLatestTodos：取最后一条 todo", async () => {
    const { store, cleanup } = makeStore();

    // 还没有 todo → undefined
    expect(store.getLatestTodos()).toBeUndefined();

    await store.appendMessage(createUserMessage("一"));
    await store.appendTodo([{ content: "任务A", status: "pending" }]);
    expect(store.getLatestTodos()).toEqual([
      { content: "任务A", status: "pending" },
    ]);

    // todo 之后再追加消息：getLatestTodos 仍能取到最后一条 todo（todo 是会话事件）
    await store.appendMessage(createUserMessage("二"));
    expect(store.getLatestTodos()).toEqual([
      { content: "任务A", status: "pending" },
    ]);

    cleanup();
  });

  it("todo 整表替换语义：新 todo 条目覆盖旧条目（Phase 5 只读展示最新）", async () => {
    const { store, cleanup } = makeStore();

    await store.appendTodo([{ content: "旧清单", status: "pending" }]);
    await store.appendTodo([
      { content: "新任务1", status: "in_progress" },
      { content: "新任务2", status: "pending" },
    ]);

    expect(store.getLatestTodos()).toEqual([
      { content: "新任务1", status: "in_progress" },
      { content: "新任务2", status: "pending" },
    ]);

    cleanup();
  });

  it("stats：turns/tools/tokens 正确，todo/compaction 条目不计入", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一"));
    await store.appendMessage({
      role: "assistant",
      content: [text("第一轮回答")],
      stopReason: "stop",
      usage: { input: 10, output: 20, totalTokens: 30 },
      timestamp: Date.now(),
    });
    await store.appendMessage({
      role: "toolResult",
      toolCallId: "t1",
      toolName: "echo",
      content: [text("结果")],
      details: {},
      isError: false,
      timestamp: Date.now(),
    });
    await store.appendTodo([{ content: "任务", status: "pending" }]);

    const stats = store.stats();
    expect(stats.turns).toBe(1); // assistant 消息数
    expect(stats.tools).toBe(1); // toolResult 消息数
    expect(stats.tokens).toBe(30); // assistant usage.totalTokens 之和
    // todo 条目不干扰统计（本来就不计，但钉死：即使最后一条是 todo 也一样）

    cleanup();
  });
});

// ============================================================
// 线性日志（C18 砍树，2026-09-14）
// ============================================================
// ⚠️ **这块只有一条用例，而且不该多**：砍树对真实数据是**可证明的 no-op**
//    （实测 39/39 个会话文件都是干净的线性链，树遍历与顺序读逐条相同），
//    硬造"树读法会读错"的夹具就是在造不存在的状态（AGENTS 11.5 ②）。
//    **删掉的能力由 `tsc` 兜底**——`switchLeaf` / `getLeafId` / `parentId`
//    再也调不出来，编译期就拦住了，这比任何运行时用例都硬。
//    也**不写"读老格式文件"的兼容用例**：2026-09-14 数据已清空、探索期不做兼容；
//    而"忽略不认识的字段"本来就是 JSON 解析的默认行为（真去读 parentId 反而编译不过）。
describe("线性日志 —— 新写的条目不再带 parentId", () => {
  it("⭐ 新写的条目不再带 parentId（格式契约：砍干净，不留半拉子字段）", async () => {
    const { store, cleanup } = makeStore();
    try {
      await store.appendMessage(createUserMessage("新话"));

      const messageEntry = store.getEntries().find((e) => e.type === "message")!;

      // 留着一个没人读的 parentId，就是又一次犯「写了没人读的字段」那个病
      // （同族：header.version / TraceSnapshot / message_update.message / 出网的 leafId）
      expect("parentId" in messageEntry).toBe(false);
    } finally {
      cleanup();
    }
  });
});
