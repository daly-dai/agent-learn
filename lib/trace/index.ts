// ============================================================
// 轨迹（Trace）—— 调试与可视化的"黑匣子"
// ============================================================
//
// Event Timeline 是实时仪表盘（边跑边看，跑完即弃）；
// Trace 是持久黑匣子（每次 run 落盘，事后可回放、可定位"哪一步开始错"）。
//
// 设计：不动 lib/types.ts 里现有的 AgentEvent。TraceEntry 是"事件 + 位置"
// 的一层包装，通过包装 onEvent 回调接入，引擎（lib/agent/index.ts）零改动。
//
// 每条 TraceEntry 多带四样定位信息：
//   seq   本次 run 内递增，决定顺序
//   runId 本次 run 唯一 id（多会话/并发/重试不串）
//   ts    墙钟时间
//   turn  当前第几轮（由 turn_start 事件自动跟踪）
//
// ── 落盘：一个 run 一个文件，路径 = dir/<sessionId>.<runId>.jsonl ──
//   **会话归属写在文件名里，不写进字段**（2026-09-14 定，A3 详案 §3.1 ①）。
//   文件名是唯一真相："列某个会话的轨迹" = readdir + 前缀过滤 = 零内容读取。
//   再加一个 sessionId 字段就是第二个真相，两者会漂移——本项目已经栽过两次
//   （header.version 从不被读、TraceSnapshot 无人传），教训是"结构不会忘，
//   字段会忘"。runId 仍在首行：文件名管归属、首行管身份，各一份、不重复。
//   一个 run 一个文件 ⇒ 单文件不会无界增长（上限就是单次 run 的量级）。
//
// ── 文件结构 ──
//   首行 trace_start（元信息）→ 中间 TraceEntry → 末行 trace_end。
//   readTrace      取中间的 entries（跳过首末两行元信息）
//   readTraceMeta  只读首末两行 —— 列表用，**别把 1MB 全读进来**
// ============================================================

import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent } from "../types";

export type TraceEntry = {
  seq: number;
  runId: string;
  ts: number;
  turn?: number;
  event: AgentEvent;
};

/** trace_start 行（首行）的形状 */
type TraceStartLine = {
  type: "trace_start";
  runId: string;
  model: string;
  sessionId: string;
  ts: number;
};

/** trace_end 行（末行）的形状 */
type TraceEndLine = {
  type: "trace_end";
  runId: string;
  ts: number;
  seq: number;
  messages?: number;
  error?: string;
};

/** 列表用的轻量元信息：只读首末两行就能拿到，不解析中间 */
export type TraceMeta = {
  runId: string;
  model: string;
  /** 这条轨迹属于哪个会话（从文件名解析，不从文件内容——内容里没这个字段） */
  sessionId: string;
  startedAt: number;
  /**
   * 末行是不是一条完整的 trace_end。
   * false = 服务崩了 / 被强杀，这份轨迹是残的——界面该标出来，而不是假装正常。
   */
  completed: boolean;
  /** trace_end 携带的收尾摘要（正常收尾时才有） */
  summary?: { messages?: number; error?: string };
  /** 文件字节数（fstat 顺手拿到；列表里显示体量用） */
  bytes: number;
};

export class TraceRecorder {
  readonly entries: TraceEntry[] = [];

  private seq = 0;
  private currentTurn?: number;
  // 用 promise 链保证 JSONL 追加顺序（并发 appendFile 会乱序）
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    readonly runId: string,
    readonly model: string,
    readonly sessionId: string,
    readonly startedAt: number,
    private readonly filePath: string,
  ) {}

  static create(dir: string, model: string, sessionId: string): TraceRecorder {
    const runId = generateRunId();
    return new TraceRecorder(
      runId,
      model,
      sessionId,
      Date.now(),
      join(dir, traceFileName(sessionId, runId)),
    );
  }

  /** 初始化：确保目录存在，写一条 trace_start 元信息 */
  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.appendLine({
      type: "trace_start",
      runId: this.runId,
      model: this.model,
      sessionId: this.sessionId,
      ts: this.startedAt,
    });
  }

  /** 记录一个事件：先入内存（供前端/返回值用），再按序落盘（黑匣子） */
  record(event: AgentEvent): void {
    // 从 turn_start 事件自动跟踪轮次，无需引擎显式调用
    if (event.type === "turn_start") {
      this.currentTurn = event.turn;
    }

    const entry: TraceEntry = {
      seq: ++this.seq,
      runId: this.runId,
      ts: Date.now(),
      ...(this.currentTurn !== undefined ? { turn: this.currentTurn } : {}),
      event,
    };

    this.entries.push(entry);
    this.appendLine(entry);
  }

  /** 结束：写 trace_end，并等所有行落盘 */
  async end(summary?: { messages?: number; error?: string }): Promise<void> {
    this.appendLine({
      type: "trace_end",
      runId: this.runId,
      ts: Date.now(),
      seq: ++this.seq,
      ...summary,
    });
    await this.writeChain;
  }

  private appendLine(obj: unknown): void {
    this.writeChain = this.writeChain.then(() =>
      appendFile(this.filePath, `${JSON.stringify(obj)}\n`, "utf8"),
    );
  }
}

