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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlSessionStore, summarizeEntries } from ".";
import { createAssistantMessage, createUserMessage, messageText, text } from "../../message";
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
// 会话树语义（B18 ② 补齐：switchLeaf / appendTodo / getLatestTodos / stats）
// 这些是 Phase 2 分支切换 + Phase 5 task 面板的地基行为，此前零测试。
// ============================================================
describe("会话树语义 —— 分支 / todo / 统计", () => {
  it("appendTodo + getLatestTodos：从叶子回溯到最新一条 todo", async () => {
    const { store, cleanup } = makeStore();

    // 还没有 todo → undefined
    expect(store.getLatestTodos()).toBeUndefined();

    await store.appendMessage(createUserMessage("一"));
    await store.appendTodo([{ content: "任务A", status: "pending" }]);
    expect(store.getLatestTodos()).toEqual([
      { content: "任务A", status: "pending" },
    ]);

    // todo 之后再追加消息：getLatestTodos 仍能沿叶子回溯找到（todo 是会话事件）
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

  it("switchLeaf 切分支后 appendMessage 长在新分支，buildContext 只含新分支", async () => {
    const { store, cleanup } = makeStore();

    const branchPoint = await store.appendMessage(createUserMessage("主线一"));
    await store.appendMessage(createUserMessage("主线二"));

    // 切回主线一，岔出支线
    store.switchLeaf(branchPoint);
    await store.appendMessage(createUserMessage("支线一"));

    const context = store.buildContext();
    const texts = context.map((m) => messageText(m));
    expect(texts).toContain("主线一");
    expect(texts).toContain("支线一");
    // 旧分支的"主线二"不在新分支路径上（树的分支语义）
    expect(texts).not.toContain("主线二");

    cleanup();
  });

  it("switchLeaf 改变叶子后，getLatestTodos 沿新路径回溯（可见性随分支）", async () => {
    const { store, cleanup } = makeStore();

    await store.appendMessage(createUserMessage("一")); // entry_1
    await store.appendTodo([{ content: "任务A", status: "pending" }]); // entry_2
    const leafAfterTodo = store.getLeafId()!; // 记住 todo 之后的分支点
    await store.appendMessage(createUserMessage("主线一")); // entry_3

    // 当前叶子在 todo 之后 → 回溯路径含 todo → 可见
    expect(store.getLatestTodos()).toEqual([
      { content: "任务A", status: "pending" },
    ]);

    // 切到 todo 之前的 message（entry_1）→ 新路径不含 todo → undefined
    const firstMessageId = store
      .getEntries()
      .find((e) => e.type === "message")!.id;
    store.switchLeaf(firstMessageId);
    expect(store.getLatestTodos()).toBeUndefined();

    // 切回 todo 之后的分支 → todo 恢复可见（叶子决定回溯路径）
    store.switchLeaf(leafAfterTodo);
    expect(store.getLatestTodos()).toEqual([
      { content: "任务A", status: "pending" },
    ]);

    cleanup();
  });

  it("switchLeaf 未知 id 抛错（fail-closed：不静默切到不存在的位置）", () => {
    const { store, cleanup } = makeStore();

    expect(() => store.switchLeaf("no-such-entry")).toThrow(/Unknown session entry/);

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
    // todo 条目不干扰统计（本来就不计，但钉死：即使叶子是 todo 也一样）

    cleanup();
  });
});

// ============================================================
// 版本校验（C18 A 档 ①）：读到不认识的格式必须 fail-closed
// ============================================================
// 夹具的真实场景（AGENTS 11.5 ②）：**git 切回旧 commit 跑新格式文件**。
// 本项目天天在切 checkout——新版写出的 v2 文件，旧代码一定会读到。
// 那时只有两种正确反应：按 v2 的规则读，或者**明确拒绝**。
// 绝不能落进「文件存在但没有合法头 → 当坏文件重写」那条防御分支：
// 那等于把用户的会话**静默清空**，而且报警信息指向的是"坏文件"，不是真因。
describe("版本校验 —— 读到不认识的格式必须 fail-closed", () => {
  /** 造一个"未来版本写出的会话文件"（当前代码只认 v1） */
  function writeFutureSession(
    dir: string,
    version: number,
  ): { filePath: string; raw: string } {
    const filePath = join(dir, "future.jsonl");
    const raw =
      [
        JSON.stringify({
          type: "session",
          version,
          id: "s_future",
          timestamp: new Date().toISOString(),
          cwd: dir,
        }),
        JSON.stringify({
          type: "message",
          id: "entry_1",
          parentId: null,
          timestamp: new Date().toISOString(),
          message: createUserMessage("未来的消息"),
        }),
      ].join("\n") + "\n";
    writeFileSync(filePath, raw, "utf8");
    return { filePath, raw };
  }

  it("version 不认识 → 构造抛错，且错误里点名是哪个版本", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-version-test-"));
    try {
      const { filePath } = writeFutureSession(dir, 2);

      expect(() => new JsonlSessionStore(filePath, dir, "s_future")).toThrow(
        /version=2/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("⭐ 拒绝时原文件一字未改（不重写、不清空——降级场景的底线）", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-version-test-"));
    try {
      const { filePath, raw } = writeFutureSession(dir, 2);

      expect(() => new JsonlSessionStore(filePath, dir, "s_future")).toThrow();

      // 断言的正是"最坏情况不是数据丢失"：校验失败 = 只读不写
      expect(readFileSync(filePath, "utf8")).toBe(raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("version 1 照常加载（回归：校验不能拦住自己写出的格式）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "session-version-test-"));
    try {
      const filePath = join(dir, "v1.jsonl");
      const written = new JsonlSessionStore(filePath, dir, "s_v1");
      await written.appendMessage(createUserMessage("v1 的消息"));

      // 重新打开（走 loadOrCreate 的读入路径 = 校验真正生效的地方）
      const reopened = new JsonlSessionStore(filePath, dir, "s_v1");

      expect(reopened.buildContext().map((m) => messageText(m))).toEqual([
        "v1 的消息",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
