// ============================================================
// list.test.ts —— list_files（fs 工具层，临时目录 fixture）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createListTool } from "../list";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createListTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createListTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("list_files", () => {
  it("列出全部文件：相对路径、目录带 /、字母序", async () => {
    const result = await tool.execute({});
    expect(result.details).toMatchObject({
      entries: [
        "a.txt",
        "notes/",
        join("notes", "b.md"),
        "sub/",
        join("sub", "deep.txt"),
      ],
    });
  });

  it("跳过隐藏项（.hidden 不出现）", async () => {
    const result = await tool.execute({});
    const entries = (result.details as { entries: string[] }).entries;
    expect(entries.some((e) => e.includes(".hidden"))).toBe(false);
  });

  it("指定子目录列出其内容", async () => {
    const result = await tool.execute({ path: "sub" });
    expect(result.details).toMatchObject({
      entries: [join("sub", "deep.txt")],
    });
  });

  it("空目录返回 (空目录)", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { join: pathJoin } = await import("node:path");
    await mkdir(pathJoin(root, "empty-dir"), { recursive: true });
    const result = await tool.execute({ path: "empty-dir" });
    expect(result.content[0].type).toBe("text");
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toBe("(空目录)");
    }
  });
});
