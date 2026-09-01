// ============================================================
// lib/repos/history.test.ts —— 更新历史（C15）
// ============================================================
// 覆盖：
//   - parseLogFileName：合法/非法文件名解析（纯函数）
//   - listUpdateLogs：列目录、倒序、忽略非约定文件、目录不存在返回空
//   - readLatestLog：取最新一条；无历史返回 null
// mock config.paths.workspace → 临时目录。
// ============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- 先 mock config 再 import 被测模块 ----
// 坑（2026-09-01 修）：vi.mock 工厂提升到文件顶部执行，引用顶层 const 会
// TDZ；vi.hoisted 回调也在 import 之前执行，拿不到 import 的 fs/os——
// 只用 node 全局（process.env）拼固定路径，beforeAll 重建保证干净。
const tempDir = vi.hoisted(
  () => `${process.env.TEMP ?? "/tmp"}/repo-history-test`,
);
// logsDir 只在测试体内用（vi.mock 工厂只引用 tempDir），可以放顶层普通代码
const logsDir = join(tempDir, "更新日志");

vi.mock("@/lib/config", () => ({
  config: {
    paths: {
      workspace: tempDir,
    },
  },
}));

import { listUpdateLogs, parseLogFileName, readAllLogs, readLatestLog } from "./history";

beforeAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(logsDir, { recursive: true });
});

describe("parseLogFileName —— 文件名解析（纯函数）", () => {
  it("合法文件名：拆出日期和项目名", () => {
    expect(parseLogFileName("2026-08-31-pi.md")).toEqual({
      date: "2026-08-31",
      repoName: "pi",
    });
  });

  it("项目名含连字符也能解析（如 deepseek-harness）", () => {
    expect(parseLogFileName("2026-08-31-deepseek-harness.md")).toEqual({
      date: "2026-08-31",
      repoName: "deepseek-harness",
    });
  });

  it("不符合约定的文件名返回 null（README/乱文件不冒充日志）", () => {
    expect(parseLogFileName("README.md")).toBeNull();
    expect(parseLogFileName("pi.md")).toBeNull();
    expect(parseLogFileName("2026-08-31.md")).toBeNull();
    expect(parseLogFileName("2026-08-31-pi.txt")).toBeNull();
  });
});

describe("listUpdateLogs / readLatestLog —— 目录与读取", () => {
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("列目录：只收约定文件，按日期倒序", async () => {
    writeFileSync(join(logsDir, "2026-08-30-codex.md"), "codex 旧", "utf8");
    writeFileSync(join(logsDir, "2026-08-31-pi.md"), "pi 新", "utf8");
    writeFileSync(join(logsDir, "README.md"), "忽略我", "utf8");

    const logs = await listUpdateLogs();

    expect(logs.map((l) => l.fileName)).toEqual([
      "2026-08-31-pi.md",
      "2026-08-30-codex.md",
    ]);
  });

  it("readLatestLog：读该项目最新一条全文", async () => {
    const content = await readLatestLog("pi");
    expect(content).toContain("pi 新");
  });

  it("readLatestLog：没有该项目的日志返回 null", async () => {
    expect(await readLatestLog("no-such-repo")).toBeNull();
  });

  it("同项目跨天多条：取日期最新那条", async () => {
    writeFileSync(join(logsDir, "2026-09-01-pi.md"), "pi 更新", "utf8");
    const content = await readLatestLog("pi");
    expect(content).toContain("pi 更新");
    expect(content).not.toContain("pi 新");
  });

  it("readAllLogs：该项目全部日志，倒序（最新在前）", async () => {
    const logs = await readAllLogs("pi");

    expect(logs.map((l) => l.date)).toEqual(["2026-09-01", "2026-08-31"]);
    expect(logs[0].content).toContain("pi 更新");
    expect(logs[1].content).toContain("pi 新");
  });

  it("readAllLogs：没有该项目的日志返回空数组", async () => {
    expect(await readAllLogs("no-such-repo")).toEqual([]);
  });
});
