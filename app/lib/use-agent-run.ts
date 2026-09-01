"use client";

// ============================================================
// useAgentRun —— 一次 run 的观测状态编排（自定义 Hook）
// ============================================================
//
// 把「消息、事件、loading、runId、模型名」这些状态，和它们的行为
// （send / applyFrame）收进一个 Hook。页面组件（page.tsx）
// 只管组合，不再关心请求怎么发、帧怎么消费、历史怎么恢复。
//
// 注意：
//   - 输入框的 text 不在这里（它是表单状态，留在页面组件），
//     send 接收外部传入的文本；页面负责清空输入框。
//   - Phase 2 多会话：hook 接收 sessionId（来自 useSessions 的 currentId）。
//     sessionId 变化 = 切换会话：清空本地状态 → 拉新会话历史。
//   - 请求全部走 app/services 接口层，本文件不再直接 fetch：
//     fetchHistory / approveTool / stopRun / sendMessage
//   - 2026-08-26：reset（清空当前会话）已删——多会话下被「新建/删除」覆盖，
//     且它连确认弹框都没有（静默抹历史）。resetLocal 保留（切会话共用）。
//     服务端 DELETE /api/chat 与 services.clearHistory 保留，供未来斜杠命令复用。
// ============================================================

import { useCallback, useEffect, useState } from "react";
import type { AgentMessage, SessionStats, TodoItem } from "@/lib/types";
import type { AskQuestion } from "@/lib/tools/ask-user";
import type { ContextPressure } from "@/app/lib/context-occupancy";
import { appendDelta, replaceLast } from "./messages";
import { readStream, type ObservedEvent, type StreamFrame } from "./sse";
import {
  fetchHistory,
  approveTool,
  answerUserQuestion,
  stopRun,
  sendMessage,
  executeCommand,
} from "@/app/services/chat";

// 空会话的统计（读接口失败/清空后的兜底）
const ZERO_STATS: SessionStats = { turns: 0, tools: 0, tokens: 0 };

/** 一次挂起的工具确认（前端弹框内容） */
export type ToolApprovalRequest = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

/** 一次挂起的模型提问（A4）：前端逐题作答，全部答完后回传 /api/chat/ask-user */
export type PendingAsk = {
  toolCallId: string;
  questions: AskQuestion[];
};

