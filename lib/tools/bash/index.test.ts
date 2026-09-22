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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bashStatusNote,
  cleanBashOutput,
  createBashTool,
  selfMergedStreamNote,
} from ".";
import { BashRunner } from "./bash-runner";
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

  it("⭐ 反向的边界也挂着：自己写 2>&1 会让报错消失（2026-09-21）", () => {
    // 上面两条教"怎么读"，这条教"别把报错弄丢"——它们是**相反方向**的知识，
    // 所以必须同住在模型看得见的那一面（规则住工具文件，C34）。
    expect(guidelines).toMatch(/2>&1/);
    expect(guidelines).toMatch(/消失|丢弃/);
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
    const { text } = cleanBashOutput(REAL_PWSH_STDERR, REAL_PWSH_STDERR);
    expect(text).toContain(`[pwsh 报错 ×20]`);
    expect(text).toContain(REAL_PWSH_MESSAGE);
    expect(text).not.toContain("#< CLIXML");
  });

  it("⭐ stdout 里出现同形文本、stderr 干净 → 原样返回（不是报错）", () => {
    // 真实场景：模型 `Get-Content doc/plan/phase-4-bash.md`（那段样文就抄在里面）
    const dumped = `…正文…\n${REAL_PWSH_STDERR}\n…正文…`;
    expect(cleanBashOutput(dumped, "").text).toBe(dumped);
  });

  it("普通输出 + 空 stderr → 一个字都不动", () => {
    const plain = "review-lib.diff : 3682\nreview-app.diff : 2860\n";
    expect(cleanBashOutput(plain, "").text).toBe(plain);
  });

  it("正文与报错混在一起：正文留下、报错变人话、顺序不变", () => {
    const { text } = cleanBashOutput(
      `开始跑\n${REAL_PWSH_STDERR}\n跑完了\n`,
      REAL_PWSH_STDERR,
    );
    expect(text).toContain("开始跑");
    expect(text).toContain("跑完了");
    expect(text).toContain(`[pwsh 报错 ×20]`);
    expect(text.indexOf("开始跑")).toBeLessThan(text.indexOf("[pwsh 报错"));
  });

  it("顺带把报错条数交出来（T3 的判据要用，别让它再解一遍）", () => {
    expect(
      cleanBashOutput(REAL_PWSH_STDERR, REAL_PWSH_STDERR).pwshErrorCount,
    ).toBe(20);
    expect(cleanBashOutput("普通输出", "").pwshErrorCount).toBe(0);
  });
});

// ============================================================
// 判据：退出码 + stderr 报错 → 尾部标记（C36 T3，吸收 B19）
// ============================================================
// 三个断点里最阴的一个（详案第二节①）：**退出码只反映最后一条语句**。
// 真样本里 `ForEach-Object` 自己跑完了（错在它执行的脚本块里）⇒ 整条管道算成功、
// 退出码 0、工具回「成功」—— 而 20 个文件一个都没处理。
//
// **为什么加标记而不是抛错**（抄 DSH 的形状，五家对照见详案第四节结论 3）：
//   ① 抛错会误伤"退出码 1 但完全正常"的 `grep 无匹配`
//   ② 抛错会改掉模型看到的形状（`isError` 通道），回归面比它修的病大
//   ⇒ 修 ① 是**延长既有的标记机制**，不是换机制。

