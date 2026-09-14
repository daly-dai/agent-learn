// ============================================================
// keys.test.ts —— 键盘事件前置判定单测（B3 原语库评估产物）
// ============================================================
// 从 approval-dialog 键盘 useEffect 里提炼的纯函数层：判定"这个按键
// 该不该由全局快捷键响应"。seam 收最小结构（修饰键布尔 / tagName），
// 不依赖真实 DOM 节点 —— node 环境可直接测（B8 ① app/lib 纯函数层先行）。
// 接入点：approval-dialog（原内联实现搬出）、menu（补 isPlainKey 防护）。

import { describe, expect, it } from "vitest";
import { isEditableTarget, isPlainKey } from ".";

describe("isPlainKey —— 无修饰键的「干净」按键", () => {
  it("三键全 false 是干净按键", () => {
    expect(isPlainKey({ ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
  });

  it("任一修饰键按下都不是干净按键（组合键不该触发快捷键）", () => {
    expect(isPlainKey({ ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isPlainKey({ ctrlKey: false, metaKey: true, altKey: false })).toBe(false);
    expect(isPlainKey({ ctrlKey: false, metaKey: false, altKey: true })).toBe(false);
    expect(isPlainKey({ ctrlKey: true, metaKey: true, altKey: true })).toBe(false);
  });
});

describe("isEditableTarget —— 事件目标是否在可编辑区", () => {
  it("INPUT / TEXTAREA / SELECT 是编辑区（快捷键让路，不抢用户输入）", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("其他元素不是编辑区", () => {
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false);
  });

  it("无目标（e.target 为 null）不是编辑区", () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it("缺 tagName 的最小对象安全降级（不明元素不当编辑区）", () => {
    expect(isEditableTarget({})).toBe(false);
  });
});
