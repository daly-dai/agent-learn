// ============================================================
// trace-files —— 会话 → 轨迹文件定位（A3）
// ============================================================
// 测 seam：listTraceFiles(traceDir, sessionId) → TraceFile[]（按时间升序）。
// 这个模块的全部价值就是两条：① 只认自己那一会话的文件 ② 不动文件内容。
// 所以用例围绕"混进别的会话/老文件/子目录时怎么办"展开。
// ============================================================

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceFileName } from "../trace";
import { listTraceFiles } from "./index";

const cleanups: Array<() => void> = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "trace-files-test-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** 只建文件，内容随便——列目录不该读内容 */
async function touch(dir: string, name: string): Promise<void> {
  await writeFile(join(dir, name), "内容不重要\n", "utf8");
}

// runId 用真实形状（定宽 ISO 时间戳），这样排序断言才有意义
const RUN_EARLY = "run_2026-09-14T07-00-05-195Z_aaaaaa";
const RUN_LATE = "run_2026-09-14T09-30-00-000Z_bbbbbb";

describe("listTraceFiles", () => {
  it("只列本会话的文件，按时间升序（与写入顺序无关）", async () => {
    const dir = makeDir();
    await touch(dir, traceFileName("s_target", RUN_LATE));
    await touch(dir, traceFileName("s_target", RUN_EARLY));

    const files = await listTraceFiles(dir, "s_target");
    expect(files.map((file) => file.runId)).toEqual([RUN_EARLY, RUN_LATE]);
    expect(files.map((file) => file.sessionId)).toEqual(["s_target", "s_target"]);
    expect(files[0].path).toBe(join(dir, traceFileName("s_target", RUN_EARLY)));
  });

  it("别的会话的文件不混进来", async () => {
    const dir = makeDir();
    await touch(dir, traceFileName("s_target", RUN_EARLY));
    await touch(dir, traceFileName("s_other", RUN_EARLY));

    const files = await listTraceFiles(dir, "s_target");
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("s_target");
  });

  it("会话 id 互为前缀时不误伤（s_a 不会把 s_ab 的文件算进来）", async () => {
    const dir = makeDir();
    await touch(dir, traceFileName("s_a", RUN_EARLY));
    await touch(dir, traceFileName("s_ab", RUN_EARLY));

    const files = await listTraceFiles(dir, "s_a");
    expect(files.map((file) => file.sessionId)).toEqual(["s_a"]);
  });

  it("老轨迹文件名（<runId>.jsonl，没有会话前缀）被忽略——它们归不到任何会话", async () => {
    const dir = makeDir();
    await touch(dir, `${RUN_EARLY}.jsonl`);
    await touch(dir, traceFileName("s_target", RUN_EARLY));

    const files = await listTraceFiles(dir, "s_target");
    expect(files).toHaveLength(1);
  });

  it("忽略子目录（哪怕名字长得像轨迹文件）", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, traceFileName("s_target", RUN_EARLY)));
    await touch(dir, traceFileName("s_target", RUN_LATE));

    const files = await listTraceFiles(dir, "s_target");
    expect(files.map((file) => file.runId)).toEqual([RUN_LATE]);
  });

  it("目录不存在 → 空数组（不是抛错）", async () => {
    const dir = makeDir();
    expect(await listTraceFiles(join(dir, "根本没有这个目录"), "s_target")).toEqual([]);
  });

  it("没有轨迹的会话 → 空数组", async () => {
    const dir = makeDir();
    await touch(dir, traceFileName("s_other", RUN_EARLY));
    expect(await listTraceFiles(dir, "s_target")).toEqual([]);
  });
});