// ------------------------------------------------------------
// 文件名：`.traces/<sessionId>.<runId>.jsonl`
// ------------------------------------------------------------
// 沿用项目既有约定：同一会话的兄弟文件用**文件名**表达，不是目录
// （先例 `.sessions/<sessionId>.approval.jsonl`）。
// isValidSessionId 保证 sessionId 不含 `.`，所以"首个点之前"就是会话 id，
// 解析无歧义。
// ------------------------------------------------------------

export function traceFileName(sessionId: string, runId: string): string {
  return `${sessionId}.${runId}.jsonl`;
}

/** 解析失败返回 undefined（老轨迹文件名里没有会话前缀 → 归不到任何会话） */
export function parseTraceFileName(fileName: string): { sessionId: string; runId: string } | undefined {
  if (!fileName.endsWith(".jsonl")) return undefined;

  const body = fileName.slice(0, -".jsonl".length);
  const dot = body.indexOf(".");
  if (dot <= 0) return undefined;

  const sessionId = body.slice(0, dot);
  const runId = body.slice(dot + 1);
  if (!sessionId || !runId) return undefined;

  return { sessionId, runId };
}

function generateRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `run_${stamp}_${random}`;
}

// ------------------------------------------------------------
// 读：全量回放 vs 只读首末两行
// ------------------------------------------------------------

/** 回放：读一个轨迹文件，只取其中的 TraceEntry（跳过 start/end 元信息行） */
export async function readTrace(filePath: string): Promise<TraceEntry[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEntry & { type?: string })
    .filter((entry): entry is TraceEntry => entry.type === undefined && "event" in entry);
}

/** 首行读这么多字节就够（trace_start 约 150 字节，留 6 倍余量） */
const HEAD_BYTES = 1024;
/** 尾行读这么多（trace_end 约 100 字节，留 20 倍余量；摘要带 error 时会长） */
const TAIL_BYTES = 2048;

/**
 * 只读首末两行拿列表用的元信息。
 *
 * ⚠️ **别用 `readFile` + `split("\n")[0]` 实现它**——那还是把整个文件读进来了，
 * 而 `.traces/` 现在单个文件到过 1.15MB、共 154 个。这里是真正的部分读：
 * 首行读文件头 1KB，末行走 fstat + 从末尾读 2KB。
 *
 * 坏文件返回 undefined（不挂掉整个列表）。
 */
export async function readTraceMeta(filePath: string): Promise<TraceMeta | undefined> {
  const handle = await open(filePath, "r").catch(() => undefined);
  if (!handle) return undefined;

  try {
    const { size } = await handle.stat();
    if (size === 0) return undefined;

    const head = await readChunk(handle, 0, Math.min(HEAD_BYTES, size));
    const newline = head.indexOf("\n");
    // 首行都没读完 → 不是我们认识的文件（正常的 trace_start 只有百来字节）
    if (newline < 0) return undefined;

    const start = parseLine<TraceStartLine>(head.slice(0, newline));
    if (start?.type !== "trace_start") return undefined;

    const tailLength = Math.min(TAIL_BYTES, size);
    const tail = await readChunk(handle, size - tailLength, tailLength);
    // 尾部片段可能从半行开始（多字节字符也可能被切断）——只看最后一行，
    // 而文件以 "\n" 结尾，所以最后一个非空元素就是完整的末行。
    const tailLines = tail.split("\n").filter(Boolean);
    const end = parseLine<TraceEndLine>(tailLines[tailLines.length - 1] ?? "");

    return {
      runId: start.runId,
      model: start.model,
      sessionId: start.sessionId,
      startedAt: start.ts,
      // 末行不是完整的 trace_end（包括"写了一半"这种）→ 这份轨迹是残的
      completed: end?.type === "trace_end",
      ...(end?.type === "trace_end"
        ? { summary: { messages: end.messages, error: end.error } }
        : {}),
      bytes: size,
    };
  } finally {
    await handle.close();
  }
}

function parseLine<T>(line: string): T | undefined {
  if (!line) return undefined;
  try {
    return JSON.parse(line) as T;
  } catch {
    // 尾行被截断是**正常情况**（崩在写 trace_end 的中途），不是异常
    return undefined;
  }
}

async function readChunk(handle: FileHandle, position: number, length: number): Promise<string> {
  if (length <= 0) return "";
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead).toString("utf8");
}
