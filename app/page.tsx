"use client";

// ============================================================
// 前端 —— SSE 流式消费者（使用端）
// ============================================================
//
// 这里演示「使用端如何实时接收 Agent 事件」的浏览器一侧：
//   - 用 fetch + ReadableStream 逐块读取 /api/chat 返回的 SSE 流
//   - 每收到一帧 { type: "event" }，就把它追加进右侧 Event Timeline
//   - 收到 message_start 时，实时把消息追加进聊天区（边跑边显示）
//   - 收到 { type: "done" } 时，用最终权威消息列表覆盖，并结束 loading
//
// 对比改造前：以前是 fetch 一次性等整个 JSON 回来，再一次性 setSession。
// 现在事件一产生就渲染，这就是"边跑边看"的流式体验。
// ============================================================

import { useState, useRef, useEffect } from "react";
import type {
  AgentMessage,
  AgentEvent,
  TextContent,
  ToolCallContent,
  ToolDefinition,
} from "@/lib/types";

// 与 route.ts 的 StreamFrame 保持一致的帧类型
type StreamFrame =
  | { type: "run"; runId: string; model: string }
  | { type: "event"; event: AgentEvent }
  | { type: "done"; messages: AgentMessage[]; tools: ToolDefinition[]; runId: string }
  | { type: "error"; message: string };

export default function Home() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [input, setInput] = useState("列出工作区文件");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [model, setModel] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // 消息列表变化时自动滚到底部（实时跟随最新一条）
  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    setError("");
    // 新一轮开始，清空上一轮的消息和事件
    setMessages([]);
    setEvents([]);
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

      // 逐块读取 SSE 流
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件之间用 "\n\n" 分隔；buffer 里可能还剩半条，留到下一轮
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const frame = JSON.parse(line.slice(5).trim()) as StreamFrame;
          applyFrame(frame);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 处理每一帧：run → 记元信息；event → 追加；done → 权威覆盖；error → 报错
  function applyFrame(frame: StreamFrame) {
    if (frame.type === "run") {
      setRunId(frame.runId);
      setModel(frame.model);
    } else if (frame.type === "event") {
      const ev = frame.event;
      // 每条事件都追加进时间线
      setEvents((prev) => [...prev, ev]);
      // message_start 携带完整消息 → 实时追加进聊天区。
      // 注意：本教学版模型一次性返回完整消息，所以 message_start 已含全文；
      // 真实 token 流式场景下，应改成在 message_update 里累加 delta 文本。
      if (ev.type === "message_start") {
        setMessages((prev) => [...prev, ev.message]);
      }
    } else if (frame.type === "done") {
      // 用最终权威结果覆盖（会去掉实时累加过程中任何重复/临时状态）
      setMessages(frame.messages);
      setRunId(frame.runId);
    } else if (frame.type === "error") {
      setError(frame.message);
    }
  }

  function reset() {
    setMessages([]);
    setEvents([]);
    setError("");
  }

  const eventSummary = summarizeEvents(events);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, height: "100vh", display: "flex", gap: 12 }}>
      {/* 主聊天区 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h1 style={{ fontSize: 16, margin: 0, flex: 1 }}>🤖 Teaching Agent</h1>
          <button onClick={reset} disabled={loading} style={{ fontSize: 12, padding: "4px 8px" }}>
            重置
          </button>
        </div>

        {runId && (
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontFamily: "monospace" }}>
            🎯 run: <code>{runId}</code> · model: <code>{model}</code>
          </div>
        )}

        <div
          ref={listRef}
          style={{ flex: 1, overflow: "auto", border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 8, background: "#fafafa" }}
        >
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", color: "#999", padding: 40 }}>
              <p>输入一个目标，观察 Agent 如何调用工具并回答。</p>
              <p style={{ fontSize: 12 }}>试试：列出工作区文件 / 读取 agent-notes.md / 写笔记</p>
            </div>
          ) : (
            messages.map((msg, i) => <MessageCard key={`${msg.role}-${msg.timestamp}-${i}`} message={msg} />)
          )}
          {loading && <div style={{ color: "#888", fontSize: 13 }}>Agent 思考中...</div>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="试试：读取 agent-notes.md"
            disabled={loading}
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
          />
          <button onClick={send} disabled={loading || !input.trim()} style={{ padding: "8px 16px", cursor: "pointer" }}>
            发送
          </button>
        </div>
        {error && <div style={{ color: "red", fontSize: 12, marginTop: 4 }}>❌ {error}</div>}
      </div>

      {/* 侧边栏：事件时间线（实时追加，边跑边看） */}
      <div style={{ width: 220, flexShrink: 0, border: "1px solid #e5e5e5", borderRadius: 8, padding: 8, overflow: "auto", background: "#fafafa" }}>
        <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>📋 Event Timeline</h2>
        {eventSummary.length === 0 ? (
          <div style={{ color: "#999", fontSize: 11 }}>暂无事件</div>
        ) : (
          eventSummary.map((summary, i) => (
            <div key={i} style={{ fontSize: 11, padding: "2px 0", borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
              {summary}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- 消息卡片 ---

function MessageCard({ message }: { message: AgentMessage }) {
  const roleColor =
    message.role === "user" ? "#2563eb" :
    message.role === "assistant" ? "#16a34a" :
    message.role === "toolResult" ? (message.isError ? "#dc2626" : "#9333ea") : "#666";

  return (
    <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fff", borderRadius: 6, border: "1px solid #eee" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: roleColor, marginBottom: 4 }}>
        {message.role === "toolResult" ? `🔧 tool:${message.toolName}${message.isError ? " ❌" : ""}` : message.role}
      </div>
      <div>
        {message.role === "assistant" ? (
          message.content.map((block, i) =>
            block.type === "toolCall" ? (
              <ToolCallBlock key={i} block={block} />
            ) : (
              <div key={i} style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{(block as TextContent).text}</div>
            ),
          )
        ) : (
          message.content.map((block, i) => (
            <div key={i} style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{(block as TextContent).text}</div>
          ))
        )}
      </div>
    </div>
  );
}

function ToolCallBlock({ block }: { block: ToolCallContent }) {
  return (
    <div style={{ padding: "6px 8px", margin: "4px 0", background: "#f0fdf4", borderRadius: 4, border: "1px solid #bbf7d0", fontSize: 12 }}>
      🔨 <strong>{block.name}</strong>
      <code style={{ marginLeft: 8, color: "#666" }}>{JSON.stringify(block.arguments)}</code>
    </div>
  );
}

// --- 事件摘要 ---

function summarizeEvents(events: AgentEvent[]): string[] {
  return events.slice(-60).map((event) => {
    const type = event.type;
    switch (type) {
      case "agent_start": return "▶ agent_start";
      case "agent_end": return `■ agent_end (${event.messages.length} msgs)`;
      case "turn_start": return `  turn ${event.turn} start`;
      case "turn_end": return `  turn ${event.turn} end`;
      case "message_start": return `  + ${event.message.role}`;
      case "message_end": return `  - ${event.message.role}`;
      case "message_update": return `    ↳ "${event.delta.slice(0, 40)}"`;
      case "tool_execution_start": return `  ⚡ ${event.toolName} start`;
      case "tool_execution_end": return `  ⚡ ${event.toolName} ${event.isError ? "fail" : "done"}`;
      case "tool_permission": return `  🔒 ${event.action} ${event.toolName}`;
      case "compaction": return `  📦 compaction (${event.tokensBefore} tokens)`;
      default: {
        // 穷尽性检查：新增事件类型但这里没处理时，TS 会报错提醒
        const _: never = type;
        return _;
      }
    }
  });
}
