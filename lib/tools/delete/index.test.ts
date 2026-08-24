// ============================================================
// delete.test.ts —— delete_file（不可逆操作）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createDeleteTool } from "../delete";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createDeleteTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createDeleteTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("delete_file", () => {
  it("删除文件后文件不存在", async () => {
    await tool.execute({ path: "a.txt" });
    await expect(stat(join(root, "a.txt"))).rejects.toThrow();
  });

  it("删除不存在的文件抛错", async () => {
    await expect(tool.execute({ path: "no-such.txt" })).rejects.toThrow(
      /文件不存在/,
    );
  });

  it("目标是目录抛错（只删文件）", async () => {
    await expect(tool.execute({ path: "sub" })).rejects.toThrow(/是目录/);
  });

  it("越界路径抛错", async () => {
    await expect(tool.execute({ path: "../x.txt" })).rejects.toThrow(
      /路径越界/,
    );
  });
});
