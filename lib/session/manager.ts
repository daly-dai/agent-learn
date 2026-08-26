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

import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, SessionEntry } from "../types";
import { JsonlSessionStore } from "./store";

export type SessionSummary = {
  id: string;
  title?: string;
  messageCount: number;
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
    await writeFile(filePath, lines.join("\n"), "utf8");
  }

  /** 删除整个会话文件 */
  async delete(id: string): Promise<void> {
    const filePath = this.sessionPath(id);
    try {
      await rm(filePath);
    } catch {
      throw new Error(`会话不存在：${id}`);
    }
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
    let messageCount = 0;
    let preview: string | undefined;

    for (const line of raw.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as SessionEntry;
      if (entry.type === "session") {
        title = entry.title;
      } else if (entry.type === "message") {
        messageCount += 1;
        if (preview === undefined && entry.message.role === "user") {
          preview = truncate(messageText(entry.message), 60);
        }
      }
    }

    return {
      id,
      ...(title ? { title } : {}),
      messageCount,
      updatedAt: mtime,
      ...(preview ? { preview } : {}),
    };
  } catch {
    return null;
  }
}

function messageText(message: AgentMessage): string {
  // compactionSummary 没有 content 数组（它只有 summary 文本）——单独处理
  if (message.role === "compactionSummary") {
    return `（旧上下文压缩摘要）${message.summary}`;
  }
  // 注意：不要用 filter(isTextContent) —— message.content 在 AgentMessage
  // 联合类型下是「两种数组的联合」，类型守卫在联合数组上收窄不稳。
  // flatMap + 内联窄化（block.type === "text"）对两种数组都成立。
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join(" ");
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}…`;
}
