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
