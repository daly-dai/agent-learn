// ============================================================
// lib/commands/export/index.test.ts —— /export 命令（门面模式）
// ============================================================
// 对齐 DSH session-log-export 的测试思想：handler 只校验参数 +
// 会话非空，不产文件（下载走独立 GET route，这里不测 HTTP 层）。
// 验证：无参 success / 带参数 USAGE / 空会话 error（验收反馈：
// "0 条会话你导出啥"——空文件没有价值，直接报错）。
// ============================================================

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlSessionStore } from "@/lib/session";
import type { TeachingModel } from "@/lib/model";
import { createUserMessage } from "@/lib/message";
import { createExportCommand } from "./";
import { createCommandRegistry } from "../index";
import type { CommandApi } from "../types";

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "commands-export-test-"));
  const store = new JsonlSessionStore(join(dir, "test.jsonl"), dir, "test-session");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { store, cleanup };
}

function apiOf(store: JsonlSessionStore): CommandApi {
  // /export 不用 model（门面不生成内容），占位即可
  return { store, model: {} as unknown as TeachingModel };
}

describe("/export 命令（createExportCommand，DSH 门面模式）", () => {
  it("空会话 → error（验收反馈：0 条会话无可导出内容）", async () => {
    const { store, cleanup } = makeStore();
    try {
      const registry = createCommandRegistry();
      registry.register(createExportCommand());
      const result = await registry.execute(
        "/export",
        apiOf(store),
        new AbortController().signal,
      );
      expect(result).toEqual({
        kind: "error",
        text: "会话为空，没有可导出的内容。",
      });
    } finally {
      cleanup();
    }
  });

  it("带参数 → error（USAGE，同 /compact /clear）", async () => {
    const { store, cleanup } = makeStore();
    try {
      const registry = createCommandRegistry();
      registry.register(createExportCommand());
      const result = await registry.execute(
        "/export my.jsonl",
        apiOf(store),
        new AbortController().signal,
      );
      expect(result).toEqual({ kind: "error", text: "用法: /export（不接受参数）" });
    } finally {
      cleanup();
    }
  });

  it("有消息 → success（下载已请求；实际下载走独立 GET route）", async () => {
    const { store, cleanup } = makeStore();
    try {
      await store.appendMessage(createUserMessage("你好"));
      const registry = createCommandRegistry();
      registry.register(createExportCommand());
      const result = await registry.execute(
        "/export",
        apiOf(store),
        new AbortController().signal,
      );
      expect(result).toEqual({
        kind: "success",
        text: "导出已请求，浏览器将下载会话文件。",
      });
    } finally {
      cleanup();
    }
  });

  it("元数据：builtin 来源 + 描述（发现 UI 用）", () => {
    const command = createExportCommand();
    expect(command.name).toBe("export");
    expect(command.source).toBe("builtin");
    expect(command.description.length).toBeGreaterThan(0);
  });
});
