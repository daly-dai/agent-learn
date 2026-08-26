// ============================================================
// lib/session/index.ts —— 会话模块出口（方案 A：目录 = 模块边界）
// ============================================================
// 为什么收成目录（对齐 pi 的 harness/session/）：
//   - store.ts：单会话读写（JsonlSessionStore）
//   - manager.ts：会话目录级操作（SessionManager）
// 调用方只 import @/lib/session 一个入口，内部怎么拆不关心。
// summarize.ts 不在这里——它是压缩域的"摘要生成"（不依赖存储），
// 对齐 pi 把 compaction 独立于 session（见 doc/02 决策）。
// ============================================================

export { JsonlSessionStore, summarizeEntries } from "./store";
export type { CompactionPreparation } from "./store";
export {
  SessionManager,
  generateSessionId,
  isValidSessionId,
} from "./manager";
export type { SessionSummary } from "./manager";
