// ============================================================
// 会话存储（SessionStore）—— 让多轮对话变成真的
// ============================================================
//
// 解决的问题（对应 Phase 1）：route.ts 原来每次 POST 都只带 [userMessage]，
// 上一轮的结果不进下一轮上下文——多轮对话其实是"每次都重新开始"。
// 本模块把消息持久化成 JSONL 文件，下次 run 前用 buildContext() 重建完整上下文。
//
// 数据结构：一个会话 = 一个 JSONL 文件，一行一个 SessionEntry：
//   session   头（id / cwd / title）
//   message   消息本体
//   compaction 旧消息摘要（上下文超窗口时替代被压缩的部分）
//   todo      任务清单快照
//
// **线性日志**（C18 砍树，2026-09-14）：条目按写入顺序排列，顺序即对话顺序。
// 这里原先是一棵"会话树"（id/parentId + switchLeaf），但它是预挖的空壳——
// 分支从没被生产代码用过、leafId 落盘从不记录、"最后一行就是叶子"的假设
// 又与树自相矛盾。详见 lib/types.ts 的说明与 doc/plan/session-compaction-refactor.md §7.5。
//
// 对应教学版：how-pi-agent-works/examples/teaching-agent/src/server/agent/sessionStore.ts
// 差异：sessionId 从构造函数传入（教学版硬编码），其余逻辑保持一致。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentMessage, SessionEntry, SessionStats, TodoItem } from "../../types";
import { createCompactionSummaryMessage, isTextContent, text } from "../../message";

type MessageEntry = Extract<SessionEntry, { type: "message" }>;
export type CompactionEntry = Extract<SessionEntry, { type: "compaction" }>;
type TodoEntry = Extract<SessionEntry, { type: "todo" }>;

/**
 * 压缩准备结果（B2 ③）：prepareCompaction 的产出，供产品层调模型生成摘要。
 * 对齐 pi 的 CompactionPreparation（compaction.ts:596）——纯计算与副作用分离。
 */
export type CompactionPreparation = {
  /** 要喂给摘要模型的消息（上一个压缩点之后 → 新切点之前） */
  messagesToSummarize: AgentMessage[];
  /** 压缩前的估算 token 数（写入 entry，前端压缩卡片展示） */
  tokensBefore: number;
  /** 待压区域的估算 token 数（经济性检查用：太小就不值得调模型） */
  tokensToSummarize: number;
  /** 摘要之后第一条保留消息的 id（buildContext 定位保留区用） */
  firstKeptEntryId: string;
  /** 上一次压缩的摘要（增量更新用：pi UPDATE prompt，信息链不断） */
  previousSummary?: string;
};

export class JsonlSessionStore {
  // 内存态：entries 全量 + counter 自增 id 计数器。
  // 为什么内存里也存一份：buildContext() 每次要整条读一遍，从内存数组读
  // 比每次重读文件快得多；磁盘只负责"持久化"，内存才是"工作态"。
  private readonly entries: SessionEntry[] = [];
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

  /** 清空会话：删文件 + 重置内存态 + 重写头 */
  async reset(): Promise<void> {
    if (existsSync(this.filePath)) {
      await rm(this.filePath);
    }
    this.entries.length = 0;
    this.counter = 0;
    this.writeHeader();
  }

  /** 追加一条消息；返回新条目的 id */
  async appendMessage(message: AgentMessage): Promise<string> {
    const id = this.nextId();
    const entry: MessageEntry = {
      type: "message",
      id,
      timestamp: new Date().toISOString(),
      message,
    };
    await this.appendEntry(entry);
    return id;
  }

  /** 追加一条任务清单条目（Phase 5）：todo 是会话事件不是独立存储（DSH 走读 07）。
   *  与对话同生命周期、可回放；取的时候认最后一条。 */
  async appendTodo(todos: TodoItem[]): Promise<string> {
    const id = this.nextId();
    const entry: TodoEntry = {
      type: "todo",
      id,
      timestamp: new Date().toISOString(),
      todos,
    };
    await this.appendEntry(entry);
    return id;
  }

