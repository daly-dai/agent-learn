"use client";

// ============================================================
// 前端 —— SSE 流式消费者 + Agent 观测台
// ============================================================
//
// 左边是「转录稿」：谁说了什么、调了什么工具、拿到什么结果。
// 右边是「走纸记录条」：同一次 run 被画成一条时间轴。
//
// 轨迹区不是日志列表，它做了三件聚合（都在 foldEvents 里）：
//   1. turn_start                  → 开一条轮次带 T1 / T2
//   2. 连续的 message_update        → 收成一笔墨迹（长度随字数增长）
//   3. tool_execution_start/end    → 配成一段跨度（条长 = 真实耗时）
//
// 为什么要给事件补 seq/at：AgentEvent 协议里没有时间戳（PLAN.md 第四节
// 说 Phase 0 才补）。前端作为「观测者」自己盖到达时间戳，不改协议就能
// 画出耗时与用时 —— 这是产品层的观测，不是引擎的职责。
// ============================================================

import { useState, useRef, useEffect } from "react";
import type {
  AgentMessage,
  AgentEvent,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
  ToolDefinition,
} from "@/lib/types";
import { Markdown } from "./markdown";

type StreamFrame =
  | { type: "run"; runId: string; model: string }
  | { type: "event"; event: AgentEvent }
  | { type: "done"; messages: AgentMessage[]; tools: ToolDefinition[]; runId: string }
  | { type: "error"; message: string };

/** 事件 + 前端观测到它的时刻（协议不动，时间戳加在这一层） */
type ObservedEvent = { seq: number; at: number; event: AgentEvent };

const PHASES = {
  idle: "待命",
  thinking: "思考中",
  tool: "执行工具",
  streaming: "输出中",
} as const;

type Phase = keyof typeof PHASES;

/** 空态里的起手式：每条都标注它会练到哪个工具（最后一条故意不需要工具） */
const SEEDS = [
  { text: "列出工作区文件", tool: "list_files" },
  { text: "读取 agent-notes.md", tool: "read_file" },
  { text: "把 Agent Loop 的要点写成笔记", tool: "write_note" },
  { text: "什么是 Agent Loop？", tool: "不调用工具，直接回答" },
];

/** 工具结果超过这个行数才默认折叠 */
const CLAMP_LINES = 12;

export default function Home() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [observed, setObserved] = useState<ObservedEvent[]>([]);
  const [input, setInput] = useState("列出工作区文件");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [model, setModel] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollToEnd(transcriptRef.current);
  }, [messages]);

  useEffect(() => {
    scrollToEnd(traceRef.current);
  }, [observed]);

  // 输入框随内容长高（上限由 CSS 的 max-height 兜住）
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [input]);

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    setError("");
    setMessages([]);
    setObserved([]);
    setRunId("");
    setModel("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("当前浏览器不支持流式响应");

      await readStream(res.body, applyFrame);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function applyFrame(frame: StreamFrame) {
    if (frame.type === "run") {
      setRunId(frame.runId);
      setModel(frame.model);
    } else if (frame.type === "event") {
      const ev = frame.event;
      setObserved((prev) => [
        ...prev,
        { seq: prev.length + 1, at: Date.now(), event: ev },
      ]);
      if (ev.type === "message_start") {
        setMessages((prev) => [...prev, ev.message]);
      } else if (ev.type === "message_update") {
        setMessages((prev) => appendDelta(prev, ev.delta));
      } else if (ev.type === "message_end") {
        setMessages((prev) => replaceLast(prev, ev.message));
      }
    } else if (frame.type === "done") {
      setMessages(frame.messages);
      setRunId(frame.runId);
    } else if (frame.type === "error") {
      setError(frame.message);
    }
  }

  function reset() {
    setMessages([]);
    setObserved([]);
    setError("");
    setRunId("");
    setModel("");
  }

  function pickSeed(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  const phase = derivePhase(observed, loading);
  const rows = foldEvents(observed);

  return (
    <div className="app">
      <Nameplate
        runId={runId}
        model={model}
        phase={phase}
        turn={currentTurn(observed)}
        onReset={reset}
        canReset={!loading && (messages.length > 0 || observed.length > 0)}
      />

      <div className="deck">
        <main className="stage">
          <div className="transcript" ref={transcriptRef}>
            <div className="reel">
              {messages.length === 0 ? (
                <Overture onPick={pickSeed} />
              ) : (
                messages.map((msg, i) => (
                  <MessageRow
                    key={`${msg.role}-${msg.timestamp}-${i}`}
                    message={msg}
                    attached={i > 0 && msg.role === "toolResult"}
                    live={loading && i === messages.length - 1}
                  />
                ))
              )}
            </div>
          </div>

          <form
            className="console"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            {error && (
              <div className="alarm" role="alert">
                <span className="alarm-tag">运行失败</span>
                <span>{error}</span>
              </div>
            )}

            <div className="console-frame">
              <textarea
                className="console-input"
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  if (e.nativeEvent.isComposing) return; // 中文输入法选词时的回车不算发送
                  e.preventDefault();
                  send();
                }}
                placeholder="给它一个目标，例如：读取 agent-notes.md 并总结要点"
                disabled={loading}
                autoFocus
              />
              <button
                className="console-send"
                type="submit"
                disabled={loading || !input.trim()}
              >
                发送
              </button>
            </div>
            <p className="console-hint">
              Enter 发送 · Shift + Enter 换行 · 每次发送开始新的一次 run
            </p>
          </form>
        </main>

        <TraceRail rows={rows} observed={observed} reelRef={traceRef} />
      </div>
    </div>
  );
}