describe("bashStatusNote —— 尾部标记的四格判据", () => {
  it("退出码 ≠ 0 → 只报退出码（现状不动）", () => {
    expect(
      bashStatusNote({ exitCode: 2, cancelled: false, pwshErrorCount: 0 }),
    ).toBe("\n[命令退出码：2]");
  });

  it("⭐ 退出码 = 0 但 stderr 有报错 → 说清「退出码是 0」（这是新增的那一格）", () => {
    expect(
      bashStatusNote({ exitCode: 0, cancelled: false, pwshErrorCount: 3 }),
    ).toBe("\n[退出码为 0，但 stderr 有 3 条报错]");
  });

  it("退出码 = 0 且 stderr 干净 → 不加任何标记", () => {
    expect(
      bashStatusNote({ exitCode: 0, cancelled: false, pwshErrorCount: 0 }),
    ).toBe("");
  });

  it("被终止 → 终止优先（此时退出码是 null，没有可比的东西）", () => {
    expect(
      bashStatusNote({ exitCode: null, cancelled: true, pwshErrorCount: 2 }),
    ).toBe("\n[命令被终止：超时或用户取消]");
  });

  it("两个信号都有（非 0 且有报错）→ 只报退出码，不叠加两条", () => {
    // 表格第一行「≠ 0 → 现状不动」的含义：避免同一件事说两遍，
    // 而报错正文（×N + 人话）已经在正文里了。
    expect(
      bashStatusNote({ exitCode: 1, cancelled: false, pwshErrorCount: 7 }),
    ).toBe("\n[命令退出码：1]");
  });
});

// ============================================================
// 反方向的边界：命令自己写 `2>&1` ⇒ 报错被丢弃（2026-09-21 复盘当场撞出）
// ============================================================
// 实测（走真实路径 `cmd /c chcp 65001 & pwsh -EncodedCommand`，stdio 形状与
// `BashRunner` 一致 —— 四个探针一步步排出来的，过程见 `doc/plan/phase-4-bash.md`）：
//
//   | 命令                              | stdout | stderr        |
//   | 1..3 | % { Write-Error 'boom' }   | 0      | 350 字节 CLIXML | ← 判据抓得住
//   | 同一句 + 2>&1                      | 0      | **0**         | ← 报错整个消失
//
// 机制：`2>&1` 把错误记录并进**成功流**，成功流写到非控制台的管道时被丢弃。
// 于是"只信 stderr"这条判据在这里**必然失效**。而丢掉的文本**救不回来**（它根本没
// 出来）⇒ 只能防在发生之前，所以这一个提示 + 一条规矩，而不是"检测出来再修"。

describe("selfMergedStreamNote —— 命令自己合并流时给一句提示", () => {
  it("命令里没有合并流 → 一个字都不加（别把正常输出弄噪）", () => {
    expect(selfMergedStreamNote("Get-ChildItem -Recurse")).toBe("");
    expect(selfMergedStreamNote("1..3 | % { Write-Error 'boom' }")).toBe("");
  });

  it("⭐ 写了 2>&1 → 说清「报错会消失、收不回来」", () => {
    const note = selfMergedStreamNote("1..3 | % { Write-Error 'boom' } 2>&1");
    expect(note).toMatch(/2>&1/);
    expect(note).toMatch(/0 字节/); // 实测读数，不是形容词
    expect(note).toMatch(/去掉/); // 给可执行的做法，不只说"你错了"
  });

  it("`*>&1`（所有流并进成功流）同样提示", () => {
    expect(selfMergedStreamNote("do-something *>&1")).toMatch(/2>&1/);
  });

  it("带空格、带重定向目标的写法也认（别指望模型写成标准形态）", () => {
    expect(selfMergedStreamNote("cmd 2> &1")).not.toBe("");
    expect(selfMergedStreamNote("cmd 2>&1 | Select-Object -Last 5")).not.toBe(
      "",
    );
  });

  it("误报是可接受的代价：文本里「写着」这串字符也会提示一句", () => {
    // 只是提示，不改正文、不动 isError —— 比漏报好。
    expect(selfMergedStreamNote('Write-Output "2>&1"')).not.toBe("");
  });
});

// ============================================================
// execute 全流程（B19 的那五条行为，用 spy 替掉真 spawn）
// ============================================================
// 为什么必须替掉执行器：沙箱里 `spawn` 捕获输出会撞 EPERM，**真起进程的用例在本机
// 跑不了**（`app/api/repos/_lib/git` 那五条就是既有的同类失败）。工具本身的逻辑
// 与"谁去执行"无关，所以钉住 `BashRunner.prototype.run` 的返回值，测的是**工具怎么用结果**。

