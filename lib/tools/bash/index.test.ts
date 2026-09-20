// ============================================================
// bash 工具定义 —— 给模型看的说明书与规矩（C36 T1）
// ============================================================
// 为什么这个文件测的是"文本"而不是行为：T1 的交付物**就是文本**。
// 背景是一条真实会话记录（C36 详案第二节）：模型写了
//   $_.Line.Substring(0,[Math]::Min(120,$_.Line.Length))
// 18 个文件全部报错、退出码 0、工具回"成功"——而我们早就知道本机
// PowerShell 可能被压进受限语言模式（那三条禁令原先只写在
// bash-runner/index.ts 的代码注释里，**模型看不见**）。
//
// 所以这里守的是"知识有没有挂在模型看得见的那一面"：
//   - 住 description = 随请求发出去的 tools 字段（工具**是什么**）
//   - 住 guidelines = 系统提示词（**何时用、怎么用**）
// 断言按"这条知识必须在场"写，不按行文写 —— 换个说法不该变红。
// ============================================================

import { describe, expect, it } from "vitest";
import { cleanBashOutput, createBashTool } from ".";
import {
  REAL_PWSH_MESSAGE,
  REAL_PWSH_STDERR,
} from "../../process-output/test-fixtures";

/** 复核夹具：工厂只捕获工作区根（T1 的断言不碰它），取当前目录即可 */
const tool = createBashTool(process.cwd());
/** 两条规矩合成一段文本再断言：拆成几条是排版，不该被测试锁死 */
const guidelines = (tool.guidelines ?? []).join("\n");

describe("bash 的 guidelines（规矩住工具文件里，C34 归属规则）", () => {
  it("受限语言模式的禁令挂在模型看得见的那一面", () => {
    // 这三样是 2026-09-17 双版本探针实测的结论（详案第三节）：
    // 被禁的是静态方法调用与类型创建，不是所有方法调用。
    expect(guidelines).toMatch(/受限语言模式/);
    expect(guidelines).toMatch(/静态方法/);
    expect(guidelines).toMatch(/类型创建/);
  });

  it("给出可执行的替代做法与自查手段（不只说『别用』）", () => {
    // 只说禁令 = 模型知道不能干什么，却不知道该怎么写。
    expect(guidelines).toMatch(/-gt/); // 比较运算符替代 [Math]::Min/Max
    expect(guidelines).toMatch(/LanguageMode/); // 运行时自查当前模式
  });

  it("说明返回的是 stdout 与 stderr 合并后的文本", () => {
    expect(guidelines).toMatch(/合并/);
  });
});

describe("bash 的 description（工具是什么，随 tools 字段发给模型）", () => {
  it("也写明返回值是合并后的文本", () => {
    // 与 guidelines 那条**不是同一句**：这里答"返回什么形状"，
    // guidelines 答"因此该怎么读它"。C34 禁的是同一句话两个家。
    expect(tool.description).toMatch(/合并/);
  });

  it("原有内容一条不少（Windows 环境的既有指引不许静默丢）", () => {
    expect(tool.description).toMatch(/PowerShell/);
    expect(tool.description).toMatch(/确认/); // 执行前弹框
  });
});

// ============================================================
// 输出的"解人话"（C36 T2）
// ============================================================
// 这里测的是**判据**：什么时候该把 CLIXML 换成人话、什么时候一个字都不许动。
// 为什么这个判据值钱：CLIXML 样文**我们自己的文档里就有**
// （`doc/plan/phase-4-bash.md` 第二节抄着那段原文），模型一条 `Get-Content` 就会
// 把它打到 **stdout** 上 —— 若按"合并输出里出现 `#< CLIXML`"判定，
// 我们会把一份**正常读取的文档**当成报错并改写它。所以只认 **stderr**。

describe("cleanBashOutput —— 只信 stderr，stdout 里的同形文本是内容", () => {
  it("stderr 真有 CLIXML → 机器话摘掉、换成人话摘要", () => {
    const text = cleanBashOutput(REAL_PWSH_STDERR, REAL_PWSH_STDERR);
    expect(text).toContain(`[pwsh 报错 ×20]`);
    expect(text).toContain(REAL_PWSH_MESSAGE);
    expect(text).not.toContain("#< CLIXML");
  });

  it("⭐ stdout 里出现同形文本、stderr 干净 → 原样返回（不是报错）", () => {
    // 真实场景：模型 `Get-Content doc/plan/phase-4-bash.md`（那段样文就抄在里面）
    const dumped = `…正文…\n${REAL_PWSH_STDERR}\n…正文…`;
    expect(cleanBashOutput(dumped, "")).toBe(dumped);
  });

  it("普通输出 + 空 stderr → 一个字都不动", () => {
    const plain = "review-lib.diff : 3682\nreview-app.diff : 2860\n";
    expect(cleanBashOutput(plain, "")).toBe(plain);
  });

  it("正文与报错混在一起：正文留下、报错变人话、顺序不变", () => {
    const text = cleanBashOutput(
      `开始跑\n${REAL_PWSH_STDERR}\n跑完了\n`,
      REAL_PWSH_STDERR,
    );
    expect(text).toContain("开始跑");
    expect(text).toContain("跑完了");
    expect(text).toContain(`[pwsh 报错 ×20]`);
    expect(text.indexOf("开始跑")).toBeLessThan(text.indexOf("[pwsh 报错"));
  });
});
