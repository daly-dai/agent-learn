// ============================================================
// lib/commands/compact/index.test.ts —— /compact 命令 + compactNow 共享压缩
// ============================================================
// compactNow 对齐 DSH compactNow（手动压缩：无条件切点 + 共享摘要降级）。
// /compact handler 对齐 DSH command-compact：
//   - 带参数 → error（USAGE）
//   - 无可压历史 → success（"没有可压缩的历史"）
//   - 成功 → success + 压缩统计
// 压缩生效验证：buildContext 里出现 compactionSummary 消息
// （前端压缩卡片的数据源，验收点）。
// ============================================================

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlSessionStore } from "@/lib/session";
import { FakeModel } from "@/lib/testing/fake-model";
import {
  createAssistantMessage,
  createUserMessage,
  text,
} from "@/lib/message";
import { compactNow, createCompactCommand } from "./";
import { createCommandRegistry } from "../index";
import type { CommandApi } from "../types";

/** 真实 store（临时 jsonl）+ 假模型：压缩链路的完整闭环 */
function makeDeps() {
  const dir = mkdtempSync(join(tmpdir(), "commands-compact-test-"));
  const store = new JsonlSessionStore(join(dir, "test.jsonl"), dir, "test-session");
  const model = new FakeModel(() =>
    createAssistantMessage([text("## Goal\n测试摘要")]),
  );
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { store, model, cleanup };
}

/** 灌入 10 条用户消息（> compactKeepRecent 默认 8，必出切点） */
async function seedMessages(store: JsonlSessionStore) {
  for (let i = 1; i <= 10; i += 1) {
    await store.appendMessage(createUserMessage(`消息 ${i}`));
  }
}

function apiOf(deps: ReturnType<typeof makeDeps>): CommandApi {
  return { store: deps.store, model: deps.model };
}

describe("compactNow —— 手动压缩共享逻辑（DSH compactNow 对齐）", () => {
  it("有历史 → 返回 { entry, summarizedCount, tokensSummarized }，entry 追加到末尾", async () => {
    const deps = makeDeps();
    try {
      await seedMessages(deps.store);
      const before = deps.store.getEntries().length;
      const outcome = await compactNow(deps.store, deps.model, new AbortController().signal);
      expect(outcome).not.toBeNull();
      expect(outcome!.summarizedCount).toBe(2); // 10 条 - 保留 8 条
      expect(outcome!.tokensSummarized).toBeGreaterThan(0); // 本次压掉的 token
      // 线性日志：压缩条目就是最后一条（原断言是"成为新叶子"——树已砍，C18 §7.5）
      const entries = deps.store.getEntries();
      expect(entries.length).toBe(before + 1);
      expect(entries.at(-1)!.id).toBe(outcome!.entry.id);
    } finally {
      deps.cleanup();
    }
  });

  it("上次压缩后没有新消息 → null（空转不执行，避免「压缩 0 条」）", async () => {
    const deps = makeDeps();
    try {
      await seedMessages(deps.store);
      await compactNow(deps.store, deps.model, new AbortController().signal);
      // 第二次：待压区为空（保留区 8 条都还是上次保留的）
      const second = await compactNow(deps.store, deps.model, new AbortController().signal);
      expect(second).toBeNull();
    } finally {
      deps.cleanup();
    }
  });

  it("压缩后 buildContext 含 compactionSummary 消息（前端压缩卡片数据源）", async () => {
    const deps = makeDeps();
    try {
      await seedMessages(deps.store);
      await compactNow(deps.store, deps.model, new AbortController().signal);
      const context = deps.store.buildContext();
      expect(context.some((m) => m.role === "compactionSummary")).toBe(true);
    } finally {
      deps.cleanup();
    }
  });

  it("空会话（无消息）→ null（无可压历史）", async () => {
    const deps = makeDeps();
    try {
      const outcome = await compactNow(deps.store, deps.model, new AbortController().signal);
      expect(outcome).toBeNull();
    } finally {
      deps.cleanup();
    }
  });
});

describe("/compact 命令（createCompactCommand + 注册表集成）", () => {
  it("无参数 → success + 压缩统计文案（本次压掉 token 数）", async () => {
    const deps = makeDeps();
    try {
      await seedMessages(deps.store);
      const registry = createCommandRegistry();
      registry.register(createCompactCommand());
      const result = await registry.execute(
        "/compact",
        apiOf(deps),
        new AbortController().signal,
      );
      expect(result).toEqual({
        kind: "success",
        text: "已压缩 2 条消息（本次压掉约 4 tokens）。",
      });
    } finally {
      deps.cleanup();
    }
  });

  it("上次压缩后无新消息 → success（「没有可压缩的历史」，不空转）", async () => {
    const deps = makeDeps();
    try {
      await seedMessages(deps.store);
      const registry = createCommandRegistry();
      registry.register(createCompactCommand());
      await registry.execute("/compact", apiOf(deps), new AbortController().signal);
      const second = await registry.execute(
        "/compact",
        apiOf(deps),
        new AbortController().signal,
      );
      expect(second).toEqual({ kind: "success", text: "没有可压缩的历史。" });
    } finally {
      deps.cleanup();
    }
  });

  it("带参数 → error（USAGE，DSH command-compact 同款）", async () => {
    const deps = makeDeps();
    try {
      await seedMessages(deps.store);
      const registry = createCommandRegistry();
      registry.register(createCompactCommand());
      const result = await registry.execute(
        "/compact 别压",
        apiOf(deps),
        new AbortController().signal,
      );
      expect(result).toEqual({ kind: "error", text: "用法: /compact（不接受参数）" });
    } finally {
      deps.cleanup();
    }
  });

  it("无可压历史 → success（「没有可压缩的历史」）", async () => {
    const deps = makeDeps();
    try {
      const registry = createCommandRegistry();
      registry.register(createCompactCommand());
      const result = await registry.execute(
        "/compact",
        apiOf(deps),
        new AbortController().signal,
      );
      expect(result).toEqual({ kind: "success", text: "没有可压缩的历史。" });
    } finally {
      deps.cleanup();
    }
  });

  it("命令元数据：builtin 来源 + 描述（发现 UI 用）", () => {
    const command = createCompactCommand();
    expect(command.name).toBe("compact");
    expect(command.source).toBe("builtin");
    expect(command.description.length).toBeGreaterThan(0);
  });
});