export function useAgentRun(sessionId: string) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [observed, setObserved] = useState<ObservedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [model, setModel] = useState("");
  // 会话级累计统计（读数盘）：随历史接口和 done 帧一起更新，不自己算
  const [stats, setStats] = useState<SessionStats>(ZERO_STATS);
  // 挂起的工具确认：非 null 时前端要弹框，用户决定后回传 /api/chat/approve
  const [pendingApproval, setPendingApproval] =
    useState<ToolApprovalRequest | null>(null);
  // 挂起的模型提问（A4）：非 null 时前端弹提问卡片，用户回答后回传
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  // bash 命令的实时输出：toolCallId → 已累积的文本（tool_output 帧逐块追加）
  const [toolOutputs, setToolOutputs] = useState<Record<string, string>>({});
  // 任务清单（Phase 5）：来源 = GET 历史 todos（初始）+ tool_todo 帧（run 中）+ done 帧（最终）
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // 上下文压缩进行中（B2）：收到 compacting 帧置 true，done/error 复位
  const [compacting, setCompacting] = useState(false);
  // C13 命令执行反馈：结果文案（成功 text / "没有可压缩的历史" / 失败）/ 执行中状态。
  // 命令 API 成功返回 { result }，但前端要么刷新消息流（压了有卡片）、要么无变化
  // （无可压历史）——必须有一个可见反馈，否则"点了没反应"。
  const [commandFeedback, setCommandFeedback] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  // C13 上下文占用（ContextMeter 数据源）：来自 GET 历史 / done 帧 / 命令刷新
  const [contextPressure, setContextPressure] = useState<ContextPressure | undefined>(undefined);

  // 清空本地状态（不含服务端）：切会话共用同一份。
  // 从历史恢复 effect 里抽出来的公共逻辑——
  // 原来 reset() 也用它，reset 删除后它只服务切会话（行为一致）
  const resetLocal = useCallback(() => {
    setMessages([]);
    setObserved([]);
    setError("");
    setRunId("");
    setModel("");
    setStats(ZERO_STATS);
    setPendingApproval(null);
    setPendingAsk(null);
    setToolOutputs({});
    setTodos([]);
    setCompacting(false);
    setContextPressure(undefined);
  }, []);

  // 会话历史：挂载时 / sessionId 变化时触发。
  // 先清空本地（避免上一会话的消息残留），再拉新会话的历史（刷新不丢）。
  // AbortController：切会话/卸载时 abort() 取消请求，替代手写 cancelled 标志
  useEffect(() => {
    resetLocal();
    if (!sessionId) return;

    const controller = new AbortController();
    async function load() {
      try {
        const data = await fetchHistory(sessionId, {
          signal: controller.signal,
        });
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
        setStats(data.stats ?? ZERO_STATS);
        // 上下文占用恢复（C13 ContextMeter）：切会话后圆环归位
        if (data.contextPressure !== undefined) {
          setContextPressure(data.contextPressure);
        }
        // 任务清单恢复：刷新/切换会话后面板不丢（Phase 5）
        if (Array.isArray(data.todos)) {
          setTodos(data.todos);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // 切会话/卸载导致的取消
        // 其他失败：历史拉不到，页面从空开始（留痕便于排查，不打扰 UI）
        console.warn("拉取会话历史失败", e);
      }
    }
    load();
    return () => controller.abort();
  }, [sessionId, resetLocal]);

  // 消费一帧 SSE：按帧类型分派（switch + 可辨识联合，漏了新帧类型
  // TypeScript 会在 default 处报穷尽性提示，比 if-else 链更安全）
  const applyFrame = useCallback((frame: StreamFrame) => {
    switch (frame.type) {
      case "run":
        setRunId(frame.runId);
        setModel(frame.model);
        break;
      case "event": {
        const ev = frame.event;
        setObserved((prev) => [
          ...prev,
          { seq: prev.length + 1, at: Date.now(), event: ev },
        ]);
        // 事件内部再按消息事件分派；其他事件类型只进时间线，不碰转录稿
        switch (ev.type) {
          case "message_start":
            setMessages((prev) => [...prev, ev.message]);
            break;
          case "message_update":
            setMessages((prev) => appendDelta(prev, ev.delta));
            break;
          case "message_end":
            setMessages((prev) => replaceLast(prev, ev.message));
            break;
          default:
            break;
        }
        break;
      }
      case "done":
        setMessages(frame.messages);
        setRunId(frame.runId);
        setStats(frame.stats);
        // 上下文占用权威值（C13 ContextMeter）：run 结束 = 当前上下文占用
        setContextPressure(frame.contextPressure);
        // run 结束了：服务端不再有挂起的确认/提问（超时会自动处理），清掉弹框
        setPendingApproval(null);
        setPendingAsk(null);
        // 任务清单权威值（Phase 5）：tool_todo 帧只是过程更新，done 是最终
        setTodos(frame.todos);
        // 压缩已结束（done 是最后一个帧），复位 compacting 状态
        setCompacting(false);
        break;
      case "error":
        setError(frame.message);
        setCompacting(false); // 出错也复位，避免状态卡住
        break;
      case "tool_permission_request":
        // 写/改/删工具需要人工确认：交给页面弹框
        setPendingApproval({
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          args: frame.args,
        });
        break;
      case "tool_output":
        // bash 命令的流式输出：按 toolCallId 累积（同一次调用多次到达）
        setToolOutputs((prev) => ({
          ...prev,
          [frame.toolCallId]: (prev[frame.toolCallId] ?? "") + frame.text,
        }));
        break;
      case "tool_todo":
        // 任务清单实时更新（Phase 5）：模型整表替换后立刻刷新面板
        setTodos(frame.todos);
        break;
      case "ask_user_request":
        // 模型提问（A4）：交给页面逐题作答卡片
        setPendingAsk({
          toolCallId: frame.toolCallId,
          questions: frame.questions,
        });
        break;
      case "compacting":
        // 上下文压缩开始（B2）：后端调模型生成摘要，前端显示"正在压缩上下文"
        setCompacting(true);
        break;
      default:
        // StreamFrame 新增类型时，TS 会在这里提示漏了分支
        break;
    }
  }, []);

  // 回传用户对挂起确认的决定（B1-④：允许一次 / 本会话允许 / 一直允许 / 拒绝）。
  // 接口 404 = 已超时/已处理。
  // 注意：fetch 移出 setState updater（updater 理论上可能被调用两次，
  // 副作用不该放里面——React 反模式，Phase 3 遗留下来的）
  const approve = useCallback(
    async (decision: {
      allow: boolean;
      session?: boolean;
      persist?: boolean;
    }) => {
      if (!pendingApproval) return;
      const { toolCallId } = pendingApproval;
      setPendingApproval(null); // 立即关掉弹框；服务端那边 resolve 后引擎继续
      try {
        await approveTool({ toolCallId, ...decision, sessionId });
      } catch {
        // 404 = 已超时/已处理，无需处理
      }
    },
    [pendingApproval, sessionId],
  );

  // 回传用户对模型提问的回答（A4，多问题版）。空数组 = 全部跳过，服务端给"未回答"降级。
  const answerAsk = useCallback(
    async (answers: string[]) => {
      if (!pendingAsk) return;
      const { toolCallId } = pendingAsk;
      setPendingAsk(null); // 立即关掉卡片；服务端 resolve 后引擎继续
      try {
        await answerUserQuestion({ toolCallId, answers });
      } catch (e) {
        // 404 = 服务端没有这个挂起提问（已超时 / 或 ask-user 路由未加载）。
        // 静默会掩盖问题（用户只看到 60s 超时文案），这里留个警告便于排查。
        console.warn("回传提问回答失败", (e as Error).message, toolCallId);
      }
    },
    [pendingAsk],
  );

  // 停止当前 run：中止模型请求 + 杀死正在执行的命令（Phase 4 停止按钮）
  const stop = useCallback(async (targetRunId: string) => {
    try {
      await stopRun({ runId: targetRunId });
    } catch {
      // 停止失败不阻塞（run 可能刚好结束了）
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
      setToolOutputs({}); // 新 run 开始，清掉上一条命令的输出

      try {
        // sendMessage 是 SSE 流式接口（返回 Response，不走 api<T>）：
        // 必须拿到 res.body 交给 readStream 逐块消费
        const res = await sendMessage({ text: text.trim(), sessionId });

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

  // 执行一条斜杠命令（C13）：不走模型（DSH：without sending the command
  // to the model）。反馈规则（用户拍板 2026-09-01：保留一个）：
  //   - 消息流变了（压缩产生 compactionSummary 卡片）→ 卡片即反馈，不显示文案
  //   - 消息流没变（无可压历史/业务错误）→ 显示结果文案兜底
  // 执行中提示（commandRunning）也渲染在消息流末尾，不叠在输入框上。
  // @returns 命令是否【业务成功】（result.kind === "success"）——
  // C13 /export 门面：前端据它决定是否触发下载。业务失败（handler 返回
  // error，如"会话为空"）不能触发下载，所以不能用"没抛异常"当成功。
  const runCommand = useCallback(
    async (line: string): Promise<boolean> => {
      if (!sessionId || loading || commandRunning) return false;

      setError("");
      setCommandFeedback("");
      setCommandRunning(true);
      
      try {
        const { result } = await executeCommand({ line, sessionId });
        // 命令落盘了会话：重新拉历史（/compact 压缩卡片从 buildContext 渲染）
        const history = await fetchHistory(sessionId);
        
        setMessages(history.messages);
        setStats(history.stats);
        setTodos(history.todos ?? []);
        // 压缩后上下文回落：圆环归位（ContextMeter 的直观闭环）
        if (history.contextPressure !== undefined) {
          setContextPressure(history.contextPressure);
        }
        // 消息条数变化 = 真的压了（摘要替换了旧消息）→ 卡片是反馈，不显示文案
        const changed = history.messages.length !== messages.length;
        setCommandFeedback(changed ? "" : (result.text ?? ""));
        return result.kind === "success";
      } catch (e) {
        setCommandFeedback(`命令执行失败：${(e as Error).message}`);
        return false;
      } finally {
        setCommandRunning(false);
      }
    },
    [sessionId, loading, commandRunning, messages],
  );

  return {
    messages,
    observed,
    loading,
    error,
    setError, // C13：命令面板报错（未知命令）复用错误横幅
    runId,
    model,
    send,
    runCommand,
    commandFeedback,
    commandRunning,
    contextPressure,
    stats,
    pendingApproval,
    approve,
    pendingAsk,
    answerAsk,
    toolOutputs,
    todos,
    stop,
    compacting,
  };
}
