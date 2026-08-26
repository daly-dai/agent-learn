// ============================================================
// process-output.test.ts —— 子进程输出解码器（2026-08-25）
// ============================================================
// 背景：cmd 生态输出编码天生混合（GBK 报错 + UTF-8 文件内容），接收端猜
// 一个固定编码做不到全对。定稿：输出端统一（bash-runner 用 pwsh + preamble
// 双 pin 成 UTF-8），接收端固定 UTF-8 解。本模块验证 TextDecoder stream
// 模式的跨块拼接 + 两个实例状态隔离。
// ============================================================

import { describe, expect, it } from "vitest";
import { createOutputDecoder } from "./process-output";

/** "异步机制演示" 的 GBK 字节（对照乱码样本里 D2EC B2BD BBFAD6C6 D1DD CABE） */
const GBK_YI_BU = Buffer.from([0xd2, 0xec, 0xb2, 0xbd]); // 异步
const GBK_QUAN = Buffer.from([0xc8, 0xab]); // 全（凑一个 2 字节字符）

describe("createOutputDecoder —— 按编码解码子进程输出", () => {
  it("UTF-8 字节 → 中文（默认编码）", () => {
    const dec = createOutputDecoder();
    expect(dec.decode(Buffer.from("中文测试", "utf8"))).toBe("中文测试");
    expect(dec.flush()).toBe("");
  });

  it("GBK 字节 → 中文（显式指定 gbk，供测试/其他编码场景）", () => {
    const dec = createOutputDecoder("gbk");
    expect(dec.decode(GBK_YI_BU)).toBe("异步");
    expect(dec.flush()).toBe("");
  });

  it("跨 chunk 的半个汉字：分两次到达仍正确拼接（stream 模式）", () => {
    const dec = createOutputDecoder();
    // "异" 的 UTF-8 是 3 字节 [E5 BC 82]，切成两块到达
    const first = dec.decode(Buffer.from([0xe5]));
    expect(first).toBe(""); // 只收到 1 字节，还差 2 个，不急着吐
    const second = dec.decode(Buffer.from([0xbc, 0x82, 0xe6, 0xad, 0xa5]));
    expect(second).toBe("异步"); // 补全"异"后，连同"步"一起吐出
    expect(dec.flush()).toBe("");
  });

  it("flush 吐出结尾残留的半个字符", () => {
    const dec = createOutputDecoder();
    // 只给一个不完整的 UTF-8 字节，decode 不吐，flush 时吐出
    expect(dec.decode(Buffer.from([0xe5]))).toBe("");
    const tail = dec.flush();
    // 不完整字节：TextDecoder 非 fatal 模式会替换成 U+FFFD
    expect(tail.length).toBeGreaterThan(0);
  });

  it("省略 encoding 时默认 UTF-8（输出端统一编码，接收端固定 UTF-8）", () => {
    const dec = createOutputDecoder();
    expect(dec.decode(Buffer.from("中文测试", "utf8"))).toBe("中文测试");
  });

  it("两个实例互不干扰（stdout/stderr 各自独立解码）", () => {
    const out = createOutputDecoder("gbk");
    const err = createOutputDecoder("gbk");
    // out 流给半个字节（不吐），err 流给完整字节（立刻吐）——证明状态隔离
    out.decode(Buffer.from([0xd2]));
    expect(err.decode(GBK_QUAN)).toBe("全");
    expect(out.flush().length).toBeGreaterThan(0); // out 的半个字节还在自己手里
  });
});
