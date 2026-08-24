// ============================================================
// read.test.ts —— read_file（fs 工具层）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createReadTool } from "../read";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createReadTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createReadTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("read_file", () => {
  it("读取文件内容", async () => {
    const result = await tool.execute({ path: "a.txt" });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "hello world",
    });
  });

  it("嵌套路径读取", async () => {
    const result = await tool.execute({ path: "notes/b.md" });
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toContain("# Title");
    }
  });

  it("超过 1800 字符截断并提示", async () => {
    const long = "x".repeat(2000);
    await writeFile(join(root, "long.txt"), long, "utf8");
    const result = await tool.execute({ path: "long.txt" });
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toContain("[截断");
      expect(result.content[0].text.length).toBeLessThan(2000);
    }
  });

  it("文件不存在抛错", async () => {
    await expect(tool.execute({ path: "no-such.txt" })).rejects.toThrow();
  });

  it("越界路径抛错", async () => {
    await expect(tool.execute({ path: "../outside.txt" })).rejects.toThrow(
      /路径越界/,
    );
  });
});
