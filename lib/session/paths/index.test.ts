// ============================================================
// 会话路径的编码规则（C48 详案 5.1：8 条）
// ============================================================
// 这一层是**唯一**能决定"会话落在哪"的地方，所以用例的重点不是"能跑"，
// 而是三件会让数据静默串到一起的事：
//   ① 工作空间键有损（可能撞）—— 撞了靠会话头 cwd 区分，这里只保证可读；
//   ② 会话目录名**不许撞**；
//   ③ Windows 的特殊名字（设备名 / 结尾点）不许把两个 id 落成同一个目录。

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NO_CWD_PROJECT,
  encodeSegment,
  isValidSessionId,
  projectDir,
  projectKey,
  sessionDir,
  sessionLogPath,
  tracePath,
} from "./index";

describe("projectKey —— 工作空间键（有损、可读）", () => {
  it("Windows 路径 → 盘符与分隔符压成 -", () => {
    expect(projectKey("E:\\work-space\\agent-learn\\workspace")).toBe(
      "--E-work-space-agent-learn-workspace--",
    );
  });

  it("连续分隔符只保留一个 -（// 与 \\ 混着也一样）", () => {
    expect(projectKey("a//\\\\b")).toBe("--a-b--");
  });

  it("根路径的尾部分隔符不会留下 ---", () => {
    expect(projectKey("C:\\")).toBe("--C--");
  });

  it("中文与 emoji 按码元转义成 ~XXXX", () => {
    expect(projectKey("E:\\项")).toBe("--E-~9879--");
    // U+1F600 = D83D DE00（一对代理项，两个码元各转义一次）
    expect(projectKey("E:\\😀")).toBe("--E-~D83D~DE00--");
  });

  it("~ 本身必须转义（它是转义引导符，原样留着就会产生歧义）", () => {
    expect(projectKey("~x")).toBe("--~007Ex--");
  });

  it("超长键截到 251 个码元（外面仍包 --…--）", () => {
    const key = projectKey("a".repeat(400));
    expect(key).toBe(`--${"a".repeat(251)}--`);
  });

  it("全是分隔符时退化成 root，不产生空名字", () => {
    expect(projectKey("\\\\")).toBe("--root--");
  });

  it("空工作目录直接抛错（不允许「不知道在哪」的键）", () => {
    expect(() => projectKey("")).toThrow(/不能为空/);
  });
});

describe("encodeSegment —— 会话目录名（单射、无损）", () => {
  it("合法 id 原样保留（它们只含 [A-Za-z0-9_-]）", () => {
    expect(encodeSegment("s_2026-11-10T02-11-33z_a1b2c3")).toBe(
      "s_2026-11-10T02-11-33z_a1b2c3",
    );
  });

  it("不同输入永远得到不同结果（撞 = 覆盖别人的会话）", () => {
    const inputs = ["a", "a.", "a ", "a~002E", "a_b", "A", "..", "."];
    const outputs = inputs.map(encodeSegment);
    expect(new Set(outputs).size).toBe(inputs.length);
  });

  it("结尾的点会被转义（Windows 会静默吃掉它，导致 a. 与 a 同目录）", () => {
    expect(encodeSegment("a.")).toBe("a~002E");
    expect(encodeSegment("a")).toBe("a");
  });

  it("Windows 设备名会被转义（否则写到设备而不是文件）", () => {
    expect(encodeSegment("con")).toBe("~0063on");
    expect(encodeSegment("CON")).toBe("~0043ON");
    expect(encodeSegment("con.txt")).toBe("~0063on.txt");
    expect(encodeSegment("console")).toBe("console"); // 只有精确的设备名才算
  });

  it(". 与 .. 不能原样当名字", () => {
    expect(encodeSegment(".")).toBe("~002E");
    expect(encodeSegment("..")).toBe("~002E~002E");
  });

  it("空 id 抛错", () => {
    expect(() => encodeSegment("")).toThrow(/不能为空/);
  });
});

describe("目录组合 —— 谁都在这一处拼", () => {
  const root = join("C:", "statve", "sessions");
  const cwd = "E:\\proj-a";
  const id = "s_2026-11-10_a1b2c3";

  it("工作空间目录 = root + 工作空间键", () => {
    expect(projectDir(root, cwd)).toBe(join(root, projectKey(cwd)));
  });

  it("没有 cwd 的坏数据落到 _no-cwd（不猜、不补）", () => {
    expect(projectDir(root, undefined)).toBe(join(root, NO_CWD_PROJECT));
  });

  it("会话目录 = 工作空间目录 + 编码后的 id", () => {
    expect(sessionDir(root, cwd, id)).toBe(
      join(projectDir(root, cwd), encodeSegment(id)),
    );
  });

  it("主日志固定叫 session.jsonl，落在会话目录里", () => {
    expect(sessionLogPath(root, cwd, id)).toBe(
      join(sessionDir(root, cwd, id), "session.jsonl"),
    );
  });

  it("轨迹一个 run 一个文件，落在同一会话目录里", () => {
    expect(tracePath(sessionDir(root, cwd, id), "run-1")).toBe(
      join(sessionDir(root, cwd, id), "trace.run-1.jsonl"),
    );
  });
});

describe("isValidSessionId —— 白名单（id 会拼进路径）", () => {
  it("自家生成的 id 都合法", () => {
    expect(isValidSessionId("s_2026-11-10T02-11-33-123z_a1b2c3")).toBe(true);
  });

  it("路径穿越与带点的名字都不合法", () => {
    expect(isValidSessionId("../x")).toBe(false);
    expect(isValidSessionId("a/b")).toBe(false);
    expect(isValidSessionId("a.b")).toBe(false);
    expect(isValidSessionId("")).toBe(false);
  });
});
