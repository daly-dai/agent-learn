// ============================================================
// SessionManager —— 会话目录级操作（Phase 2 多会话）
// ============================================================
//
// 一个会话 = .sessions/<id>.jsonl 一个文件。本模块管「会话本身」：
//   list / create / rename / delete / sessionPath
// 对话读写不在这里——那是 JsonlSessionStore 的事（route.ts 每请求新建）。
//
// 为什么拆开：list() 只需要「头 + 条数 + 预览」，轻量扫目录即可，
// 不必为列目录而给每个会话建一个完整的 store 实例。
// 本模块无内存态，方法直接打文件系统，所以可以作为模块级单例使用。
// ============================================================

import { readFile, readdir, rename as renameFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, SessionEntry } from "../../types";
import { messageText } from "../../message";
import { JsonlSessionStore } from "../store";
// 审批侧车（<id>.approval.jsonl）的路径定义在权限层——delete 要连它一起删，
// 所以这里复用那份定义，不自己再拼一次文件名（拼法只有一处，改也只会改一处）。
import { approvalLogPath } from "../../permission/approval-log";

export type SessionSummary = {
  id: string;
  title?: string;
  /** 文件最后修改时间（毫秒），用作「最近活跃」排序与展示 */
  updatedAt: number;
  /** 首条用户消息的文本（截断），列表里给个上下文提示 */
  preview?: string;
};

export class SessionManager {
  constructor(
    private readonly sessionDir: string,
    private readonly cwd: string,
  ) {}

  /** 会话文件路径。id 由调用方保证合法（见 isValidSessionId） */
  sessionPath(id: string): string {
    return join(this.sessionDir, `${id}.jsonl`);
  }

  /** 扫目录列出所有会话，按最近活跃倒序 */
  async list(): Promise<SessionSummary[]> {
    const files = await readdir(this.sessionDir, { withFileTypes: true }).catch(
      () => [],
    );
    const summaries: SessionSummary[] = [];

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const id = file.name.slice(0, -".jsonl".length);
      // 2026-08-26 修（幽灵会话）：会话目录只认「合法会话 id」的文件。
      // B1 审批日志（<id>.approval.jsonl，带点）和手动副本（带空格）也是
      // .jsonl，以前会被当成 0 条消息的会话列出来，但 delete() 的
      // isValidSessionId 拒绝它们 → 「列得出、删不掉」。
      // 过滤标准与路由层同一把尺（isValidSessionId），进出对称。
      if (!isValidSessionId(id)) continue;
      const summary = await summarizeSessionFile(this.sessionPath(id), id);
      if (summary) summaries.push(summary);
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 新建空会话：写一个只有头的文件；title 可选；返回生成的 id */
  async create(title?: string): Promise<string> {
    const id = generateSessionId();
    // 复用 JsonlSessionStore 写头：文件不存在时 loadOrCreate 会建目录 + 写头。
    // 实例用完即弃（没有消息可读），这只是「借它的写头逻辑」。
    new JsonlSessionStore(this.sessionPath(id), this.cwd, id, title);
    return id;
  }

  /** 重命名：只改文件第一行（头）的 title，其余行不动 */
  async rename(id: string, title: string): Promise<void> {
    const filePath = this.sessionPath(id);
    const raw = await readFile(filePath, "utf8").catch(() => {
      throw new Error(`会话不存在：${id}`);
    });
    const lines = raw.split("\n");
    if (!lines[0]?.trim()) {
      throw new Error(`会话文件为空：${id}`);
    }
    const header = JSON.parse(lines[0]) as SessionEntry;
    if (header.type !== "session") {
      throw new Error(`会话文件头损坏：${id}`);
    }
    // title 为空串 = 清除显示名，回退用 id
    lines[0] = JSON.stringify(
      title.trim() ? { ...header, title: title.trim() } : { ...header, title: undefined },
    );

    // 原子替换（C18 A 档 ②）：先写同目录临时文件，再 rename 覆盖。
    // 为什么必须原子：本函数是「全量读 → 改首行 → **全量写回**」，实测最大会话
    // 124KB。直接 writeFile 到目标路径时，若进程在写回中途被杀——**dev server
    // 随改代码反复重启，这个窗口天天出现**——文件会被截断成半截 JSON，会话永久
    // 损坏。同一目录内的 rename 在同一文件系统上是原子的：任何时刻崩溃，要么
    // 看到完整旧内容、要么看到完整新内容，最坏只留一个 .tmp 残骸。
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, lines.join("\n"), "utf8");
    await renameFile(tmpPath, filePath);
  }

  /** 删除整个会话：主文件 + 审批侧车。
   *  为什么连侧车一起删：删会话的语义是"这个会话不存在了"，而原来只 rm 主文件——
   *  审批日志会留成孤儿（实测存量里已有 3 个：会话早删了、日志还躺在 .sessions/）。
   *  轨迹文件**不在这里删**：轨迹是独立的一层（TRACE_DIR 可配、且是调试黑匣子），
   *  会话层不该知道它的布局。 */
  async delete(id: string): Promise<void> {
    const filePath = this.sessionPath(id);
    try {
      await rm(filePath);
    } catch {
      throw new Error(`会话不存在：${id}`);
    }
    // force: 侧车不存在时静默返回——多数会话从没触发过审批，这是常态不是异常
    await rm(approvalLogPath(this.sessionDir, id), { force: true });
  }
}

// ------------------------------------------------------------
// 模块级纯函数
// ------------------------------------------------------------

/** 会话 id 合法性：只允许字母/数字/下划线/连字符。
 *  为什么必须校验：id 会拼进文件路径（sessionPath），不校验就能用
 *  `../../x` 越界读写——这是 tools.ts 路径沙箱（resolveInsideWorkspace）
 *  的精神在会话层的补课。 */
export function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export function generateSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `s_${stamp}_${random}`;
}

/** 读一个会话文件，压成列表用的一条摘要。坏文件返回 null（不挂掉整个列表） */
async function summarizeSessionFile(
  filePath: string,
  id: string,
): Promise<SessionSummary | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const mtime = await stat(filePath).then((s) => s.mtimeMs);

    let title: string | undefined;
    let preview: string | undefined;

    for (const line of raw.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as SessionEntry;
      if (entry.type === "session") {
        title = entry.title;
      } else if (entry.type === "message" && preview === undefined) {
        // 预览是单行展示：messageText 保留结构（模型/摘要用），
        // 这里把换行压成空格再截断，避免会话列表出现换行。
        if (entry.message.role === "user") {
          preview = truncate(messageText(entry.message).replace(/\n/g, " "), 60);
        }
      }
    }

    return {
      id,
      ...(title ? { title } : {}),
      updatedAt: mtime,
      ...(preview ? { preview } : {}),
    };
  } catch {
    return null;
  }
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}…`;
}
