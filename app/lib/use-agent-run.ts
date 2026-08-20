"use client";

// ============================================================
// useAgentRun —— 一次 run 的观测状态编排（自定义 Hook）
// ============================================================
//
// 把「消息、事件、loading、runId、模型名」这些状态，和它们的行为
// （send / reset / applyFrame）收进一个 Hook。页面组件（page.tsx）
// 只管组合，不再关心请求怎么发、帧怎么消费、历史怎么恢复。
//
// 注意：
//   - 输入框的 text 不在这里（它是表单状态，留在页面组件），
//     send 接收外部传入的文本；页面负责清空输入框。
//   - Phase 2 多会话：hook 接收 sessionId（来自 useSessions 的 currentId）。
//     sessionId 变化 = 切换会话：清空本地状态 → 拉新会话历史。
// ============================================================

import { useCallback, useEffect, useState } from "react";
import type { AgentMessage, SessionStats } from "@/lib/types";
import { appendDelta, replaceLast } from "./messages";
import { readStream, type ObservedEvent, type StreamFrame } from "./sse";

// 空会话的统计（读接口失败/清空后的兜底）
const ZERO_STATS: SessionStats = { turns: 0, tools: 0, tokens: 0 };

export function useAgentRun(sessionId: string) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [observed, setObserved] = useState<ObservedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [model, setModel] = useState("");
  // 会话级累计统计（读数盘）：随历史接口和 done 帧一起更新，不自己算
  const [stats, setStats] = useState<SessionStats>(ZERO_STATS);

  // 会话历史：挂载时 / sessionId 变化时触发。
  // 先清空本地（避免上一会话的消息残留），再拉新会话的历史（刷新不丢）。
  useEffect(() => {
    setMessages([]);
    setObserved([]);
    setError("");
    setRunId("");
    setModel("");
    setStats(ZERO_STATS);
    if (!sessionId) return;

    let cancelled = false;
    fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
        setStats(data.stats ?? ZERO_STATS);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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
      setStats(frame.stats);
    } else if (frame.type === "error") {
      setError(frame.message);
    }
  }, []);

  // 发送：校验 + 请求 + 逐帧消费。text 由页面传入，页面负责清空输入框。
  const send = useCallback(
    async (text: string) => {
      if (!sessionId || !text.trim() || loading) return;
      setLoading(true);
      setError("");
      // 不清空 messages：历史来自会话历史 + 本次事件流的追加，多轮对话得以保留
      setObserved([]);
      setRunId("");
      setModel("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim(), sessionId }),
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
    [sessionId, loading, applyFrame],
  );

  // 清空当前会话：先清服务端，再清本地——只清本地的话，刷新后历史会复活
  const reset = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        });
      } catch {
        // 网络失败也继续清本地，不阻塞用户
      }
    }
    setMessages([]);
    setObserved([]);
    setError("");
    setRunId("");
    setModel("");
    setStats(ZERO_STATS);
  }, [sessionId]);

  return { messages, observed, loading, error, runId, model, send, reset, stats };
}
