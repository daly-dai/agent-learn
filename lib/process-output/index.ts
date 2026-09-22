// ============================================================
// process-output —— 子进程输出的解码器（字节流 → 正确编码的文本）
// ============================================================
//
// 为什么独立成模块而不是埋在 BashRunner 里：
//   不只 bash 用。PLAN C9 python 工具、C2 沙箱 runner 都要 spawn
//   子进程 + 捕获输出——解码是它们的公共横切点。拆出来让"复用进程
//   管理"不被编码假设绑架。
//
// 为什么用 TextDecoder 的 stream 模式（不用 chunk.toString()）：
//   1. 跨 chunk 半个字符：GBK/UTF-8 都是变长编码，一个汉字可能被
//      切成两块到达。TextDecoder 的 stream 模式保留内部状态，
//      跨块字节正确拼回；toString 每次独立解码会直接断在中间。
//
// 编码策略（2026-08-25 定稿，2026-08-26 修正触发方式，对齐 DSH）：
//   默认 UTF-8，不按平台猜。关键在于【输出端统一】：bash-runner 在
//   Windows 上用 cmd 包一层（chcp 65001 → pwsh -EncodedCommand），把
//   stdout/stderr 一律转成 UTF-8，所以接收端固定 UTF-8 解即可。cmd 生态
//   输出天生混合（GBK 报错 + UTF-8 文件内容），接收端猜一个固定编码物理上
//   做不到全对。
//
//   为什么从"pwsh 双 pin"改成"cmd + chcp"（2026-08-26）：
//   Smart App Control / WDAC 等安全策略会把 pwsh 压进受限语言模式，
//   .NET 类型创建/属性 setter/静态方法全被禁，双 pin 的
//   [System.Text.UTF8Encoding]::new() 整行失败 → pin 不生效 → 输出仍 GBK。
//   chcp 是 cmd 内建命令不碰 .NET，pwsh 作为 cmd 子进程启动时读到 65001，
//   受限/非受限环境都有效。详见 bash-runner.ts 文件头注释。
//
// 用法（注意：stdout/stderr 必须各建一个实例——TextDecoder 有内部
// 状态，两个流共用会把一端的半个字符交给另一端补齐，照样乱码）：
//   const dec = createOutputDecoder();
//   dec.decode(chunk);   // 流式：每收到一块调一次
//   dec.flush();         // 流结束时调一次，吐出残留字节
// ============================================================

export type OutputDecoder = {
  /** 流式解码一块字节；跨块的半个字符由内部状态自动拼接 */
  decode(chunk: Buffer): string;
  /** 流结束：吐出最后一个可能不完整的字符（没有则空串） */
  flush(): string;
};

/**
 * 创建子进程输出解码器。
 * @param encoding 显式指定编码（测试用）；省略时默认 UTF-8。
 *
 * 为什么默认 UTF-8（2026-08-25 定稿，对齐 DSH）：接收端不再"猜编码"。
 * 关键在于【输出端统一】：bash-runner 在 Windows 上用 cmd 包一层
 * （chcp 65001 → pwsh -EncodedCommand），把 stdout/stderr 一律转成 UTF-8，
 * 所以接收端固定 UTF-8 解即可。cmd 生态输出天生混合（GBK 报错 + UTF-8
 * 文件内容），接收端猜一个固定编码物理上做不到全对——统一输出编码才是治本。
 * （受限语言模式禁 .NET，双 pin 会失败，故用 chcp，详见 bash-runner.ts）
 */
export function createOutputDecoder(encoding = "utf-8"): OutputDecoder {
  const decoder = new TextDecoder(encoding);

  return {
    decode(chunk: Buffer): string {
      // stream:true = 保留内部状态，跨块的半个字符等下一块补齐
      return decoder.decode(chunk, { stream: true });
    },
    flush(): string {
      // 无参调用 = 结束流，吐出残留（等同 flush）
      return decoder.decode();
    },
  };
}

// ============================================================
// pwsh 的报错信封：CLIXML → 人话（C36 T2）
// ============================================================
//
// 为什么住这一层：这仍是"子进程输出"的事 —— 谁 spawn pwsh 都会遇到
// （C9 的 python 执行器同样需要把 stderr 变成人话）。
//
// 背景（真样本见 `test-fixtures.ts`）：pwsh 的报错走管道会被序列化成 CLIXML，
// 里面套着 ANSI 色码与 `_xHHHH_` 转义。我们**收下了、没解、也没看** ——
// 于是"20 个文件全报错"在模型眼里是「成功」，在屏幕上是一坨看不懂的 XML。
//
// 为什么必须去重：真样本里同一条报错重复 **20 遍**，噪音把信号埋了；
// **「×20」才是信息**。

export type PwshErrorReport = {
  /** 去重**前**的报错条数（真样本是 20）——"同一条发生了多少次"本身是信息 */
  count: number;
  /** 去重后的人话，按首次出现顺序 */
  messages: string[];
  /** 给模型看的现成一段：`[pwsh 报错 ×20]` + 换行 + 人话 */
  summary: string;
};

/** pwsh 把错误流序列化成 CLIXML 时，文本以这七个字符开头 */
const CLIXML_MARKER = "#< CLIXML";

/**
 * 认 CLIXML → 解出每条报错（解转义 + 去 ANSI + 去重计数）。
 * **不认得就返回 `null`**（没有 CLIXML 标记、或一条 Error 都没有）——
 * 调用方照原样用它的文本，**不吞信息**。
 */
export function readPwshErrors(text: string): PwshErrorReport | null {
  if (!text.includes(CLIXML_MARKER)) return null;

  const entries = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(
    (match) => decodeClixmlEntry(match[1]),
  );
  if (entries.length === 0) return null;

  // 去重按**内容**：同一条报错重复 20 遍只留一句，但计数保留 20
  const messages = [...new Set(entries.filter((entry) => entry.length > 0))];
  const body = messages.length > 0 ? `\n${messages.join("\n")}` : "";

  return {
    count: entries.length,
    messages,
    summary: `[pwsh 报错 ×${entries.length}]${body}`,
  };
}

/**
 * 把 CLIXML 的**信封**从文本里摘掉：报错条目、`#< CLIXML` 头、`<Objs …>` / `</Objs>` 壳。
 * 其余内容（stdout 正文、非 Error 的记录）原样保留。
 *
 * ⚠️ **调用前必须先确认这是真报错**（`readPwshErrors(stderr)` 非 null）——
 * 这个函数本身不判断来源，它只是"把这一段机器话拿掉"。判据在调用方：
 * **只信 stderr**（CLIXML 的家），stdout 里出现同形文本是**内容**不是报错。
 */
export function stripPwshClixml(text: string): string {
  return text
    .replace(/<S S="Error">[\s\S]*?<\/S>/g, "")
    .replace(/#< CLIXML\s*/g, "")
    .replace(/<Objs\b[^>]*>\s*/g, "")
    .replace(/<\/Objs>\s*/g, "");
}

/**
 * 解一条 CLIXML 报错：`_xHHHH_` 转义 → ANSI 色码 → 行尾 \r。
 * 顺序不能换：`_x001B_` 解出来**才是** ESC，先解后洗才洗得掉 `_x001B_[31;1m`。
 */
function decodeClixmlEntry(raw: string): string {
  return raw
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();
}
