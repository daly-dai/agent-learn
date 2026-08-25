// ============================================================
// process-output —— 子进程输出的解码器（字节流 → 正确编码的文本）
// ============================================================
//
// 为什么独立成模块而不是埋在 BashRunner 里：
//   不只 bash 用。PLAN C9 python 工具、C2 沙箱 runner 都要 spawn
//   子进程 + 捕获输出——解码是它们的公共横切点。拆出来让"复用进程
//   管理"不被编码假设绑架（bash 输出 GBK，python 可能输出 UTF-8）。
//
// 为什么不用 chunk.toString()：
//   1. 编码不对：Windows cmd 默认输出 GBK（代码页 936），Node 默认
//      按 UTF-8 解码会乱码（实测 dir 中文全乱）。
//   2. 跨 chunk 半个字符：GBK/UTF-8 都是变长编码，一个汉字可能被
//      切成两块到达。TextDecoder 的 stream 模式保留内部状态，
//      跨块字节正确拼回；toString 每次独立解码会直接断在中间。
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
 * @param encoding 显式指定编码（测试用）；省略时按平台推断——
 *   Windows 的 cmd 生态默认 GBK，其余平台按 UTF-8。
 */
export function createOutputDecoder(encoding?: string): OutputDecoder {
  const resolved =
    encoding ??
    (process.platform === "win32" ? "gbk" : "utf-8");

  const decoder = new TextDecoder(resolved);

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
