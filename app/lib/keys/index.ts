// ============================================================
// keys.ts —— 键盘事件前置判定（B3 原语库评估产物，2026-08-28）
// ============================================================
// 从 approval-dialog 的键盘 useEffect 内联逻辑提炼：全局快捷键监听前，
// 先判定"这个按键该不该由快捷键响应"。两个判定各司其职：
//   - isPlainKey        ：修饰键组合（Ctrl/Cmd/Alt+X）让路，不抢系统/浏览器
//                         快捷键；menu 等组件也用它防"Ctrl+方向键"误触发
//   - isEditableTarget  ：焦点在输入框/文本域/下拉时让路——用户在打字，
//                         快捷键不该抢输入（抄 Reasonix isPlainKey 的思路）
//
// seam 设计：收最小结构（修饰键布尔 / tagName 字符串）而非真实 DOM 事件
// 对象 —— 这样纯函数层可在 node 环境直接单测（B8 ①），无需 jsdom。
// ============================================================

/** 无 ctrl/meta/alt 修饰键的组合键（"干净的"按键）。 */
export function isPlainKey(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** 事件目标是否在可编辑区（INPUT/TEXTAREA/SELECT）——快捷键让路，不抢输入。 */
export function isEditableTarget(target: { tagName?: string } | null): boolean {
  if (!target || !target.tagName) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
