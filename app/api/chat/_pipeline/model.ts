// ============================================================
// _pipeline/model.ts —— 模型选择（转发层，实现已下沉 lib/selectModel.ts）
// ============================================================
// C15（2026-08-31）：selectModel 从本文件移到 lib/selectModel.ts——
// lib/repos/summarize.ts 也要用它，lib 依赖 app 是反向依赖。
// 本文件保留转发，chat route 的既有 import 不受影响。
// ============================================================

export { selectModel } from "@/lib/selectModel";