// ============ 铭牌 ============

type NameplateProps = {
  runId: string;
  model: string;
  phase: Phase;
  turn: number;
  canReset: boolean;
  onReset: () => void;
};

function Nameplate({ runId, model, phase, turn, canReset, onReset }: NameplateProps) {
  return (
    <header className="nameplate">
      <PenMark />
      <span className="wordmark">Teaching Agent</span>
      <span className="plate-rule" />
      <span className="wordmark-cn">观测台</span>

      <div className="plate-right">
        {runId && (
          <span className="readout-run" title={`run ${runId} · ${model}`}>
            <span className="model">{model}</span>
            <span className="plate-rule" />
            <span className="run">run {shortId(runId)}</span>
          </span>
        )}
        <StatusBeacon phase={phase} turn={turn} />
        <button className="btn" onClick={onReset} disabled={!canReset}>
          清空记录
        </button>
      </div>
    </header>
  );
}

/** 标志：一段笔迹。它和轨迹区画的是同一件事 */
function PenMark() {
  return (
    <svg className="mark" width="21" height="21" viewBox="0 0 21 21" aria-hidden="true">
      <path
        d="M1.5 14.5H5L7.5 6l3 10.5L13 10l2 2h4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusBeacon({ phase, turn }: { phase: Phase; turn: number }) {
  return (
    <span className={`beacon beacon-${phase}`}>
      <span className="beacon-lens" />
      <span className="beacon-label">{PHASES[phase]}</span>
      {turn > 0 && <span className="beacon-turn">T{turn}</span>}
    </span>
  );
}

// ============ 转录稿 ============

function Overture({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="overture">
      <p className="overture-eyebrow">单轮运行 · 尚无会话记忆</p>
      <h1 className="overture-title">
        给它一个目标，看它怎么一步步做完。
      </h1>
      <p className="overture-note">
        每次发送开始一次新的 run。右边的记录条会同步画出这次 run 的全过程：
        分成几轮、调了哪些工具、每步花了多久。
      </p>
      <div className="seed-grid">
        {SEEDS.map((seed) => (
          <button
            key={seed.text}
            className="seed"
            type="button"
            onClick={() => onPick(seed.text)}
          >
            <span className="seed-text">{seed.text}</span>
            <span className="seed-tool">{seed.tool}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type MessageRowProps = { message: AgentMessage; attached: boolean; live: boolean };

function MessageRow({ message, attached, live }: MessageRowProps) {
  if (message.role === "user") {
    return (
      <Row tone="user" role="你" timestamp={message.timestamp}>
        <div className="said">
          {message.content.map((block, i) => (
            <Markdown key={i}>{block.text}</Markdown>
          ))}
        </div>
      </Row>
    );
  }

  if (message.role === "assistant") {
    return (
      <Row tone="agent" role="Agent" timestamp={message.timestamp}>
        <div className={`reply${live ? " is-live" : ""}`}>
          {message.content.map((block, i) =>
            block.type === "toolCall" ? (
              <ToolCallLine key={i} block={block} />
            ) : (
              <Markdown key={i}>{block.text}</Markdown>
            ),
          )}
          {/* 首个 token 还没到：给一行明确的等待态，而不是留一块空白 */}
          {live && message.content.length === 0 && (
            <span className="pondering">思考中</span>
          )}
        </div>
      </Row>
    );
  }

  return (
    <Row tone="tool" attached={attached}>
      <ToolOutput message={message} />
    </Row>
  );
}

type RowProps = {
  tone: string;
  role?: string;
  timestamp?: number;
  attached?: boolean;
  children: React.ReactNode;
};

function Row({ tone, role, timestamp, attached, children }: RowProps) {
  return (
    <article className={`row row-${tone}${attached ? " is-attached" : ""}`}>
      <div className="row-gutter">
        {role ? (
          <>
            <span className="row-role">{role}</span>
            <span className="row-time">{formatClock(timestamp)}</span>
          </>
        ) : (
          // 工具结果没有独立身份：它属于上一条消息，用连接符表示从属
          <span className="row-link" aria-hidden="true">
            ↳
          </span>
        )}
      </div>
      <div className="row-body">{children}</div>
    </article>
  );
}

function ToolCallLine({ block }: { block: ToolCallContent }) {
  return (
    <div className="call">
      <span className="call-tag">CALL</span>
      <span className="call-name">{block.name}</span>
      <code className="call-args">{JSON.stringify(block.arguments)}</code>
    </div>
  );
}

/** 工具结果：默认只露出开头，长输出不该淹掉对话 */
function ToolOutput({ message }: { message: ToolResultMessage }) {
  const text = message.content.map((block) => block.text).join("\n");
  const lines = text.split("\n").length;
  const [expanded, setExpanded] = useState(lines <= CLAMP_LINES);
  const clamped = !expanded && lines > CLAMP_LINES;

  return (
    <div
      className={[
        "apparatus",
        message.isError ? "apparatus-error" : "",
        clamped ? "apparatus-clamped" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="apparatus-head">
        <span className="apparatus-name">{message.toolName}</span>
        <span className="apparatus-verdict">
          {message.isError ? "✗ 失败" : "✓ 成功"}
        </span>
        <span className="apparatus-meta">{lines} 行</span>
        {lines > CLAMP_LINES && (
          <button
            className="apparatus-toggle"
            type="button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : `展开 ${lines} 行`}
          </button>
        )}
      </div>
      <div className="apparatus-body">
        <pre className="tool-output">{text}</pre>
      </div>
    </div>
  );
}

// ============ 轨迹区（走纸记录条） ============

type TraceRailProps = {
  rows: TraceRow[];
  observed: ObservedEvent[];
  reelRef: React.RefObject<HTMLDivElement | null>;
};

function TraceRail({ rows, observed, reelRef }: TraceRailProps) {
  const stats = traceStats(observed);

  return (
    <aside className="trace">
      <div className="trace-head">
        <span className="trace-title">Trace</span>
        <span className="trace-sub">运行记录</span>
        <span className="trace-clock">{formatElapsed(observed)}</span>
      </div>

      <div className="trace-reel" ref={reelRef}>
        {rows.length === 0 ? (
          <TraceLegend />
        ) : (
          <div className="trace-strip">
            {rows.map((row, i) => (
              <TraceRowView key={i} row={row} />
            ))}
          </div>
        )}
      </div>

      <div className="trace-foot">
        <Gauge value={stats.turns} label="轮次" />
        <Gauge value={stats.tools} label="工具调用" />
        <Gauge value={formatTokens(stats.tokens)} label="token" />
      </div>
    </aside>
  );
}

/** 空态里放读法说明：与其写「暂无事件」，不如先教会怎么看这张纸 */
function TraceLegend() {
  const keys = [
    { tone: "turn", text: "轮次分节 T1 / T2" },
    { tone: "model", text: "模型输出，长度随字数" },
    { tone: "tool", text: "工具执行，条长 = 耗时" },
    { tone: "signal", text: "运行信号与审批干预" },
  ];

  return (
    <div className="trace-empty">
      <p>发送指令后，这里会从上到下画出这次 run。</p>
      <div className="legend">
        {keys.map((key) => (
          <span key={key.tone} className={`legend-row legend-${key.tone}`}>
            <span className="legend-key" />
            {key.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function TraceRowView({ row }: { row: TraceRow }) {
  const cls = `trace-row pen-${row.pen}`;

  if (row.kind === "band") {
    return (
      <div className={`${cls} is-band`}>
        <span className="band-label">{row.label}</span>
        <span className="band-rule" />
      </div>
    );
  }

  if (row.kind === "stroke") {
    return (
      <div className={cls}>
        <div className={`stroke${row.live ? " is-live" : ""}`}>
          <span className="stroke-label">{row.label}</span>
          <span className="stroke-ink" style={{ width: inkWidth(row.size) }} />
          <span className="stroke-note">{row.note}</span>
        </div>
      </div>
    );
  }

  if (row.kind === "span") {
    return (
      <div className={cls}>
        <div className={`span${row.live ? " is-running" : ""}`}>
          <span className="span-name">{row.label}</span>
          <span className="span-bar" style={{ width: barWidth(row.size) }} />
          <span className="span-note">
            {row.live ? "运行中" : formatMs(row.size)}
          </span>
          {!row.live && (
            <span className={row.ok ? "span-ok" : "span-bad"}>
              {row.ok ? "✓" : "✗"}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cls}>
      <div className="signal">
        <span className="signal-strong">{row.label}</span>
        {row.note && <span>{row.note}</span>}
      </div>
    </div>
  );
}

function Gauge({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="gauge">
      <span className="gauge-value">{value}</span>
      <span className="gauge-label">{label}</span>
    </span>
  );
}

// ============ 流读取 ============

/** 逐块读 SSE，按空行切帧 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 2);
      if (!raw.startsWith("data:")) continue;
      onFrame(JSON.parse(raw.slice(5).trim()) as StreamFrame);
    }
  }
}

// ============ 消息辅助 ============

function appendDelta(messages: AgentMessage[], delta: string): AgentMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (!last || last.role !== "assistant") return next;

  const content = [...last.content];
  const lastBlock = content[content.length - 1];
  if (lastBlock && lastBlock.type === "text") {
    content[content.length - 1] = { ...lastBlock, text: lastBlock.text + delta };
  } else {
    content.push({ type: "text", text: delta });
  }

  next[next.length - 1] = { ...last, content };
  return next;
}

function replaceLast(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
  if (messages.length === 0) return messages;
  const next = [...messages];
  next[next.length - 1] = message;
  return next;
}

function scrollToEnd(box: HTMLDivElement | null) {
  box?.scrollTo(0, box.scrollHeight);
}

// ============ 状态推导 ============

function derivePhase(observed: ObservedEvent[], loading: boolean): Phase {
  if (!loading) return "idle";
  const last = observed[observed.length - 1]?.event;
  if (last?.type === "tool_execution_start" || last?.type === "tool_execution_end") {
    return "tool";
  }
  if (last?.type === "message_update") return "streaming";
  return "thinking";
}

function currentTurn(observed: ObservedEvent[]): number {
  let turn = 0;
  for (const { event } of observed) {
    if (event.type === "turn_start") turn = event.turn;
  }
  return turn;
}

function traceStats(observed: ObservedEvent[]) {
  let turns = 0;
  let tools = 0;
  let tokens = 0;

  for (const { event } of observed) {
    if (event.type === "turn_start") turns = event.turn;
    if (event.type === "tool_execution_end") tools += 1;
    if (event.type === "message_end" && event.message.role === "assistant") {
      tokens += event.message.usage.totalTokens;
    }
  }

  return { turns, tools, tokens };
}

// ============ 事件 → 记录行 ============

type TraceRow = {
  pen: "turn" | "user" | "model" | "tool" | "signal" | "error";
  kind: "band" | "stroke" | "span" | "signal";
  label: string;
  note?: string;
  size?: number; // stroke 用字数，span 用毫秒
  live?: boolean;
  ok?: boolean;
  callId?: string;
  startedAt?: number;
};

function foldEvents(observed: ObservedEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const item of observed) foldOne(rows, item);
  return rows;
}

function foldOne(rows: TraceRow[], item: ObservedEvent): void {
  const event = item.event;

  switch (event.type) {
    case "agent_start":
      rows.push(signal("RUN 开始"));
      break;
    case "agent_end":
      rows.push(signal("RUN 结束", `${event.messages.length} 条消息`));
      break;
    case "turn_start":
      rows.push({ pen: "turn", kind: "band", label: `T${event.turn}` });
      break;
    case "message_start":
      foldMessageStart(rows, item);
      break;
    case "message_update":
      bumpStroke(rows, event.delta.length);
      break;
    case "message_end":
      sealStroke(rows, item);
      break;
    case "tool_execution_start":
      rows.push(openSpan(event.toolName, event.toolCallId, item.at));
      break;
    case "tool_execution_end":
      closeSpan(rows, event.toolCallId, event.isError, item.at);
      break;
    case "tool_permission":
      foldPermission(rows, event);
      break;
    case "compaction":
      rows.push(signal("上下文压缩", `${event.tokensBefore} tokens`));
      break;
    case "turn_end":
      break; // 轮次的收尾信息已由带内各行表达，不再单独记一行
  }
}

function signal(label: string, note?: string): TraceRow {
  return { pen: "signal", kind: "signal", label, note };
}

/** 用户消息进轨迹（模型消息交给墨迹行，工具结果交给跨度行） */
function foldMessageStart(rows: TraceRow[], item: ObservedEvent): void {
  if (item.event.type !== "message_start") return;
  const message = item.event.message;
  if (message.role !== "user") return;

  const chars = message.content.reduce((sum, block) => sum + block.text.length, 0);
  rows.push({ pen: "user", kind: "signal", label: "指令", note: `${chars} 字` });
}

/** 连续的流式增量只占一行，长度随字数增长 —— 一支笔画出的一条线 */
function bumpStroke(rows: TraceRow[], chars: number): void {
  const last = rows[rows.length - 1];
  if (last?.kind === "stroke" && last.live) {
    last.size = (last.size ?? 0) + chars;
    last.note = `${last.size} 字`;
    return;
  }
  rows.push({ pen: "model", kind: "stroke", label: "输出", size: chars, live: true, note: `${chars} 字` });
}

/** 模型消息收尾：给这一笔标上 token 用量；非流式模型在这里补出整笔 */
function sealStroke(rows: TraceRow[], item: ObservedEvent): void {
  if (item.event.type !== "message_end") return;
  const message = item.event.message;
  if (message.role !== "assistant") return;

  const last = rows[rows.length - 1];
  const tokens = `${message.usage.totalTokens} tok`;

  if (last?.kind === "stroke" && last.live) {
    last.live = false;
    last.note = `${last.size ?? 0} 字 · ${tokens}`;
    return;
  }

  const chars = textLength(message.content);
  rows.push({ pen: "model", kind: "stroke", label: "输出", size: chars, note: `${chars} 字 · ${tokens}` });
}

function openSpan(toolName: string, callId: string, at: number): TraceRow {
  return {
    pen: "tool",
    kind: "span",
    label: toolName,
    callId,
    startedAt: at,
    live: true,
  };
}

/** 用 toolCallId 把 end 配回它的 start，两条事件合成一段有长度的跨度 */
function closeSpan(rows: TraceRow[], callId: string, isError: boolean, at: number): void {
  const span = [...rows].reverse().find((row) => row.callId === callId && row.live);
  if (!span) return;

  span.live = false;
  span.ok = !isError;
  span.size = at - (span.startedAt ?? at);
}

/** 只记「有干预」的审批：放行是默认路径，记下来只会淹掉真正的信号 */
function foldPermission(
  rows: TraceRow[],
  event: Extract<AgentEvent, { type: "tool_permission" }>,
): void {
  if (event.action === "allow") return;

  const label = event.action === "block" ? "审批拦截" : "参数改写";
  const note = [event.toolName, event.reason].filter(Boolean).join(" · ");
  rows.push({
    pen: event.action === "block" ? "error" : "signal",
    kind: "signal",
    label,
    note,
  });
}

// ============ 格式化 ============

function textLength(content: Array<TextContent | ToolCallContent>): number {
  return content.reduce(
    (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
    0,
  );
}

function inkWidth(chars = 0): string {
  return `${Math.min(96, 8 + chars / 6)}px`;
}

function barWidth(ms = 0): string {
  return `${Math.min(92, 12 + ms / 20)}px`;
}

function formatMs(ms = 0): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

function formatElapsed(observed: ObservedEvent[]): string {
  if (observed.length < 2) return "—";
  return formatMs(observed[observed.length - 1].at - observed[0].at);
}

function formatClock(timestamp?: number): string {
  if (!timestamp) return "";
  const time = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
