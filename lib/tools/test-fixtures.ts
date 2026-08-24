// ============================================================
// test-fixtures.ts —— fs 工具测试的共享临时目录（A2 第 3 层）
// ============================================================
// 所有 fs 工具测试共用一个模式：beforeAll 建临时目录当 workspace，
// 写入固定的文件结构；afterAll 清理。集中在这里，避免每个测试文件重复。
//
// 固定结构（每个测试文件独立 mkdtemp，互不污染）：
//   <tmp>/a.txt            "hello world"
//   <tmp>/notes/b.md       "# Title\ncontent line\n"
//   <tmp>/sub/deep.txt     "deep content"
//   <tmp>/.hidden          "hidden"（隐藏文件，listFiles 应跳过）
// ============================================================

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createFixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-learn-test-"));
  await writeFile(join(root, "a.txt"), "hello world", "utf8");
  await mkdir(join(root, "notes"), { recursive: true });
  await writeFile(join(root, "notes", "b.md"), "# Title\ncontent line\n", "utf8");
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "sub", "deep.txt"), "deep content", "utf8");
  await writeFile(join(root, ".hidden"), "hidden", "utf8");
  return root;
}

export async function destroyFixtureWorkspace(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
