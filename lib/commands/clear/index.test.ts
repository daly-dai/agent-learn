// ============================================================
// lib/commands/clear/index.test.ts —— /clear 命令
// ============================================================
// 对齐 DSH command-compact 的测试思路：真实 store（临时 jsonl）
// + 假 model（clear 用不到 model，api 只填 store）。
// 验证：无参清空 / 带参数 USAGE / 空会话也成功（reset 幂等）。
// ============================================================

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlSessionStore } from "@/lib/session";
import type { TeachingModel } from "@/lib/model";
import { createUserMessage } from "@/lib/message";
import { createClearCommand } from "./";
import { createCommandRegistry } from "../index";
import type { CommandApi } from "../types";

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "commands-clear-test-"));
  const store = new JsonlSessionStore(join(dir, "test.jsonl"), dir, "test-session");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { store, cleanup };
}

function apiOf(store: JsonlSessionStore): CommandApi {
  // /clear 不用 model，占位即可（类型要求 CommandApi 完整）
  return { store, model: {} as unknown as TeachingModel };
}

describe("/clear 命令（createClearCommand + 注册表集成）", () => {
  it("无参数 → success，会话消息被清空（buildContext 为空）", async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 1; i <= 3; i += 1) {
        await store.appendMessage(createUserMessage(`消息 ${i}`));
      }
      const registry = createCommandRegistry();
      registry.register(createClearCommand());
      const result = await registry.execute(
        "/clear",
        apiOf(store),
        new AbortController().signal,
      );
      expect(result).toEqual({ kind: "success", text: "会话已清空。" });
      expect(store.buildContext()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("带参数 → error（USAGE，同 /compact）", async () => {
    const { store, cleanup } = makeStore();
    try {
      const registry = createCommandRegistry();
      registry.register(createClearCommand());
      const result = await registry.execute(
        "/clear 别清",
        apiOf(store),
        new AbortController().signal,
      );
      expect(result).toEqual({ kind: "error", text: "用法: /clear（不接受参数）" });
    } finally {
      cleanup();
    }
  });

  it("空会话也成功（reset 幂等：删不存在的文件不报错）", async () => {
    const { store, cleanup } = makeStore();
    try {
      const registry = createCommandRegistry();
      registry.register(createClearCommand());
      const result = await registry.execute(
        "/clear",
        apiOf(store),
        new AbortController().signal,
      );
      expect(result).toEqual({ kind: "success", text: "会话已清空。" });
    } finally {
      cleanup();
    }
  });
});
