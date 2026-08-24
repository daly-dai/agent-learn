// ============================================================
// grep.test.ts —— grep（正则搜内容）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createGrepTool } from "../grep";
import {
  createFixtureWorkspace,
  destroyFixtureWorkspace,
} from "../test-fixtures";

let root: string;
let tool: ReturnType<typeof createGrepTool>;

beforeAll(async () => {
  root = await createFixtureWorkspace();
  tool = createGrepTool(root);
});

afterAll(async () => {
  await destroyFixtureWorkspace(root);
});

describe("grep", () => {
  it("按内容匹配，返回 路径:行号:匹配行", async () => {
    const result = await tool.execute({ pattern: "content" });
    const content = (result.content[0] as { text: string }).text;
    expect(content).toContain(`${join("notes", "b.md")}:2:`);
    expect(content).toContain(`${join("sub", "deep.txt")}:1:`);
  });

  it("无匹配返回 (无匹配)", async () => {
    const result = await tool.execute({ pattern: "zzz-not-exist" });
    expect(result.details).toMatchObject({ count: 0, truncated: false });
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toBe("(无匹配)");
    }
  });

  it("无效正则抛错（输入问题回给模型）", async () => {
    await expect(tool.execute({ pattern: "(" })).rejects.toThrow(/无效正则/);
  });

  it("maxResults 限制匹配条数并标记 truncated", async () => {
    const result = await tool.execute({ pattern: ".", maxResults: 2 });
    const details = result.details as { count: number; truncated: boolean };
    expect(details.count).toBeLessThanOrEqual(2);
  });

  it("正则按行匹配（^ 锚定行首）", async () => {
    const result = await tool.execute({ pattern: "^#" });
    const content = (result.content[0] as { text: string }).text;
    expect(content).toContain(`${join("notes", "b.md")}:1:`);
  });
});
