// ============================================================
// 工作空间注册表（C51 / C50）
// ============================================================
// 用例分三层，和实现的三段对应：
//   ① 纯函数：路径栅栏 / 默认名 / 校验 / 解析 / bootstrap
//   ② 碰盘：增 / 改名 / 删 / 并发写
//   ③ 失败语义：坏文件必须**大声报错**（静默重建 = 悄悄删光工作空间）

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceError,
  bootstrapRecords,
  bootstrapWorkspaces,
  createWorkspace,
  defaultTitle,
  deleteWorkspace,
  isFullyQualifiedPath,
  loadWorkspaces,
  parseRegistry,
  renameWorkspace,
  serializeRegistry,
  validateTitle,
  type Workspace,
} from "./index";

const tempHomes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "statve-workspace-"));
  tempHomes.push(home);
  return home;
}

/** 造一个"已存在的文件夹"——注册表只登记真实存在的目录 */
async function makeFolder(home: string, name: string): Promise<string> {
  const folder = join(home, name);
  await mkdir(folder, { recursive: true });
  return folder;
}

afterEach(() => {
  tempHomes.length = 0;
});

function record(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "id-1",
    path: "E:\\proj-a",
    title: "proj-a",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("isFullyQualifiedPath —— 完全限定栅栏", () => {
  it("Windows：盘符与 UNC 通过", () => {
    expect(isFullyQualifiedPath("C:\\proj", "win32")).toBe(true);
    expect(isFullyQualifiedPath("C:/proj", "win32")).toBe(true);
    expect(isFullyQualifiedPath("\\\\server\\share\\proj", "win32")).toBe(true);
  });

  it("Windows：无盘符有根形态拒绝（它会解析到当前盘）", () => {
    expect(isFullyQualifiedPath("\\proj", "win32")).toBe(false);
    expect(isFullyQualifiedPath("/proj", "win32")).toBe(false);
    expect(isFullyQualifiedPath("proj\\a", "win32")).toBe(false);
  });

  it("POSIX：绝对路径通过，相对路径拒绝", () => {
    expect(isFullyQualifiedPath("/home/me/proj", "linux")).toBe(true);
    expect(isFullyQualifiedPath("proj/a", "linux")).toBe(false);
  });
});

describe("defaultTitle —— 默认显示名", () => {
  it("取最后一段", () => {
    expect(defaultTitle("E:\\work\\proj-a", "win32")).toBe("proj-a");
    expect(defaultTitle("/home/me/proj-b", "linux")).toBe("proj-b");
  });

  it("盘符根退回盘符本身（不会得到空名字）", () => {
    expect(defaultTitle("C:\\", "win32")).toBe("C:\\");
  });
});

describe("validateTitle —— 显示名校验", () => {
  it("去首尾空白", () => {
    expect(validateTitle("  我的项目  ")).toBe("我的项目");
  });

  it("空名与超长名拒绝", () => {
    expect(() => validateTitle("   ")).toThrow(WorkspaceError);
    expect(() => validateTitle("字".repeat(61))).toThrow(/不能超过 60 字/);
  });
});

describe("parseRegistry —— 坏文件必须大声报错", () => {
  it("合法 JSON 读得回来", () => {
    expect(parseRegistry(serializeRegistry([record()]))).toEqual([record()]);
  });

  it("坏 JSON / 版本不对 / 缺 workspaces / 记录缺字段 → corrupt", () => {
    const corrupt = [
      "{ not json",
      JSON.stringify({ version: 99, workspaces: [] }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, workspaces: [{ id: "x" }] }),
    ];
    for (const raw of corrupt) {
      expect(() => parseRegistry(raw)).toThrow(WorkspaceError);
      try {
        parseRegistry(raw);
      } catch (error) {
        expect((error as WorkspaceError).code).toBe("corrupt");
      }
    }
  });
});

