// ============================================================
// write.test.ts —— write_file（fs 工具层）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createWriteTool } from "../write";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createWriteTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createWriteTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("write_file", () => {
  it("写新文件（自动建父目录）", async () => {
    const result = await tool.execute({
      path: "new-dir/fresh.txt",
      content: "fresh",
    });
    expect(result.details).toMatchObject({
      path: join("new-dir", "fresh.txt"),
    });
    expect(await readFile(join(root, "new-dir", "fresh.txt"), "utf8")).toBe(
      "fresh",
    );
  });

  it("覆盖已存在文件", async () => {
    await tool.execute({ path: "a.txt", content: "overwritten" });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("overwritten");
  });

  it("目标是已存在目录时报错", async () => {
    await expect(tool.execute({ path: "sub", content: "x" })).rejects.toThrow(
      /是一个目录/,
    );
  });

  it("越界路径抛错", async () => {
    await expect(
      tool.execute({ path: "../escape.txt", content: "x" }),
    ).rejects.toThrow(/路径越界/);
  });

  it("写成功后文件确实存在", async () => {
    await tool.execute({ path: "exists.txt", content: "ok" });
    const info = await stat(join(root, "exists.txt"));
    expect(info.isFile()).toBe(true);
  });
});
