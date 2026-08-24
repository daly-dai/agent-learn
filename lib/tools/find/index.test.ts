// ============================================================
// find.test.ts —— find（文件名通配搜索）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createFindTool } from "../find";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createFindTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createFindTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("find", () => {
  it("*.md 通配命中 notes/b.md", async () => {
    const result = await tool.execute({ pattern: "*.md" });
    expect(result.details).toMatchObject({ hits: [join("notes", "b.md")] });
  });

  it("* 通配命中全部文件", async () => {
    const result = await tool.execute({ pattern: "*" });
    const hits = (result.details as { hits: string[] }).hits;
    expect(hits).toContain("a.txt");
    expect(hits).toContain(join("notes", "b.md"));
    expect(hits).toContain(join("sub", "deep.txt"));
  });

  it("无匹配返回 (无匹配)", async () => {
    const result = await tool.execute({ pattern: "*.xyz" });
    expect(result.details).toMatchObject({ hits: [] });
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toBe("(无匹配)");
    }
  });

  it("只匹配文件名不匹配目录（目录带 / 后缀不会命中）", async () => {
    const result = await tool.execute({ pattern: "sub" });
    const hits = (result.details as { hits: string[] }).hits;
    // 目录项是 "sub/"（带斜杠），已被过滤；文件命中才返回
    expect(hits).toEqual([]);
  });

  it("越界路径抛错", async () => {
    await expect(
      tool.execute({ pattern: "*.md", path: "../x" }),
    ).rejects.toThrow(/路径越界/);
  });
});