  /** 取最新一条 todo 条目（没有则 undefined）——前端面板恢复用 */
  getLatestTodos(): TodoItem[] | undefined {
    const entries = this.entriesInOrder();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.type === "todo") return entry.todos;
    }
    return undefined;
  }

  /**
   * 上下文超窗口时【准备】压缩（纯计算，不碰模型——可单测）：
   * 选切点（保留区第一条不能是 toolResult）、算待压消息/旧摘要/token 数。
   * 返回 CompactionPreparation；没超限则返回 undefined。
   *
   * 模型调用发生在产品层（route.ts），落盘走 commitCompaction——
   * 对齐 pi 的 prepareCompaction → compact 分离（纯计算 vs 副作用，
   * 见 doc/02 决策 D1 与 pi compaction.ts:616 prepareCompaction）。
   */
  prepareCompaction(
    maxApproxTokens: number,
    keepRecentMessages: number,
  ): CompactionPreparation | undefined {
    // 按写入顺序取全部条目，把其中的消息转成 AgentMessage[]
    const path = this.entriesInOrder();
    // 过滤出消息条目（B2 ②）。
    const messageEntries = path.filter(
      (entry): entry is MessageEntry => entry.type === "message",
    );
    // 计算当前上下文的 token 数（B2 ④）。
    const currentContext = this.buildContext();
    // 估算 token 数（B2 ⑤）。
    const tokensBefore = estimateTokens(currentContext);

    // 经济性检查：如果 token 数不超过阈值或消息数不超过阈值，则不压缩。
    if (
      tokensBefore <= maxApproxTokens ||
      messageEntries.length <= keepRecentMessages
    ) {
      return undefined;
    }

    // 找上一个压缩点：previousSummary（增量更新，D3）+ 待压区起点。
    // 关键：被压过的旧消息（上一个压缩点之前）不再喂给模型——它们的
    // 信息由 previousSummary 代表（增量合并不丢）；待压区从「上一个压缩
    // 的保留区第一条」开始，包含上次保留的最近消息 + 之后的新消息。
    let prevCompaction: CompactionEntry | undefined;
    let summarizeStart = 0; // messageEntries 里第一个要摘要的消息下标
    
    for (const entry of path) {
      if (entry.type !== "compaction") continue;
      prevCompaction = entry;
      const idx = messageEntries.findIndex(
        (m) => m.id === entry.firstKeptEntryId,
      );
      if (idx >= 0) summarizeStart = idx;
    }

    // 保留区：从尾部取最近 keepRecentMessages 条消息。
    // 关键约束（2026-08-25 修）：保留区第一条【不能是 toolResult】。
    // 原因：ReAct 里 assistant(toolCall) 先出现、toolResult 后出现；若切点落在
    // toolResult 上，它配对的 assistant toolCall 被压进摘要，重建上下文时产生
    // "孤儿 tool"（role:"tool" 前面没有带 tool_calls 的 assistant），
    // 真实模型 API（DeepSeek）会 400：Messages with role 'tool' must be a
    // response to a preceding message with 'tool_calls'。
    // 修法：切点落在 toolResult 上时往前多保留一条，直到第一条不是 toolResult。
    let keepFrom = messageEntries.length - keepRecentMessages;
    while (
      keepFrom > 0 &&
      messageEntries[keepFrom].message.role === "toolResult"
    ) {
      keepFrom -= 1;
    }

    const summarized = messageEntries.slice(summarizeStart, keepFrom);
    const kept = messageEntries.slice(keepFrom);
    const firstKeptEntryId = kept[0]?.id;

    if (!firstKeptEntryId) return undefined;

    return {
      messagesToSummarize: summarized.map((entry) => entry.message),
      tokensBefore,
      // 经济性检查用（Reasonix D6，判断在 route.ts）：要压的区域多大
      tokensToSummarize: estimateTokens(
        summarized.map((entry) => entry.message),
      ),
      firstKeptEntryId,
      previousSummary: prevCompaction?.summary,
    };
  }

  /**
   * 【落盘】压缩条目：追加 compaction entry 到会话末尾。
   * 产品层调模型生成摘要后调用（MOCK/失败时传拼贴降级摘要）。
   */
  async commitCompaction(
    prep: CompactionPreparation,
    summary: string,
  ): Promise<CompactionEntry> {
    const entry: CompactionEntry = {
      type: "compaction",
      id: this.nextId(),
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId: prep.firstKeptEntryId,
      tokensBefore: prep.tokensBefore,
    };

    await this.appendEntry(entry);

    return entry;
  }

  /**
   * 重建发给模型的上下文：按写入顺序读全部条目，把其中的消息转成 AgentMessage[]。
   * 若有压缩条目：用一条 compactionSummary 消息（B2 新增类型）替代被压缩的旧消息，
   * 再拼接 firstKeptEntryId 之后和压缩条目之后的消息。
   *
   * 为什么不用 role:"user"（2026-08-25 改）：摘要既给模型（指令参考）又给前端
   * （展示）。伪装 user 会让前端把它当用户气泡渲染——多轮后页面出现一大坨
   * "user:/assistant:/toolResult:" 前缀文本。独立类型 compactionSummary 让
   * 模型侧（deepseekModel 转换时伪装 user）和前端侧（渲染成折叠卡片）各取所需。
   */
  buildContext(): AgentMessage[] {
    const path = this.entriesInOrder();

    const latestCompactionIndex = findLastIndex(
      path,
      (entry) => entry.type === "compaction",
    );

    if (latestCompactionIndex === -1) {
      return path.flatMap(entryToMessage);
    }

    const compaction = path[latestCompactionIndex] as CompactionEntry;

    // 摘要消息：独立类型（不是 user）——前端能认出它是"压缩卡片"
    const messages: AgentMessage[] = [
      createCompactionSummaryMessage(
        compaction.summary,
        compaction.tokensBefore,
        new Date(compaction.timestamp).getTime(),
      ),
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

    const parsed = readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionEntry);

    // 防御：文件存在但没有 session 头（可能是坏文件），丢弃重写
    if (!parsed.some((entry) => entry.type === "session")) {
      this.writeHeader();
      return;
    }

    for (const entry of parsed) {
      this.entries.push(entry);

      // 从 id 恢复自增计数，保证重启后 id 不重复
      if (entry.type !== "session") {
        this.counter = Math.max(
          this.counter,
          Number(entry.id.replace("entry_", "")) || 0,
        );
      }
    }
  }

  /** 写会话头（第一行），同时建目录 */
  private writeHeader(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });

    // ⚠️ 为什么会话头里**没有 version 字段**（2026-09-14 删的，别再加回来）：
    // 原来有 `version: 1`，但**全仓库没有任何读取路径**——正是详案 §1.2 诊断出的
    // "预留字段"病（同族：TraceSnapshot / message_update.message / 出网的 leafId）。
    // 中途加过一版「读到不认识的版本就抛错」，随后又撤了：那是**兼容性机制**
    // （让新旧代码版本安全共存），而此刻探索期 + 存量数据已清空，
    // "多个版本共存"这个需求**根本不存在** → 不变量 3「接缝由需求逼出来，不预挖空壳」。
    // 真到有值得保护的数据那天再加，5 行的事。判据留在这里，免得到时候又被
    // "格式都该有个版本号"的直觉带走。
    const header: SessionEntry = {
      type: "session",
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
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** 会话文件里除头之外的全部条目，按写入顺序（= 对话顺序）。
   *  为什么不再沿 parentId 回溯：会话是线性日志，不是树——见 lib/types.ts。
   *  实测 39/39 个现存会话文件都是干净的线性链，所以这种读法对老文件得到的
   *  结果与原来的树遍历**逐条相同**（这正是砍树可以不迁移、不重写文件的原因）。 */
  private entriesInOrder(): SessionEntry[] {
    return this.entries.filter((entry) => entry.type !== "session");
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

/** 拼贴式摘要（降级用）：MOCK 模式 / 模型失败时保信息不崩 */
export function summarizeEntries(messages: AgentMessage[]): string {
  return messages
    .map((message) => `${message.role}: ${extractText(message)}`)
    .join("\n");
}

/** 粗略估算 token 数：中英文混合下平均一个字符约 0.5 token，够触发阈值即可 */
export function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => {
    const content = extractText(message);
    return sum + Math.ceil(content.length / 2);
  }, 0);
}

function extractText(message: AgentMessage): string {
  // compactionSummary 没有 content 数组，它的"文本"就是 summary
  if (message.role === "compactionSummary") {
    return message.summary;
  }
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
