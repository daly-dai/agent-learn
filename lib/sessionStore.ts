// ============================================================
// 会话存储（SessionStore）—— 让多轮对话变成真的
// ============================================================
//
// 解决的问题（对应 Phase 1）：route.ts 原来每次 POST 都只带 [userMessage]，
// 上一轮的结果不进下一轮上下文——多轮对话其实是"每次都重新开始"。
// 本模块把消息持久化成 JSONL 文件，下次 run 前用 buildContext() 重建完整上下文。
//
// 数据结构：一个会话 = 一个 JSONL 文件，一行一个 SessionEntry：
//   session   头（版本 / id / cwd）
//   message   id + parentId + 消息本体
//   compaction 旧消息摘要（上下文超窗口时替代被压缩的部分）
//
// id/parentId 构成会话树，叶子（leafId）是当前最新消息。
// 为什么是树而不是数组：Phase 2 要做分支切换——从任意历史节点可以岔出新线，
// 数组无法表达"同一条父消息长出两个后续"。
//
// 对应教学版：how-pi-agent-works/examples/teaching-agent/src/server/agent/sessionStore.ts
// 差异：sessionId 从构造函数传入（教学版硬编码），其余逻辑保持一致。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentMessage, SessionEntry, SessionStats } from "./types";
import { isTextContent, text } from "./message";

type MessageEntry = Extract<SessionEntry, { type: "message" }>;
type CompactionEntry = Extract<SessionEntry, { type: "compaction" }>;

export class JsonlSessionStore {
  // 内存态：entries 全量 + byId 索引 + leafId 叶子 + counter 自增 id 计数器。
  // 为什么内存里也存一份：buildContext() 每次要回溯整条路径，直接从 Map 查
  // 比每次重读文件快得多；磁盘只负责"持久化"，内存才是"工作态"。
  private readonly entries: SessionEntry[] = [];
  private byId = new Map<string, SessionEntry>();
  private leafId: string | null = null;
  private counter = 0;

  constructor(
    private readonly filePath: string,
    private readonly cwd: string,
    private readonly sessionId: string,
    // Phase 2 多会话：新建会话时给一个显示名（title）；读旧文件时头里的
    // title 原样保留在 entries 里，不需要这里再传。
    private readonly title?: string,
  ) {
    this.loadOrCreate();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getEntries(): SessionEntry[] {
    return [...this.entries];
  }

  getLeafId(): string | null {
    return this.leafId;
  }

  /** 会话级累计统计（读数盘用）：扫描内存态全量 entries。
   *  轮次 = assistant 消息数；工具调用 = toolResult 数；
   *  token = 所有 assistant 消息 usage.totalTokens 之和。 */
  stats(): SessionStats {
    let turns = 0;
    let tools = 0;
    let tokens = 0;

    for (const entry of this.entries) {
      if (entry.type !== "message") continue;
      if (entry.message.role === "assistant") {
        turns += 1;
        tokens += entry.message.usage.totalTokens;
      } else if (entry.message.role === "toolResult") {
        tools += 1;
      }
    }

    return { turns, tools, tokens };
  }

  /** 切分支（Phase 2 多会话/回溯用）：把叶子指到任意历史条目 */
  switchLeaf(leafId: string): void {
    if (!this.byId.has(leafId)) {
      throw new Error(`Unknown session entry: ${leafId}`);
    }
    this.leafId = leafId;
  }

  /** 清空会话：删文件 + 重置内存态 + 重写头 */
  async reset(): Promise<void> {
    if (existsSync(this.filePath)) {
      await rm(this.filePath);
    }
    this.entries.length = 0;
    this.byId = new Map();
    this.leafId = null;
    this.counter = 0;
    this.writeHeader();
  }

  /** 追加一条消息，parentId 指向当前叶子；返回新条目的 id（它成为新叶子） */
  async appendMessage(message: AgentMessage): Promise<string> {
    const id = this.nextId();
    const entry: MessageEntry = {
      type: "message",
      id,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      message,
    };
    await this.appendEntry(entry);
    this.leafId = id;
    return id;
  }

  /**
   * 上下文超窗口时压缩：把「最旧的、超出 keepRecentMessages 条的部分」压成一条摘要，
   * 记录 firstKeptEntryId（摘要之后第一条保留消息），新摘要成为叶子。
   * 返回压缩条目；没超限则返回 undefined。
   */
  async compactIfNeeded(
    maxApproxTokens: number,
    keepRecentMessages: number,
  ): Promise<CompactionEntry | undefined> {
    const path = this.pathToLeaf();
    const messageEntries = path.filter(
      (entry): entry is MessageEntry => entry.type === "message",
    );
    const currentContext = this.buildContext();
    const tokensBefore = estimateTokens(currentContext);

    if (
      tokensBefore <= maxApproxTokens ||
      messageEntries.length <= keepRecentMessages
    ) {
      return undefined;
    }

    const kept = messageEntries.slice(-keepRecentMessages);
    const summarized = messageEntries.slice(0, -keepRecentMessages);
    const summary = summarizeEntries(summarized);
    const firstKeptEntryId = kept[0]?.id;

    if (!firstKeptEntryId) return undefined;

    const entry: CompactionEntry = {
      type: "compaction",
      id: this.nextId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
    };

    await this.appendEntry(entry);

    this.leafId = entry.id;

    return entry;
  }

  /**
   * 重建发给模型的上下文：从叶子回溯到根，把路径上的消息转成 AgentMessage[]。
   * 若有压缩条目：用一条合成的 user 消息（内含摘要文本）替代被压缩的旧消息，
   * 再拼接 firstKeptEntryId 之后和压缩条目之后的消息。
   *
   * 为什么摘要用 role:"user"：它本质是给模型的指令（"旧内容已摘要，参考它"），
   * 不是真实用户消息；教学版选 user 是务实之举——模型对 user 指令的遵循最稳。
   */
  buildContext(): AgentMessage[] {
    const path = this.pathToLeaf();

    const latestCompactionIndex = findLastIndex(
      path,
      (entry) => entry.type === "compaction",
    );

    if (latestCompactionIndex === -1) {
      return path.flatMap(entryToMessage);
    }

    const compaction = path[latestCompactionIndex] as CompactionEntry;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [
          text(
            `以下是旧上下文摘要。后续回答必须参考它，但最近消息优先级更高。\n\n${compaction.summary}`,
          ),
        ],
        timestamp: new Date(compaction.timestamp).getTime(),
      },
    ];

