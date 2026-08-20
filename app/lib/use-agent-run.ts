"use client";

// ============================================================
// useAgentRun —— 一次 run 的观测状态编排（自定义 Hook）
// ============================================================
//
// 把「消息、事件、loading、runId、模型名」这些状态，和它们的行为
// （send / reset / applyFrame）收进一个 Hook。页面组件（page.tsx）
// 只管组合，不再关心请求怎么发、帧怎么消费、历史怎么恢复。
//
// 注意：输入框的 text 不在这里（它是表单状态，留在页面组件），
// send 接收外部传入的文本；页面负责清空输入框。
// ============================================================

import { useCallback, useEffect, useState } from "react";
import type { AgentMessage } from "@/lib/types";
import { appendDelta, replaceLast } from "./messages";
import { readStream, type ObservedEvent, type StreamFrame } from "./sse";

export function useAgentRun() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [observed, setObserved] = useState<ObservedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [model, setModel] = useState("");

  // 挂载时拉取会话历史：刷新页面也能恢复多轮对话（Phase 1 单会话，固定 default）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 消费一帧 SSE：run 帧记元信息；event 帧进时间线并按事件类型更新转录稿；
  // done 帧用全量历史整体替换；error 帧记错误。
  const applyFrame = useCallback((frame: StreamFrame) => {
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
  }, []);

  // 发送：校验 + 请求 + 逐帧消费。text 由页面传入，页面负责清空输入框。
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setLoading(true);
      setError("");
      // 不清空 messages：历史来自挂载时的 GET + 本次事件流的追加，多轮对话得以保留
      setObserved([]);
      setRunId("");
      setModel("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
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
    },
    [loading, applyFrame],
  );

  // 清空：先清服务端会话，再清本地——只清本地的话，刷新后历史会从 GET 接口"复活"
  const reset = useCallback(async () => {
    try {
      await fetch("/api/chat", { method: "DELETE" });
    } catch {
      // 网络失败也继续清本地，不阻塞用户
    }
    setMessages([]);
    setObserved([]);
    setError("");
    setRunId("");
    setModel("");
  }, []);

  return { messages, observed, loading, error, runId, model, send, reset };
}