describe("bootstrapRecords —— 从会话补登记", () => {
  it("只补没登记过的，跳过空 cwd", () => {
    const existing = record({ path: "E:\\proj-a", title: "改过的名字" });
    const next = bootstrapRecords(
      [existing],
      ["E:\\proj-a", "E:\\proj-b", ""],
      "2026-11-11T01:00:00.000Z",
    );

    expect(next).toHaveLength(2);
    expect(next[0].title).toBe("改过的名字"); // 已有记录不动
    expect(next[1].path).toBe("E:\\proj-b");
    expect(next[1].title).toBe("proj-b");
  });
});

describe("碰盘：增 / 改名 / 删", () => {
  it("没有文件时是空表（不是错误）", async () => {
    const home = await makeHome();
    await expect(loadWorkspaces(home)).resolves.toEqual([]);
  });

  it("新增：落盘 + 默认名 = 末段 + path 是 canonical", async () => {
    const home = await makeHome();
    const folder = await makeFolder(home, "proj-a");

    const created = await createWorkspace(home, { path: folder });

    expect(created.title).toBe("proj-a");
    expect(created.path).toBe(folder);
    const raw = JSON.parse(await readFile(join(home, "workspaces.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.workspaces).toHaveLength(1);
  });

  it("同一个文件夹登记两次 → duplicate", async () => {
    const home = await makeHome();
    const folder = await makeFolder(home, "proj-a");
    await createWorkspace(home, { path: folder });

    await expect(createWorkspace(home, { path: folder })).rejects.toMatchObject({
      code: "duplicate",
    });
  });

  it("相对路径 → invalid-path；不存在的目录 → not-a-directory", async () => {
    const home = await makeHome();
    await expect(createWorkspace(home, { path: "relative/x" })).rejects.toMatchObject({
      code: "invalid-path",
    });
    await expect(
      createWorkspace(home, { path: join(home, "no-such-folder") }),
    ).rejects.toMatchObject({ code: "not-a-directory" });
  });

  it("改名只改显示名，path 与 id 不动", async () => {
    const home = await makeHome();
    const folder = await makeFolder(home, "proj-a");
    const created = await createWorkspace(home, { path: folder });

    const renamed = await renameWorkspace(home, { id: created.id, title: "  新名字  " });

    expect(renamed.title).toBe("新名字");
    expect(renamed.path).toBe(created.path);
    expect(renamed.id).toBe(created.id);
  });

  it("改名一个不存在的 id → not-found", async () => {
    const home = await makeHome();
    await expect(renameWorkspace(home, { id: "nope", title: "x" })).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("删除只删记录，并报出会变成未登记的会话数", async () => {
    const home = await makeHome();
    const folder = await makeFolder(home, "proj-a");
    const created = await createWorkspace(home, { path: folder });

    const result = await deleteWorkspace(home, {
      id: created.id,
      sessionCwds: [folder, folder, join(home, "other")],
    });

    expect(result.removed.id).toBe(created.id);
    expect(result.unregisteredSessions).toBe(2);
    await expect(loadWorkspaces(home)).resolves.toEqual([]);
  });

  it("并发新增 5 个：一条都不丢（写队列的证明）", async () => {
    const home = await makeHome();
    const folders: string[] = [];
    for (let index = 0; index < 5; index++) {
      folders.push(await makeFolder(home, `concurrent-${index}`));
    }

    await Promise.all(folders.map((folder) => createWorkspace(home, { path: folder })));

    await expect(loadWorkspaces(home)).resolves.toHaveLength(5);
  });

  it("文件坏了：load 直接抛 corrupt，不静默给空表", async () => {
    const home = await makeHome();
    await writeFile(join(home, "workspaces.json"), "{ 半截", "utf8");
    await expect(loadWorkspaces(home)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("bootstrap：磁盘上已有的 cwd 补成记录，第二次调用不再重复", async () => {
    const home = await makeHome();
    const folder = await makeFolder(home, "proj-a");

    const first = await bootstrapWorkspaces(home, [folder]);
    const second = await bootstrapWorkspaces(home, [folder]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].path).toBe(folder);
  });
});