    // 摘要之后、压缩点之前：只保留 firstKeptEntryId 起的那部分（它们未被压缩）
    let foundFirstKept = false;

    for (let i = 0; i < latestCompactionIndex; i++) {
      const entry = path[i];

      if (entry.id === compaction.firstKeptEntryId) {
        foundFirstKept = true;
      }

      if (foundFirstKept) {
        messages.push(...entryToMessage(entry));
      }
    }

    // 压缩点之后的全部消息（最近的真实对话）
    for (let i = latestCompactionIndex + 1; i < path.length; i++) {
      messages.push(...entryToMessage(path[i]));
    }

    return messages;
  }

  // --- 私有：文件与内存的同步 ---

  /** 文件存在则读入内存重建状态；不存在则写头。 */
  private loadOrCreate(): void {
    if (!existsSync(this.filePath)) {
      this.writeHeader();
      return;
    }

    const lines = readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean);

    for (const line of lines) {
      const entry = JSON.parse(line) as SessionEntry;

      this.entries.push(entry);

      if (entry.type !== "session") {
        this.byId.set(entry.id, entry);
        // 文件是追加写的，最后一行就是最新叶子
        this.leafId = entry.id;
        // 从 id 恢复自增计数，保证重启后 id 不重复
        this.counter = Math.max(
          this.counter,
          Number(entry.id.replace("entry_", "")) || 0,
        );
      }
    }

    // 防御：文件存在但没有 session 头（可能是坏文件），丢弃重写
    if (!this.entries.some((entry) => entry.type === "session")) {
      this.entries.length = 0;
      this.writeHeader();
    }
  }

  /** 写会话头（第一行），同时建目录 */
  private writeHeader(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });

    const header: SessionEntry = {
      type: "session",
      version: 1,
      id: this.sessionId,
      timestamp: new Date().toISOString(),
      cwd: this.cwd,
      ...(this.title ? { title: this.title } : {}),
    };

    this.entries.push(header);

    writeFileSync(this.filePath, `${JSON.stringify(header)}\n`, "utf8");
  }

  /** 追加一条条目：先更新内存态，再落盘。调用方需顺序 await，乱序风险同 trace.ts */
  private async appendEntry(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);

    if (entry.type !== "session") {
      this.byId.set(entry.id, entry);
    }

    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** 从叶子沿 parentId 回溯到根，还原成「根 → 叶子」的正序路径 */
  private pathToLeaf(): SessionEntry[] {
    if (!this.leafId) return [];

    const path: SessionEntry[] = [];
    let current = this.byId.get(this.leafId);
    
    while (current) {
      // 为什么 unshift 而不是 push：回溯得到的是「叶子→根」，unshift 到头部
      // 才能还原「根→叶子」的正序，buildContext 需要按对话先后处理。
      path.unshift(current);
      current =
        "parentId" in current && current.parentId
          ? this.byId.get(current.parentId)
          : undefined;
    }
    
    return path;
  }

  private nextId(): string {
    this.counter += 1;
    return `entry_${this.counter}`;
  }
}

// --- 模块级纯函数（无状态，便于理解与测试） ---

function entryToMessage(entry: SessionEntry): AgentMessage[] {
  if (entry.type !== "message") return [];
  return [entry.message];
}

function summarizeEntries(entries: MessageEntry[]): string {
  return entries
    .map((entry) => {
      const content = extractText(entry.message);
      return `${entry.message.role}: ${content}`;
    })
    .join("\n");
}

/** 粗略估算 token 数：中英文混合下平均一个字符约 0.5 token，够触发阈值即可 */
function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => {
    const content = extractText(message);
    return sum + Math.ceil(content.length / 2);
  }, 0);
}

function extractText(message: AgentMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (isTextContent(block)) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
