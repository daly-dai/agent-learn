// ============================================================
// write-note.test.ts —— write_note（低危特例：只写 notes/）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createWriteNoteTool } from "../write-note";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createWriteNoteTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createWriteNoteTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("write_note", () => {
  it("写入 notes/ 下，内容带换行结尾", async () => {
    const result = await tool.execute({
      fileName: "hello.md",
      content: "hi",
    });
    expect(result.details).toMatchObject({ path: join("notes", "hello.md") });
    expect(await readFile(join(root, "notes", "hello.md"), "utf8")).toBe(
      "hi\n",
    );
  });

  it("文件名里的 / 和 \\ 替换成 -（防路径逃逸第二道防线）", async () => {
    const result = await tool.execute({
      fileName: "../evil.md",
      content: "x",
    });
    // "../evil.md" → "..-evil.md"，仍落在 notes/ 内
    expect(result.details).toMatchObject({ path: join("notes", "..-evil.md") });
  });

  it("默认文件名 note.md", async () => {
    const result = await tool.execute({ content: "no name" });
    expect(result.details).toMatchObject({ path: join("notes", "note.md") });
  });

  it("绝对路径的文件名也被替换掉斜杠，写不进 notes/ 外", async () => {
    // 第二道防线：即使传入绝对路径，/ \ 全被替换成 -，仍是 notes/ 内的文件名
    const result = await tool.execute({
      fileName: "C:/tmp/evil.md",
      content: "x",
    });
    expect(result.details).toMatchObject({
      path: join("notes", "C:-tmp-evil.md"),
    });
  });
});