describe("bash execute —— 工具定义的五条既有行为（B19）", () => {
  /** 夹具随每条用例改写；`truncated` 默认 false（没超限就不会截断） */
  let runResult: {
    output: string;
    stderr: string;
    exitCode: number | null;
    cancelled: boolean;
    truncated: boolean;
  };

  beforeEach(() => {
    runResult = {
      output: "",
      stderr: "",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    };
    vi.spyOn(BashRunner.prototype, "run").mockImplementation(
      async () => runResult,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const tool = createBashTool(process.cwd());

  it("空命令 → 抛错，且根本不去起进程", async () => {
    await expect(tool.execute({ command: "   " })).rejects.toThrow(/不能为空/);
    expect(BashRunner.prototype.run).not.toHaveBeenCalled();
  });

  it("被终止 → 正文后面接终止提示", async () => {
    runResult = {
      ...runResult,
      exitCode: null,
      cancelled: true,
      output: "半截输出",
    };
    const result = await tool.execute({ command: "npm install" });
    expect(textOf(result)).toBe("半截输出\n[命令被终止：超时或用户取消]");
  });

  it("退出码非 0 → 正文后面接退出码", async () => {
    runResult = { ...runResult, exitCode: 2, output: "出错说明" };
    expect(textOf(await tool.execute({ command: "x" }))).toBe(
      "出错说明\n[命令退出码：2]",
    );
  });

  it("没有任何输出 → 用占位符，不是空正文", async () => {
    expect(textOf(await tool.execute({ command: "cd ." }))).toBe("(无输出)");
  });

  it("ToolResult 形状：一条 text + details 三个字段（给前端/轨迹/测试用）", async () => {
    runResult = { ...runResult, exitCode: 3, output: "x", truncated: true };
    const result = await tool.execute({ command: "x" });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.details).toEqual({
      exitCode: 3,
      cancelled: false,
      truncated: true,
    });
  });

  it("⭐ 退出码 0 但有 pwsh 报错：正文是人话摘要、尾巴点明「退出码是 0」", async () => {
    // 真样本那条命令的形状：stderr 全是 CLIXML、stdout 空、退出码 0
    runResult = {
      ...runResult,
      output: REAL_PWSH_STDERR,
      stderr: REAL_PWSH_STDERR,
    };
    const body = textOf(await tool.execute({ command: "…" }));
    expect(body).toContain(`[pwsh 报错 ×20]`);
    expect(body).toContain(REAL_PWSH_MESSAGE);
    expect(body).toContain("[退出码为 0，但 stderr 有 20 条报错]");
    expect(body).not.toContain("#< CLIXML");
  });

  it("退出码 0 且 stderr 干净 → 一个字都不加（别把正常输出弄噪）", async () => {
    runResult = { ...runResult, output: "review-lib.diff : 3682\n" };
    expect(textOf(await tool.execute({ command: "x" }))).toBe(
      "review-lib.diff : 3682\n",
    );
  });

  it("⭐ 命令里写了 2>&1 → 正文尾部多一句提示（与退出码标记可叠加）", async () => {
    runResult = { ...runResult, output: "ok\n" };
    const body = textOf(
      await tool.execute({ command: "1..3 | % { Write-Error 'x' } 2>&1" }),
    );
    expect(body).toContain("ok\n");
    expect(body).toContain("[命令里用了 2>&1");
  });
});

/** 取工具结果里的那条文本（content 是联合类型，测试里只需要 text 分支） */
function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const first = result.content[0];
  if (first.type !== "text" || first.text === undefined) {
    throw new Error(`期望一条 text 结果，实际是 ${first.type}`);
  }
  return first.text;
}
