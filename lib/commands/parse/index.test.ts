// ============================================================
// lib/commands/parse.test.ts —— 斜杠命令解析纯函数（C13 seam）
// ============================================================
// 对齐：codex parse_slash_name（name/rest/restOffset 三元组）
//       + DSH parseCommand（/^\/...(?=$|[\t\n\r ])/ 分隔符断言）
//       + codex should_parse_on_dequeue（行首无空格 + trim 后 / 开头）
// 纯函数、无依赖——命令解析层不碰注册表、不碰文件系统。
// ============================================================

import { describe, expect, it } from "vitest";
import {
  isSlashCommandLine,
  parseSlashName,
  validateSubmission,
} from ".";

describe("parseSlashName —— 解析一行命令（codex parse_slash_name 形状）", () => {
  it("裸命令：/compact → name + 空 rest", () => {
    expect(parseSlashName("/compact")).toEqual({
      name: "compact",
      rest: "",
      restOffset: 8,
    });
  });

  it("带行内参数：rest 是 trim 后的参数，restOffset 指向 rest 在原文的偏移", () => {
    expect(parseSlashName("/compact 手动压缩")).toEqual({
      name: "compact",
      rest: "手动压缩",
      restOffset: 9,
    });
  });

  it("多个空白分隔：rest 去掉全部前导空白", () => {
    expect(parseSlashName("/export   a.jsonl")).toEqual({
      name: "export",
      rest: "a.jsonl",
      restOffset: 10, // /export(7) + 3 个空格
    });
  });

  it("Tab 分隔也算分隔符", () => {
    expect(parseSlashName("/model\tdeepseek")).toEqual({
      name: "model",
      rest: "deepseek",
      restOffset: 7,
    });
  });

  it("名字允许连字符与下划线（DSH COMMAND_NAME 同款）", () => {
    expect(parseSlashName("/a-b_c")).toEqual({
      name: "a-b_c",
      rest: "",
      restOffset: 6,
    });
  });

  it("无斜杠：不是命令", () => {
    expect(parseSlashName("compact")).toBeNull();
  });

  it("行首空格：不是命令（parse 只管严格行首，行首空格由 isSlashCommandLine 判）", () => {
    expect(parseSlashName(" /compact")).toBeNull();
  });

  it("命令后紧跟斜杠：/foo/bar 不误命中 /foo（DSH 分隔符断言）", () => {
    expect(parseSlashName("/foo/bar")).toBeNull();
  });

  it("大写开头：非法命令名（必须是 [a-z] 开头）", () => {
    expect(parseSlashName("/Compact")).toBeNull();
  });

  it("数字开头：非法命令名", () => {
    expect(parseSlashName("/9abc")).toBeNull();
  });

  it("只有斜杠：不是命令", () => {
    expect(parseSlashName("/")).toBeNull();
  });
});

describe("isSlashCommandLine —— 这行要不要按命令解析（codex should_parse_on_dequeue）", () => {
  it("裸命令 → true", () => {
    expect(isSlashCommandLine("/compact")).toBe(true);
  });

  it("行首空格 → false（粘贴的代码/文本开头空格不是命令）", () => {
    expect(isSlashCommandLine("  /compact")).toBe(false);
  });

  it("普通消息 → false", () => {
    expect(isSlashCommandLine("帮我读一个文件")).toBe(false);
  });

  it("空串 → false", () => {
    expect(isSlashCommandLine("")).toBe(false);
  });

  it("只看首行：首行是命令 → true（多行消息以命令开头）", () => {
    expect(isSlashCommandLine("/compact\n后面还有说明")).toBe(true);
  });

  it("只看首行：首行不是命令 → false", () => {
    expect(isSlashCommandLine("先说明\n/compact")).toBe(false);
  });

  it("首行无空格但后续行有 / 开头的路径：只看首行不误判", () => {
    expect(isSlashCommandLine("读一下这个\n/src/app/page.tsx")).toBe(false);
  });
});

describe("validateSubmission —— 提交验证（codex SubmissionValidation 硬边界）", () => {
  const NAMES: ReadonlySet<string> = new Set(["compact", "model"]);

  it("名字已注册 → ok: true", () => {
    expect(validateSubmission("/compact", NAMES)).toEqual({ ok: true });
  });

  it("未知命令 → ok: false + 名字（不进模型，报错给用户）", () => {
    expect(validateSubmission("/copmact", NAMES)).toEqual({
      ok: false,
      name: "copmact",
    });
  });

  it("不是命令形态（行首空格）→ ok: true（按普通消息发）", () => {
    expect(validateSubmission("  /compact", NAMES)).toEqual({ ok: true });
  });

  it("含 / 的路径 → ok: true（不拦截粘贴的路径）", () => {
    expect(validateSubmission("/src/app/page.tsx", NAMES)).toEqual({
      ok: true,
    });
  });

  it("普通消息 → ok: true", () => {
    expect(validateSubmission("帮我读一个文件", NAMES)).toEqual({ ok: true });
  });
});
