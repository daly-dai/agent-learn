// ============================================================
// trace-files.test.ts —— 会话目录 → 轨迹文件（定位层）
// ============================================================
// 测 seam：listTraceFiles(会话目录) → 按文件名升序的路径数组。
// 布局（2026-11-11）：<会话目录>/trace.<runId>.jsonl —— 归属由**目录**表达，
// 文件名只承载 runId，所以这里只做「目录内过滤 + 排序」，不再解析文件名。
// ============================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTraceFiles } from "./index";

const RUN_EARLY = "run_2026-08-19T06-00-00-000Z_aaaaaa";
const RUN_LATE = "run_2026-08-19T07-00-00-000Z_bbbbbb";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trace-files-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string): string {
  const path = join(dir, name);
  writeFileSync(path, "{}\n");
  return path;
}

describe("listTraceFiles", () => {
  it("按文件名升序（runId 含定宽时间戳 ⇒ 字典序即时间序）", async () => {
    // 故意先建晚的：证明排序不是"建文件顺序"
    file(`trace.${RUN_LATE}.jsonl`);
    file(`trace.${RUN_EARLY}.jsonl`);

    expect(await listTraceFiles(dir)).toEqual([
      join(dir, `trace.${RUN_EARLY}.jsonl`),
      join(dir, `trace.${RUN_LATE}.jsonl`),
    ]);
  });

  it("只认 trace.*.jsonl：会话主日志与别的文件不算轨迹", async () => {
    file("session.jsonl");
    file("trace.notes.txt");
    file("README.md");
    const trace = file(`trace.${RUN_EARLY}.jsonl`);

    expect(await listTraceFiles(dir)).toEqual([trace]);
  });

  it("名字像轨迹的**目录**不算（isFile 判据）", async () => {
    mkdirSync(join(dir, `trace.${RUN_EARLY}.jsonl`));

    expect(await listTraceFiles(dir)).toEqual([]);
  });

  it("目录不存在 → 空数组（还没跑过 agent，不是错误）", async () => {
    expect(await listTraceFiles(join(dir, "根本没有这个目录"))).toEqual([]);
  });
});
