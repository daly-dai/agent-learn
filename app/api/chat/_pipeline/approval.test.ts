// ============================================================
// approval.test.ts —— 工具审批决策纯函数单测（E2 步骤 2）
// ============================================================
// 从 route.ts handleToolApproval 提炼的纯决策函数 decideToolCall。
// 外部依赖（审批模式/记忆判定）全部注入 ctx，函数本身纯：
// 同输入必同输出，node 环境直接测。
// 这是 E1 误报教训的解药：决策逻辑从"组装层不可测"变成"决策层可测"。

import { describe, expect, it, vi } from "vitest";
import { decideToolCall, type ApprovalContext } from "./approval";

// 工具调用构造器（最小化）
function call(name: string, args: Record<string, unknown> = {}) {
  return { type: "toolCall" as const, id: "call_1", name, arguments: args };
}

// 默认 ctx：suggest 模式 + 无记忆
function ctx(overrides: Partial<ApprovalContext> = {}): ApprovalContext {
  return {
    sessionId: "s_test",
    sessionDir: "/tmp/sessions",
    getApprovalMode: () => "suggest",
    isReadOnlyBash: () => false,
    isPersistApproved: vi.fn(async () => false),
    isSessionApproved: vi.fn(() => false),
    ...overrides,
  };
}

describe("decideToolCall —— secret/秘密 硬拦截", () => {
  it("write_file 含 secret 文件名 → block（不弹框）", async () => {
    const r = await decideToolCall(call("write_file", { path: "secret-key.txt" }), ctx());
    expect(r.action).toBe("block");
  });

  it("write_note 含 秘密 文件名 → block", async () => {
    const r = await decideToolCall(call("write_note", { fileName: "秘密笔记.md" }), ctx());
    expect(r.action).toBe("block");
  });

  it("write_file 普通文件名 → 不拦截（走后续判定 → request）", async () => {
    // 收紧：断言精确到 request（需要弹框），而不是"不是 block"——
    // not.toBe("block") 会把误 allow 也放行，测不出"走了后续判定"
    const r = await decideToolCall(call("write_file", { path: "notes.md" }), ctx());
    expect(r.action).toBe("request");
  });
});

describe("decideToolCall —— 分级模式", () => {
  it("bypass 模式：除硬拦截外全部放行（不查记忆不弹框）", async () => {
    const c = ctx({ getApprovalMode: () => "bypass" });
    const r = await decideToolCall(call("write_file", { path: "x.ts" }), c);
    expect(r.action).toBe("allow");
    expect(c.isPersistApproved).not.toHaveBeenCalled();
  });

  it("never 模式 + 需确认工具 → block", async () => {
    const r = await decideToolCall(call("write_file", { path: "x.ts" }), ctx({ getApprovalMode: () => "never" }));
    expect(r.action).toBe("block");
  });

  it("never 模式 + 只读工具 → allow（不在确认名单）", async () => {
    const r = await decideToolCall(call("read_file", { path: "x.ts" }), ctx({ getApprovalMode: () => "never" }));
    expect(r.action).toBe("allow");
  });
});

describe("decideToolCall —— 只读 bash 放行", () => {
  it("bash 只读命令 → allow（不弹框）", async () => {
    const r = await decideToolCall(
      call("bash", { command: "Get-Content a.txt" }),
      ctx({ isReadOnlyBash: () => true }),
    );
    expect(r.action).toBe("allow");
  });

  it("bash 写命令（只读判定 false）→ 走弹框（suggest 下返回 request）", async () => {
    const r = await decideToolCall(
      call("bash", { command: "Write-File x" }),
      ctx({ isReadOnlyBash: () => false }),
    );
    expect(r.action).toBe("request");
  });
});

describe("decideToolCall —— 记忆放行", () => {
  it("持久记忆命中 → allow（不弹框）", async () => {
    const r = await decideToolCall(
      call("write_file", { path: "x.ts" }),
      ctx({ isPersistApproved: vi.fn(async () => true) }),
    );
    expect(r.action).toBe("allow");
  });

  it("会话记忆命中 → allow（不弹框）", async () => {
    const r = await decideToolCall(
      call("write_file", { path: "x.ts" }),
      ctx({ isSessionApproved: vi.fn(() => true) }),
    );
    expect(r.action).toBe("allow");
  });

  it("persist 优先于 session：persist 命中时不再查 session（信任强度从高到低）", async () => {
    const sessionSpy = vi.fn(() => true);
    await decideToolCall(
      call("write_file", { path: "x.ts" }),
      ctx({
        isPersistApproved: vi.fn(async () => true),
        isSessionApproved: sessionSpy,
      }),
    );
    expect(sessionSpy).not.toHaveBeenCalled();
  });

  it("无记忆 + suggest → request（弹框）", async () => {
    const r = await decideToolCall(call("write_file", { path: "x.ts" }), ctx());
    expect(r.action).toBe("request");
  });
});

describe("decideToolCall —— list_files 补默认参数", () => {
  it("list_files 无 path → rewrite 补 '.'", async () => {
    const r = await decideToolCall(call("list_files", {}), ctx());
    expect(r.action).toBe("rewrite");
    if (r.action === "rewrite") {
      expect(r.args).toEqual({ path: "." });
    }
  });

  it("list_files 有 path → 不动", async () => {
    const r = await decideToolCall(call("list_files", { path: "src" }), ctx());
    expect(r.action).toBe("allow");
  });
});

describe("decideToolCall —— 只读工具默认放行", () => {
  it("read_file / grep / find → allow", async () => {
    for (const name of ["read_file", "grep", "find"]) {
      const r = await decideToolCall(call(name), ctx());
      expect(r.action).toBe("allow");
    }
  });
});
