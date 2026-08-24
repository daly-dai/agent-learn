// ============================================================
// edit.test.ts —— edit_file（唯一替换语义）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEditTool } from "../edit";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createEditTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createEditTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("edit_file", () => {
  it("唯一 oldText 替换成功并落盘", async () => {
    await tool.execute({
      path: "a.txt",
      oldText: "hello",
      newText: "你好",
    });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("你好 world");
  });

  it("找不到 oldText 抛错", async () => {
    await expect(
      tool.execute({ path: "a.txt", oldText: "不存在", newText: "x" }),
    ).rejects.toThrow(/找不到/);
  });

  it("oldText 出现多处抛错（提示提供更多上下文）", async () => {
    // fixture 里没有出现两处的文本，先写一个真正出现两处的文件
    await writeFile(join(root, "multi.txt"), "deep and deep again", "utf8");
    await expect(
      tool.execute({ path: "multi.txt", oldText: "deep", newText: "x" }),
    ).rejects.toThrow(/唯一/);
  });

  it("空 oldText 抛错", async () => {
    await expect(
      tool.execute({ path: "a.txt", oldText: "", newText: "x" }),
    ).rejects.toThrow(/oldText 不能为空/);
  });

  it("newText 为空 = 删除该段", async () => {
    await tool.execute({
      path: "notes/b.md",
      oldText: "# Title\n",
      newText: "",
    });
    expect(await readFile(join(root, "notes/b.md"), "utf8")).toBe(
      "content line\n",
    );
  });

  it("越界路径抛错", async () => {
    await expect(
      tool.execute({ path: "../x.txt", oldText: "a", newText: "b" }),
    ).rejects.toThrow(/路径越界/);
  });
});
