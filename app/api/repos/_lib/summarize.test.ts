// ============================================================
// lib/repos/summarize.test.ts —— 仓库变更总结（C15）
// ============================================================
// 覆盖：
//   - summarizeUpdate：正常返回文本 / 空 commit 列表不调模型 /
//     无 key（selectModel 抛错）降级 degraded / 模型 error 降级 / 空输出降级
//   - saveUpdateLog：落盘到 workspace/更新日志/<日期>-<项目>.md
//
// mock 策略：vi.mock selectModel（返回 FakeModel）与 config（临时目录）。
// ============================================================

import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@/lib/types";
import type { CompleteInput, TeachingModel } from "@/lib/model";

// ---- 先 mock 再 import 被测模块 ----
const tempDir = mkdtempSync(join(tmpdir(), "repo-summarize-test-"));

/** 可编程的假模型：每个测试自己 setHandler */
class FakeModel implements TeachingModel {
  private handler: (input: CompleteInput) => AssistantMessage = () => ({
    role: "assistant",
    content: [{ type: "text", text: "默认总结" }],
    stopReason: "stop",
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp: 0,
  });

  setHandler(h: (input: CompleteInput) => AssistantMessage) {
    this.handler = h;
  }

  async complete(input: CompleteInput): Promise<AssistantMessage> {
    return this.handler(input);
  }
}

const fakeModel = new FakeModel();

vi.mock("@/lib/selectModel", () => ({
  selectModel: vi.fn(() => ({ model: fakeModel, label: "fake" })),
}));

vi.mock("@/lib/config", () => ({
  config: {
    paths: {
      workspace: tempDir,
    },
  },
}));

import { summarizeUpdate, saveUpdateLog } from "./summarize";

/** 构造 assistant 消息的便捷函数 */
function assistant(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    usage: { input: 0, output: 0, totalTokens: 0 },
    timestamp: 0,
  };
}

describe("summarizeUpdate —— 变更总结", () => {
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("正常返回总结文本，degraded=false", async () => {
    fakeModel.setHandler((input) => {
      // 验证 prompt 里带了 commit 和项目背景
      expect(input.messages.length).toBe(1);
      const text = (input.messages[0] as { content: { type: "text"; text: string }[] }).content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      expect(text).toContain("abc1234 修复 X");
      expect(text).toContain("主参考");
      return assistant("## 更新概览\n修复了 X");
    });

    const summary = await summarizeUpdate("pi", "主参考：agent-loop", [
      "abc1234 修复 X",
      "def5678 新增 Y",
    ]);

    expect(summary.degraded).toBe(false);
    expect(summary.text).toContain("更新概览");
  });

  it("空 commit 列表：不调模型，返回空且非降级", async () => {
    const spy = vi.fn();
    fakeModel.setHandler(spy as never);

    const summary = await summarizeUpdate("pi", "note", []);

    expect(spy).not.toHaveBeenCalled();
    expect(summary.text).toBe("");
    expect(summary.degraded).toBe(false);
  });

  it("超过 40 条 commit 截断（防撑爆请求，提示截断）", async () => {
    let promptText = "";
    fakeModel.setHandler((input) => {
      const text = (input.messages[0] as { content: { type: "text"; text: string }[] }).content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      promptText = text;
      return assistant("ok");
    });

    const many = Array.from({ length: 50 }, (_, i) => `commit-${i} msg`);
    await summarizeUpdate("pi", "note", many);

    expect(promptText).toContain("共 50 条，以下展示前 40 条");
    expect(promptText).toContain("commit-0");
    expect(promptText).not.toContain("commit-49");
  });

  it("模型返回 error → 降级 degraded=true", async () => {
    fakeModel.setHandler(() => assistant("", "error"));
    const summary = await summarizeUpdate("pi", "note", ["c1 msg"]);
    expect(summary.degraded).toBe(true);
    expect(summary.text).toBe("");
  });

  it("模型返回空文本 → 降级 degraded=true（fail-closed）", async () => {
    fakeModel.setHandler(() => assistant("   "));
    const summary = await summarizeUpdate("pi", "note", ["c1 msg"]);
    expect(summary.degraded).toBe(true);
  });
});

describe("saveUpdateLog —— 落盘 workspace", () => {
  it("生成 workspace/更新日志/<日期>-<项目>.md，含 commit 列表与总结", async () => {
    const ok = await saveUpdateLog("pi", { text: "## 更新概览\n修了 X", degraded: false }, [
      "abc1234 修复 X",
    ]);

    expect(ok).toBe(true);
    // 找生成的文件（日期动态，扫目录）
    const dir = join(tempDir, "更新日志");
    expect(existsSync(dir)).toBe(true);
    const files = require("node:fs").readdirSync(dir) as string[];
    const mine = files.find((f) => f.endsWith("-pi.md"));
    expect(mine).toBeDefined();

    const content = readFileSync(join(dir, mine!), "utf8");
    expect(content).toContain("pi 更新日志");
    expect(content).toContain("- abc1234 修复 X");
    expect(content).toContain("## 更新概览");
  });

  it("降级总结也落盘（标记未生成 LLM 总结）", async () => {
    const ok = await saveUpdateLog("codex", { text: "", degraded: true }, ["c1 msg"]);
    expect(ok).toBe(true);
    const dir = join(tempDir, "更新日志");
    const files = require("node:fs").readdirSync(dir) as string[];
    const mine = files.find((f) => f.endsWith("-codex.md"));
    expect(mine).toBeDefined();
    expect(readFileSync(join(dir, mine!), "utf8")).toContain("未生成 LLM 总结");
  });
});
