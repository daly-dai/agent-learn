// ============================================================
// process-output 的测试夹具 —— 真管道产出的 pwsh 报错信封（C36 T2）
// ============================================================
// ⭐ **不是手编的**：下面这几段来自一次**真实运行**的工具结果原文 ——
//   `.sessions/s_2026-09-17T00-18-22-102Z_sj9bo2.jsonl` 第 33 行（全文 2397 字符）。
// 那一次模型在管道里写了 `$_.Line.Substring(0,[Math]::Min(120,$_.Line.Length))`，
// 受限语言模式把每个文件都拒了一次 ⇒ **同一条报错重复 20 遍**、退出码却是 0、
// 工具回来是「成功」（详案 C36 第二节）。
//   ⚠️ 数字订正：详案里当时**粗估**是 18 遍，真样本数出来是 **20**（按真样本走）。
//
// 为什么值得留在这个位置：两个消费者 —— `index.test.ts`（解人话）
// 和 `lib/tools/bash/index.test.ts`（stdout 里出现同形文本时**不该**被当成报错）。
// ============================================================

/** 真样本里的单条报错（`_xHHHH_` 是 CLIXML 对控制字符的转义，含 ANSI 色码） */
export const REAL_PWSH_ERROR_ENTRY =
  '<S S="Error">_x001B_[31;1mInvalidOperation: _x001B_[31;1m无法调用方法。在此语言模式下，方法调用仅在核心类型上受支持。_x001B_[0m_x000D__x000A_</S>';

/** 真样本的完整 stderr：CLIXML 信封 + 同一条报错 ×20 */
export const REAL_PWSH_STDERR =
  '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
  REAL_PWSH_ERROR_ENTRY.repeat(20) +
  "</Objs>";

/** 解出来的那一句人话（ANSI 去掉、转义解掉、行尾 \r\n 去掉） */
export const REAL_PWSH_MESSAGE =
  "InvalidOperation: 无法调用方法。在此语言模式下，方法调用仅在核心类型上受支持。";

/**
 * 第二条真实报错（形状同真样本；内容是 2026-08-26 实测的另一条受限模式报错：
 * `[System.Text.UTF8Encoding]::new($false)` → 类型创建被禁）。
 * 用于"多种报错混在一起"的去重/计数用例 —— 单一内容的夹具测不出去重是否真的按内容做。
 */
export const SECOND_PWSH_ERROR_ENTRY =
  '<S S="Error">_x001B_[31;1mCannotCreateTypeConstrainedLanguage_x001B_[0m_x000D__x000A_</S>';
