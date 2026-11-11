// ============================================================
// 目录浏览（C6）—— 只给人用，**模型没有这个工具**
// ============================================================
// 为什么它不在 lib/：这不是 agent 内核能力，是"人挑一个文件夹当工作空间"的
// 产品界面（AGENTS 第 11.7 条：业务模块放 `app/api/<模块>/_lib/`）。真正约束
// 模型的是围栏 + 审批（见 `lib/tools/path-utils` 与越界审批），不是这里。
//
// 三条硬规则（每条都对应一个真实的坑，见详案 4.7）：
//   1. **只收完全限定路径**（`C:\x` / UNC）。`\foo`、`/foo`、`a\b` 一律拒 ——
//      `isAbsolute("\foo")` 在 Windows 上是 true，但它会**解析到当前盘**，
//      结果就是"你以为你打开了 E:\foo，其实打开的是 C:\foo"。
//   2. **只列目录**。指向目录的软链跟随，断链跳过（列出来也点不进去）。
//   3. **排序必须确定**：按名字、大小写不敏感、同名再按原始串 —— 否则同一个
//      目录两次请求顺序可能不同，界面会"跳"。
// ============================================================

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { WorkspaceError, isFullyQualifiedPath } from "@/lib/workspace";

export type DirectoryEntry = {
  name: string;
  /** 绝对路径（界面直接拿它当"下一层要请求的 path"） */
  path: string;
  /** 点前缀 = 隐藏。⚠️ 只认点前缀，见 `isHiddenName` 的说明 */
  hidden: boolean;
};

export type Crumb = { name: string; path: string };

export type DirectoryListing = {
  /** 当前层（规范化后的绝对路径） */
  path: string;
  /** 家目录（界面上的"回首页"锚点） */
  home: string;
  /** 上一层；盘符根为 null */
  parent: string | null;
  /** 根 → 当前，每一节都能跳 */
  crumbs: Crumb[];
  entries: DirectoryEntry[];
  /** 超过 `maxEntries` 时 true（截断了，界面要说一声） */
  truncated: boolean;
  /** 真实存在的盘符（Windows 上从家目录点不到别的盘，这是必须的出口） */
  drives: string[];
};

/** 一层的上限：目录里放十万个文件夹是病，但截断不能无声无息 */
export const MAX_ENTRIES = 1000;

/**
 * 列出目录里能当工作空间的子目录。
 *
 * 参数收对象：`path` 与 `home` 都是字符串，位置传参迟早写反（本项目踩过）。
 */
export function listDirectory(params: {
  path: string;
  maxEntries?: number;
}): DirectoryListing {
  const current = requireDirectory(params.path);
  const limit = params.maxEntries ?? MAX_ENTRIES;

  const names: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    // 只列目录；软链要 stat 一次才知道它是不是指向目录（dirent 只说"这是软链"）
    const target = join(current, entry.name);
    if (!isDirectory(target)) continue;
    names.push(entry.name);
  }

  const ordered = names.sort(compareNames);
  const shown = ordered.slice(0, limit);
  const entries: DirectoryEntry[] = shown.map((name) => ({
    name,
    path: join(current, name),
    hidden: isHiddenName(name),
  }));

  return {
    path: current,
    home: homedir(),
    parent: parentOf(current),
    crumbs: buildCrumbs(current),
    entries,
    truncated: ordered.length > limit,
    drives: listDrives(),
  };
}

/**
 * 校验并**规范化**一个"要拿来当目录"的路径。
 * 三道门：完全限定 → 存在 → 是目录。分别报不同的错（界面文案不同）。
 */
export function requireDirectory(path: string): string {
  if (!isFullyQualifiedPath(path)) {
    throw new WorkspaceError(
      "invalid-path",
      `路径必须是完全限定的绝对路径：${path}`,
    );
  }

  const normalized = resolve(path);
  let info;
  try {
    info = statSync(normalized);
  } catch {
    throw new WorkspaceError("not-a-directory", `路径不存在或读不到：${path}`);
  }
  if (!info.isDirectory()) {
    throw new WorkspaceError("not-a-directory", `这不是文件夹：${path}`);
  }
  return normalized;
}

/**
 * 根 → 当前的祖先链。`C:\Users\x\proj` →
 * `[C:\, C:\Users, C:\Users\x, C:\Users\x\proj]`
 */
export function buildCrumbs(path: string): Crumb[] {
  const normalized = resolve(path);
  const { root } = parse(normalized);
  const rest = normalized
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean);

  const crumbs: Crumb[] = [{ name: root, path: root }];
  let gathered = root;
  for (const segment of rest) {
    gathered = join(gathered, segment);
    crumbs.push({ name: segment, path: gathered });
  }
  return crumbs;
}

/** 上一层；盘符根返回 null（"退无可退"要能被表达出来） */
export function parentOf(path: string): string | null {
  const normalized = resolve(path);
  const parent = dirname(normalized);
  return parent === normalized ? null : parent;
}

/**
 * Windows 上真实存在的盘符（`C:\` 这种）。
 * 非 Windows 返回空数组 —— 那边的根就是 `/`，不需要"盘符条"这条出口。
 */
export function listDrives(): string[] {
  if (process.platform !== "win32") return [];

  const drives: string[] = [];
  for (let code = "A".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (existsSync(root)) drives.push(root);
  }
  return drives;
}

// ------------------------------------------------------------
// 内部
// ------------------------------------------------------------

/** 软链要 stat 才知道指向什么；断链 / 无权限一律当"不是目录" */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 隐藏项：**只认点前缀**。
 * ⚠️ Windows 的"隐藏"属性 Node 读不到（没有 API，只能起 `attrib` 子进程），
 * 所以这里是有意的能力边界：真隐藏属性的文件夹会被当成普通文件夹列出来。
 * 宁可多列（人还能点）也不要少列（人找不到，还以为目录是空的）。
 */
function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/** 大小写不敏感 + 稳定的平手规则（Windows 文件名大小写不敏感，`A` 与 `a` 会打架） */
function compareNames(a: string, b: string): number {
  const lower = a.toLowerCase().localeCompare(b.toLowerCase());
  return lower !== 0 ? lower : a.localeCompare(b);
}
