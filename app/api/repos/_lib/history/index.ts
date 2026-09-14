// ============================================================
// lib/repos/history.ts —— 更新历史（C15）
// ============================================================
// 更新总结落盘在 workspace/更新日志/<日期>-<项目>.md（人看材料）。
// 本模块负责把这些落盘文件读回来展示——页面刷新后 state 清空，
// 但历史还在文件里（用户 08-31 问"更新完面板都是空，去哪看最近更新"）。
//
// 文件名约定（saveUpdateLog 写入）：<YYYY-MM-DD>-<项目>.md
// 例如 2026-08-31-pi.md。同名文件会被覆盖（同一天同项目只留最新一条）。
// ============================================================

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "@/lib/config";

/** 一条更新历史（元信息） */
export type UpdateLogEntry = {
  /** 日期（文件名第一段，如 2026-08-31） */
  date: string;
  /** 项目名（文件名第二段，如 pi） */
  repoName: string;
  /** 完整文件名（读取内容用） */
  fileName: string;
};

/** 更新日志目录 */
function logsDir(): string {
  return join(config.paths.workspace, "更新日志");
}

/** 解析文件名 "<日期>-<项目>.md" → entry；不符合约定的返回 null */
export function parseLogFileName(fileName: string): Omit<UpdateLogEntry, "fileName"> | null {
  const match = /^(\d{4}-\d{2}-\d{2})-([^.]+)\.md$/.exec(fileName);
  if (!match) return null;
  return { date: match[1], repoName: match[2] };
}

/**
 * 列出全部更新日志（按日期倒序、同日期按项目名）。
 * 目录不存在（还没更新过任何仓库）→ 返回空数组。
 */
export async function listUpdateLogs(): Promise<UpdateLogEntry[]> {
  try {
    const files = await readdir(logsDir());
    const entries: UpdateLogEntry[] = [];
    for (const fileName of files) {
      const parsed = parseLogFileName(fileName);
      if (parsed) entries.push({ ...parsed, fileName });
    }
    // 倒序：最新的（日期大）在前；同日期按项目名排
    entries.sort((a, b) =>
      a.date === b.date ? a.repoName.localeCompare(b.repoName) : b.date.localeCompare(a.date),
    );
    return entries;
  } catch {
    // 目录不存在（readdir 抛 ENOENT）→ 空历史
    return [];
  }
}

/**
 * 读某项目的最新一条更新日志全文（markdown）。
 * 没有该项目的历史 → 返回 null。
 */
export async function readLatestLog(repoName: string): Promise<string | null> {
  const all = await listUpdateLogs();
  const mine = all.find((e) => e.repoName === repoName);
  if (!mine) return null;
  try {
    return await readFile(join(logsDir(), mine.fileName), "utf8");
  } catch {
    return null;
  }
}

/** 读指定文件名的更新日志全文（fileName 来自 listUpdateLogs，白名单内） */
export async function readLog(fileName: string): Promise<string | null> {
  try {
    return await readFile(join(logsDir(), fileName), "utf8");
  } catch {
    return null;
  }
}

/** 一条带内容的日志（时间线渲染用） */
export type UpdateLogWithContent = {
  /** 日期（如 2026-08-31） */
  date: string;
  /** 完整文件名 */
  fileName: string;
  /** 日志全文（markdown） */
  content: string;
};

/**
 * 读某项目的全部更新日志（倒序：最新在前）。
 * 时间线用——用户 08-31 问"下周再更新一次怎么展示"：
 * 每次更新落盘一个文件，这里把它们全部读回来，旧记录依然可见。
 * 读取失败的单条跳过（不阻塞整体）；没有历史 → 空数组。
 */
export async function readAllLogs(repoName: string): Promise<UpdateLogWithContent[]> {
  const all = await listUpdateLogs();
  const mine = all.filter((e) => e.repoName === repoName);
  const result: UpdateLogWithContent[] = [];
  for (const entry of mine) {
    const content = await readLog(entry.fileName);
    if (content) result.push({ date: entry.date, fileName: entry.fileName, content });
  }
  return result;
}
