// ============================================================
// 工作空间注册表（C51 / C50）
// ============================================================
// 一条记录 = 一个「用户选定的文件夹」：稳定 id + canonical 路径 + 显示名。
// 它**不存会话** —— 会话列表永远从 sessions/ 目录扫出来，会话的归属靠
// 会话头里的 `cwd` 与本表的 path 比对（少一个会漂的字段）。
//
// 三条不变式（都会有用例兜着）：
//   ① 同一个文件夹只能登记一次（canonical 字符串相等 = 同一个）；
//   ② 写入串行（模块内一条队列）+ 临时文件 rename（崩溃不留半截 json）；
//   ③ 文件坏了**大声报错**，不静默重建 —— 静默重建等于把所有工作空间删了还装作正常。
//
// 分三段：纯函数（可单测）/ 序列化 / 碰盘。三段住一个文件是刻意的：
// 它们是同一件事的三个面，拆开会让人在三个文件之间来回找。
// ============================================================

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, parse, win32 } from "node:path";

/** 一条工作空间记录。`path` 是 canonical（软链、尾斜杠、`..` 全解析后的绝对路径） */
export type Workspace = {
  id: string;
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceErrorCode =
  | "corrupt"
  | "not-found"
  | "duplicate"
  | "invalid-title"
  | "invalid-path"
  | "not-a-directory";

/** 注册表的唯一错误类型：调用方用一个 switch 把 code 翻成 HTTP 码 */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

const REGISTRY_FILE = "workspaces.json";
const CURRENT_VERSION = 1;
const MAX_TITLE_LENGTH = 60;

// ------------------------------------------------------------
// 纯函数
// ------------------------------------------------------------

/**
 * 路径必须是"完全限定"的：不留任何交给进程状态去解释的余地。
 * Windows 上只认盘符限定（`C:\…`）或完整 UNC（`\\server\share…`）——
 * `isAbsolute` 会放行 `\foo` / `/foo`，但它们实际解析到**当前盘**。
 */
export function isFullyQualifiedPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return isAbsolute(path);
  const root = win32.parse(path).root;
  return win32.isAbsolute(path) && root !== "\\" && root !== "/";
}

/** 默认显示名 = 路径最后一段；盘符根（`C:\`）退回盘符本身 */
export function defaultTitle(path: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === "win32" ? win32 : { basename, parse };
  return pathApi.basename(path) || pathApi.parse(path).root;
}

/** 显示名：去首尾空白；空或超长都直接拒绝（名字要能显示在侧栏一行里） */
export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new WorkspaceError("invalid-title", "工作空间名字不能为空");
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new WorkspaceError("invalid-title", `工作空间名字不能超过 ${MAX_TITLE_LENGTH} 字`);
  }
  return trimmed;
}

/** 读文件内容 → 记录数组。结构不对就报 corrupt（不猜、不修） */
export function parseRegistry(raw: string): Workspace[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new WorkspaceError("corrupt", "工作空间注册表不是合法 JSON");
  }
  if (typeof data !== "object" || data === null) {
    throw new WorkspaceError("corrupt", "工作空间注册表结构不对");
  }
  const { version, workspaces } = data as { version?: unknown; workspaces?: unknown };
  if (version !== CURRENT_VERSION) {
    throw new WorkspaceError("corrupt", `工作空间注册表版本不支持：${String(version)}`);
  }
  if (!Array.isArray(workspaces)) {
    throw new WorkspaceError("corrupt", "工作空间注册表缺少 workspaces 数组");
  }
  return workspaces.map(readRecord);
}

/** 记录数组 → 文件内容（缩进 2 空格：这是给人看的文件） */
export function serializeRegistry(workspaces: Workspace[]): string {
  return `${JSON.stringify({ version: CURRENT_VERSION, workspaces }, null, 2)}\n`;
}

/**
 * bootstrap：把"磁盘上有会话、但没登记过的工作目录"补成记录。
 * 这是注册表**可重建**的依据（DSH 同款）—— 丢了最多丢手工改过的名字。
 */
export function bootstrapRecords(
  records: Workspace[],
  sessionCwds: string[],
  now: string,
): Workspace[] {
  const known = new Set(records.map((record) => record.path));
  const added: Workspace[] = [];
  for (const cwd of sessionCwds) {
    if (cwd.length === 0 || known.has(cwd)) continue;
    known.add(cwd);
    added.push({ id: randomUUID(), path: cwd, title: defaultTitle(cwd), createdAt: now, updatedAt: now });
  }
  return [...records, ...added];
}

// ------------------------------------------------------------
// 碰盘：读 / 写（写入串行 + 原子替换）
// ------------------------------------------------------------

