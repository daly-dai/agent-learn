// ============================================================
// process-output.test.ts —— 子进程输出解码器（2026-08-25）
// ============================================================
// 背景：Windows cmd 输出 GBK（代码页 936），Node 默认按 UTF-8 解码
// 会乱码（实测 dir 中文全乱，chcp 65001 对内建命令写管道不可靠）。
// 本模块用 TextDecoder 按平台解码，stream 模式处理"半个汉字分两次到达"。
// ============================================================

import { describe, expect, it } from "vitest";
import { createOutputDecoder } from "./process-output";

/** "异步机制演示" 的 GBK 字节（对照乱码样本里 D2EC B2BD BBFAD6C6 D1DD CABE） */
const GBK_YI_BU = Buffer.from([0xd2, 0xec, 0xb2, 0xbd]); // 异步
const GBK_QUAN = Buffer.from([0xc8, 0xab]); // 全（凑一个 2 字节字符）

describe("createOutputDecoder —— 按编码解码子进程输出", () => {
  it("GBK 字节 → 中文（显式指定 gbk）", () => {
    const dec = createOutputDecoder("gbk");
    expect(dec.decode(GBK_YI_BU)).toBe("异步");
    expect(dec.flush()).toBe("");
  });

  it("UTF-8 字节 → 中文（显式指定 utf-8，模拟非 Windows 平台）", () => {
    const dec = createOutputDecoder("utf-8");
    expect(dec.decode(Buffer.from("异步", "utf8"))).toBe("异步");
  });

  it("跨 chunk 的半个汉字：分两次到达仍正确拼接（stream 模式）", () => {
    const dec = createOutputDecoder("gbk");
    // 真正拆法：把"异"的 2 个 GBK 字节 [D2 EC] 切成两块到达
    const first = dec.decode(Buffer.from([0xd2]));
    expect(first).toBe(""); // 只收到 1 字节，还差 1 个，不急着吐
    const second = dec.decode(Buffer.from([0xec, 0xb2, 0xbd]));
    expect(second).toBe("异步"); // 补全"异"后，连同"步"一起吐出
    expect(dec.flush()).toBe("");
  });

  it("flush 吐出结尾残留的半个字符", () => {
    const dec = createOutputDecoder("gbk");
    // 只给一个不完整的 GBK 字节，decode 不吐，flush 时吐出
    expect(dec.decode(Buffer.from([0xd2]))).toBe("");
    const tail = dec.flush();
    // 不完整字节：TextDecoder 非 fatal 模式会替换成 U+FFFD
    expect(tail.length).toBeGreaterThan(0);
  });

  it("省略 encoding 时按平台推断（Windows → gbk，否则 utf-8）", () => {
    const dec = createOutputDecoder();
    if (process.platform === "win32") {
      expect(dec.decode(GBK_YI_BU)).toBe("异步");
    } else {
      expect(dec.decode(Buffer.from("异步", "utf8"))).toBe("异步");
    }
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
