// ============================================================
// 轨迹（Trace）—— 调试与可视化的"黑匣子"
// ============================================================
//
// Event Timeline 是实时仪表盘（边跑边看，跑完即弃）；
// Trace 是持久黑匣子（每次 run 落盘，事后可回放、可定位"哪一步开始错"）。
//
// 设计：不动 lib/types.ts 里现有的 AgentEvent。TraceEntry 是"事件 + 快照"
// 的一层包装，通过包装 onEvent 回调接入，引擎（agent.ts）零改动。
//
// 每条 TraceEntry 多带四样定位信息：
//   seq   全局递增，决定顺序
//   runId 本次 run 唯一 id（多会话/并发/重试不串）
//   ts    墙钟时间
//   turn  当前第几轮（由 turn_start 事件自动跟踪）
//
// 落盘格式：JSONL，每行一个 JSON 对象。第一行是 trace_start 元信息，
// 中间是 TraceEntry，最后一行是 trace_end。回放时跳过没有 event 字段的行。
// ============================================================

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent } from "./types";

export type TraceSnapshot = {
  contextTokens?: number;
  model?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  errorStack?: string;
};

export type TraceEntry = {
  seq: number;
  runId: string;
  ts: number;
  turn?: number;
  event: AgentEvent;
  snapshot?: TraceSnapshot;
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
    readonly startedAt: number,
    private readonly filePath: string,
  ) {}

  static create(dir: string, model: string): TraceRecorder {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const random = Math.random().toString(36).slice(2, 8);
    const runId = `run_${stamp}_${random}`;
    return new TraceRecorder(runId, model, Date.now(), join(dir, `${runId}.jsonl`));
  }

  /** 初始化：确保目录存在，写一条 trace_start 元信息 */
  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.appendLine({
      type: "trace_start",
      runId: this.runId,
      model: this.model,
      ts: this.startedAt,
    });
  }

  /** 记录一个事件：先入内存（供前端/返回值用），再按序落盘（黑匣子） */
  record(event: AgentEvent, snapshot?: TraceSnapshot): void {
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
      ...(snapshot ? { snapshot } : {}),
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

/** 回放：读一个轨迹文件，只取其中的 TraceEntry（跳过 start/end 元信息行） */
export async function readTrace(filePath: string): Promise<TraceEntry[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEntry & { type?: string })
    .filter((entry): entry is TraceEntry => entry.type === undefined && "event" in entry);
}
