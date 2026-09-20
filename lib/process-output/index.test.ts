// ============================================================
// process-output.test.ts —— 子进程输出解码器（2026-08-25）
// ============================================================
// 背景：cmd 生态输出编码天生混合（GBK 报错 + UTF-8 文件内容），接收端猜
// 一个固定编码做不到全对。定稿：输出端统一（bash-runner 用 pwsh + preamble
// 双 pin 成 UTF-8），接收端固定 UTF-8 解。本模块验证 TextDecoder stream
// 模式的跨块拼接 + 两个实例状态隔离。
// ============================================================

import { describe, expect, it } from "vitest";
import { createOutputDecoder, readPwshErrors, stripPwshClixml } from "./index";
import {
  REAL_PWSH_ERROR_ENTRY,
  REAL_PWSH_MESSAGE,
  REAL_PWSH_STDERR,
  SECOND_PWSH_ERROR_ENTRY,
} from "./test-fixtures";

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

// ============================================================
// pwsh 的报错信封：CLIXML（C36 T2）
// ============================================================
// 背景（详案 C36 第二节）：pwsh 的报错走管道会被序列化成 CLIXML，
// 里面还套着 ANSI 色码与 `_xHHHH_` 转义。我们**收下了、没解、也没看** ——
// 于是"18 个文件全报错"在模型眼里是「成功」，在界面上是一坨看不懂的 XML。
//
// 夹具全部来自真管道（见 `test-fixtures.ts` 头部），不手编。

describe("readPwshErrors —— 把 CLIXML 解成人话", () => {
  it("真样本（同一条报错 ×20）→ 计数 20、去重后只剩一句", () => {
    const read = readPwshErrors(REAL_PWSH_STDERR);
    expect(read?.count).toBe(20);
    expect(read?.messages).toEqual([REAL_PWSH_MESSAGE]);
  });

  it("摘要形如「[pwsh 报错 ×20] + 人话」—— ×20 才是信息", () => {
    expect(readPwshErrors(REAL_PWSH_STDERR)?.summary).toBe(
      `[pwsh 报错 ×20]\n${REAL_PWSH_MESSAGE}`,
    );
  });

  it("两种报错混在一起：计数不去重、人话按首次出现顺序", () => {
    // 真样本的错 + 另一条真实报错，交错出现（`_xHHHH_`/ANSI 的解法对两条都生效）
    const text =
      `#< CLIXML\n<Objs Version="1.1.0.1">` +
      `${REAL_PWSH_ERROR_ENTRY}${SECOND_PWSH_ERROR_ENTRY}${SECOND_PWSH_ERROR_ENTRY}${REAL_PWSH_ERROR_ENTRY}` +
      `</Objs>`;
    const read = readPwshErrors(text);
    expect(read?.count).toBe(4);
    expect(read?.messages).toEqual([
      REAL_PWSH_MESSAGE,
      "CannotCreateTypeConstrainedLanguage",
    ]);
  });

  it("不认得的输入 → null（不吞信息：调用方照原样用）", () => {
    // 真样本的同一次会话里，*另一个* bash 调用的结果就是这种普通文本
    expect(readPwshErrors("review-lib.diff : 3682\nreview-app.diff : 2860\n")).toBeNull();
    expect(readPwshErrors("")).toBeNull();
  });

  it("有 CLIXML 信封但一条 Error 都没有 → null（不编造报错）", () => {
    const text =
      '#< CLIXML\n<Objs Version="1.1.0.1"><S S="Progress">_x000D__x000A_</S></Objs>';
    expect(readPwshErrors(text)).toBeNull();
  });
});

describe("stripPwshClixml —— 从输出里摘掉机器话（正文原样留）", () => {
  it("真样本整段摘掉 → 空", () => {
    expect(stripPwshClixml(REAL_PWSH_STDERR).trim()).toBe("");
  });

  it("正文夹着 CLIXML：两段正文都在、顺序不变", () => {
    const stripped = stripPwshClixml(`前面的正文\n${REAL_PWSH_STDERR}\n后面的正文`);
    expect(stripped).toContain("前面的正文");
    expect(stripped).toContain("后面的正文");
    expect(stripped).not.toContain("#< CLIXML");
    expect(stripped).not.toContain('<S S="Error">');
    expect(stripped.indexOf("前面的正文")).toBeLessThan(stripped.indexOf("后面的正文"));
  });
});
