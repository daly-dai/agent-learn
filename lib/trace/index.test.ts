// ============================================================
// lib/trace —— 单个轨迹文件的格式与读写（A3）
// ============================================================
// 测 seam：TraceRecorder 落盘（`<会话目录>/trace.<runId>.jsonl`）、
// readTrace（取中间 entries）、readTraceMeta（只读首末两行）。
// ⚠️ 2026-11-11：文件名不再承载会话 id（归属由目录表达），所以原先测
// `traceFileName` / `parseTraceFileName` 的那组用例随函数一起删了。
//
// 一个"只能这么测"的点：readTraceMeta 的核心要求是**不解析中间行**，
// 这点从外部只能这样证明——在中间塞一条坏 JSON，若实现是 readFile + 全量
// parse，它会抛；只读首末则照常返回。测试里那条注释写的就是这个道理。
// ============================================================

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceRecorder, readTrace, readTraceMeta } from "./index";

/** 轨迹文件名：与 `lib/session/paths` 的 tracePath 同一个约定 */
function traceName(runId: string): string {
  return `trace.${runId}.jsonl`;
}

// ---- 临时目录（对齐 lib/session/store.test.ts 的做法） ----

const cleanups: Array<() => void> = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "trace-test-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

// ---- 造行 ----

const startLine = (runId = "run_x", sessionId = "s_test"): string =>
  JSON.stringify({
    type: "trace_start",
    runId,
    model: "deepseek-chat",
    sessionId,
    ts: 1_000,
  });

// ⚠️ 不给 summary 设默认值：助手一旦"顺手塞" messages: 3，
// "只有 error、没有 messages" 这个组合就**无法表达**了，而且断言失败时
// 报错（expected 3 to be undefined）完全不指向真因。助手不该发明数据。
const endLine = (
  runId = "run_x",
  summary: Record<string, unknown> = {},
): string =>
  JSON.stringify({ type: "trace_end", runId, ts: 2_000, seq: 5, ...summary });

const entryLine = (seq: number): string =>
  JSON.stringify({
    seq,
    runId: "run_x",
    ts: 1_500,
    turn: 1,
    event: { type: "turn_start", turn: 1 },
  });

async function writeTraceFile(
  dir: string,
  name: string,
  lines: string[],
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

// ============================================================

describe("TraceRecorder 落盘", () => {
  it("落到 <会话目录>/trace.<runId>.jsonl，首行是带 sessionId 的 trace_start、末行是 trace_end", async () => {
    const dir = makeDir();
    const recorder = TraceRecorder.create(dir, "deepseek-chat", "s_demo");
    await recorder.init();
    recorder.record({ type: "turn_start", turn: 1 });
    await recorder.end({ messages: 1 });

    const files = await readdir(dir);
    expect(files).toEqual([traceName(recorder.runId)]);

    const entries = await readTrace(join(dir, files[0]));
    expect(entries.map((entry) => entry.seq)).toEqual([1]);

    const meta = await readTraceMeta(join(dir, files[0]));
    expect(meta).toMatchObject({
      runId: recorder.runId,
      model: "deepseek-chat",
      sessionId: "s_demo",
      completed: true,
      summary: { messages: 1 },
    });
  });

  it("内存里的 entries 与内存序一致（seq 从 1 起）", async () => {
    const dir = makeDir();
    const recorder = TraceRecorder.create(dir, "m", "s_demo");
    await recorder.init();
    recorder.record({ type: "turn_start", turn: 1 });
    recorder.record({ type: "turn_start", turn: 2 });
    await recorder.end();

    expect(recorder.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(recorder.entries.map((entry) => entry.event.type)).toEqual([
      "turn_start",
      "turn_start",
    ]);
  });
});

describe("readTrace：取中间 entries", () => {
  it("跳过首末两行元信息，只返回 TraceEntry", async () => {
    const dir = makeDir();
    const path = await writeTraceFile(dir, traceName("run_x"), [
      startLine(),
      entryLine(1),
      entryLine(2),
      endLine(),
    ]);

    const entries = await readTrace(path);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(entries.every((entry) => "event" in entry)).toBe(true);
  });
});

describe("readTraceMeta：只读首末两行", () => {
  it("正常收尾 → completed + 摘要 + 字节数", async () => {
    const dir = makeDir();
    const path = await writeTraceFile(dir, traceName("run_x"), [
      startLine(),
      entryLine(1),
      endLine("run_x", { messages: 7 }),
    ]);

    const meta = await readTraceMeta(path);
    expect(meta).toMatchObject({
      runId: "run_x",
      sessionId: "s_test",
      startedAt: 1_000,
      completed: true,
      summary: { messages: 7 },
    });
    expect(meta?.bytes).toBeGreaterThan(0);
  });

  it("没有 trace_end（服务崩了）→ completed false，但头部信息仍可用（残轨迹也要列得出来）", async () => {
    const dir = makeDir();
    const path = await writeTraceFile(dir, traceName("run_x"), [
      startLine(),
      entryLine(1),
      entryLine(2), // 写到一半就断了
    ]);

    const meta = await readTraceMeta(path);
    expect(meta).toMatchObject({
      runId: "run_x",
      sessionId: "s_test",
      completed: false,
    });
    expect(meta?.summary).toBeUndefined();
  });

  it("末行是写了一半的 trace_end → 同样判为未完成（截断的 JSON 不算收尾）", async () => {
    const dir = makeDir();
    const path = await writeTraceFile(dir, traceName("run_x"), [
      startLine(),
      entryLine(1),
      '{"type":"trace_end","runId":"run_x","ts":2000,"seq":',
    ]);

    expect((await readTraceMeta(path))?.completed).toBe(false);
  });

  it("⭐ 不解析中间行：中间塞坏 JSON 与假 trace_end 都不影响结果", async () => {
    const dir = makeDir();
    const path = await writeTraceFile(dir, traceName("run_x"), [
      startLine(),
      "{ 这一行不是合法 JSON —— 全量 parse 的实现会在这里抛",
      JSON.stringify({
        type: "trace_end",
        runId: "假的",
        ts: 9,
        seq: 99,
        messages: 999,
      }),
      endLine("run_x", { messages: 3 }),
    ]);

    const meta = await readTraceMeta(path);
    // 取的是最后一行，不是中间那条假的
    expect(meta).toMatchObject({
      runId: "run_x",
      completed: true,
      summary: { messages: 3 },
    });
  });

  it("坏文件返回 undefined（不挂掉整个列表）", async () => {
    const dir = makeDir();
    const empty = await writeTraceFile(dir, "s_test.run_a.jsonl", []);
    const notTrace = await writeTraceFile(dir, "s_test.run_b.jsonl", [
      '{"type":"session","id":"x"}',
    ]);

    expect(await readTraceMeta(empty)).toBeUndefined();
    expect(await readTraceMeta(notTrace)).toBeUndefined();
    expect(await readTraceMeta(join(dir, "不存在.jsonl"))).toBeUndefined();
  });

  it("中途的 error 摘要能读出来（列表要显示这个 run 是否报错）", async () => {
    const dir = makeDir();
    const path = await writeTraceFile(dir, traceName("run_x"), [
      startLine(),
      endLine("run_x", { error: "model 超时" }),
    ]);

    const meta = await readTraceMeta(path);
    expect(meta?.summary?.error).toBe("model 超时");
    expect(meta?.summary?.messages).toBeUndefined();
  });
});