/**
 * 模块级写队列：所有"读-改-写"排成一列。
 * 不做队列的话，两个并发请求各自读到旧表、各自写回 ⇒ **后写的覆盖先写的**，
 * 丢一次改名/删除而且不报错。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);
  return next;
}

function registryPath(home: string): string {
  return join(home, REGISTRY_FILE);
}

/** 读注册表。文件不存在 = 还没有任何工作空间（不是错误） */
export async function loadWorkspaces(home: string): Promise<Workspace[]> {
  const raw = await readFile(registryPath(home), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return raw === null ? [] : parseRegistry(raw);
}

/** 新增。同一个文件夹（canonical 相等）只能有一条 */
export async function createWorkspace(
  home: string,
  input: { path: string; title?: string },
): Promise<Workspace> {
  const path = await canonicalDirectory(input.path);
  return serial(async () => {
    const records = await loadWorkspaces(home);
    const existing = records.find((record) => record.path === path);
    if (existing) {
      throw new WorkspaceError("duplicate", `这个文件夹已经是工作空间：${path}`);
    }
    const now = new Date().toISOString();
    const created: Workspace = {
      id: randomUUID(),
      path,
      title: input.title === undefined ? defaultTitle(path) : validateTitle(input.title),
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkspaces(home, [...records, created]);
    return created;
  });
}

/** 改名：**只改显示名**，磁盘上的文件夹一个字节都不动 */
export async function renameWorkspace(
  home: string,
  input: { id: string; title: string },
): Promise<Workspace> {
  const title = validateTitle(input.title);
  return serial(async () => {
    const records = await loadWorkspaces(home);
    const index = records.findIndex((record) => record.id === input.id);
    if (index < 0) throw new WorkspaceError("not-found", "工作空间不存在");
    const renamed: Workspace = { ...records[index], title, updatedAt: new Date().toISOString() };
    records[index] = renamed;
    await saveWorkspaces(home, records);
    return renamed;
  });
}

/**
 * 删除记录本身。
 *
 * ⚠️ 2026-11-11（用户定："所有会话必须有对应的工作空间"）：这个函数**只删记录**，
 * 它名下的会话由**调用方**一并删掉（`SessionManager.deleteSessionsWithCwd`）。
 * 为什么不让本模块去删会话：注册表不该知道会话存在哪（那是 `lib/session/paths`
 * 的事），两个模块各管各的落盘结构。
 *
 * ⚠️ 顺序也很重要：**先删会话、再删记录**。反过来的话，下一次 bootstrap 会发现
 * "盘上还有会话、表里没有记录"，把刚删掉的记录又补回来 —— 删了等于没删。
 */
export async function deleteWorkspace(
  home: string,
  input: { id: string },
): Promise<{ removed: Workspace }> {
  return serial(async () => {
    const records = await loadWorkspaces(home);
    const removed = records.find((record) => record.id === input.id);
    if (!removed) throw new WorkspaceError("not-found", "工作空间不存在");
    await saveWorkspaces(
      home,
      records.filter((record) => record.id !== input.id),
    );
    return { removed };
  });
}

/** 启动时补登记：磁盘上有会话、表里没有的工作目录，补成记录 */
export async function bootstrapWorkspaces(
  home: string,
  sessionCwds: string[],
): Promise<Workspace[]> {
  return serial(async () => {
    const records = await loadWorkspaces(home);
    const next = bootstrapRecords(records, sessionCwds, new Date().toISOString());
    if (next.length !== records.length) await saveWorkspaces(home, next);
    return next;
  });
}

// ------------------------------------------------------------
// 内部
// ------------------------------------------------------------

/** 路径 → canonical 绝对路径；不存在 / 不是目录 / 不是完全限定，各报各的错 */
async function canonicalDirectory(path: string): Promise<string> {
  if (!isFullyQualifiedPath(path)) {
    throw new WorkspaceError("invalid-path", `路径必须是完全限定的绝对路径：${path}`);
  }
  const canonical = await realpath(path).catch(() => {
    throw new WorkspaceError("not-a-directory", `路径不存在：${path}`);
  });
  const info = await stat(canonical).catch(() => {
    throw new WorkspaceError("not-a-directory", `路径不存在：${path}`);
  });
  if (!info.isDirectory()) {
    throw new WorkspaceError("not-a-directory", `不是文件夹：${path}`);
  }
  return canonical;
}

async function saveWorkspaces(home: string, records: Workspace[]): Promise<void> {
  await mkdir(home, { recursive: true });
  const target = registryPath(home);
  // 先写同目录临时文件再 rename：进程被杀在中途时，读到的要么是旧表、要么是新表
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, serializeRegistry(records), "utf8");
  await rename(temporary, target);
}

function readRecord(value: unknown): Workspace {
  if (typeof value !== "object" || value === null) {
    throw new WorkspaceError("corrupt", "工作空间记录不是对象");
  }
  const record = value as Partial<Workspace>;
  const fields: Array<keyof Workspace> = ["id", "path", "title", "createdAt", "updatedAt"];
  for (const field of fields) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new WorkspaceError("corrupt", `工作空间记录缺字段：${field}`);
    }
  }
  return record as Workspace;
}
