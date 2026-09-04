"use client";

// ============================================================
// run-store.ts —— 多会话 run 状态的 zustand store（B22，2026-09-02）
// ============================================================
// session-owner 架构：run 状态归会话（runs: sessionId → RunState 桶），
// UI 只投影。原 use-agent-run 的 useState 集合 + send/applyFrame 逻辑
// 搬到这：store 持有桶 + 编排消费循环，组件（use-agent-run 投影层 /
// 会话列表行）只按需订阅自己的桶。
//
// 关键设计（对齐 DSH session-projection 三方分离 + opencode run 串行）：
//   - 桶是纯数据：怎么变全在 run-fold.ts 的纯折叠里（本文件没有折叠逻辑）
//   - 一个 run = 一个独立 readStream 消费循环，闭包捕获自己的 sessionId，
//     帧只 foldRunFrame 写自己的桶 → 天然隔离，不需要 abort 也不需要校验
//   - set 只替换当前桶：`{ ...state.runs, [sessionId]: next }` —— 其他会话的
//     桶引用不变 → 它们的订阅不触发（zustand selector 天然保证，A 每帧
//     更新不重渲 B）
//   - 派生（runPhase/状态点）不落库：deriveRunPhase 每次渲染重算（对齐
//     task-panel show / B20"状态派生从运行时移到 CSS"精神）
//
// 一会话一 run（loading 禁发送）：行业共识（opencode 同 key run join
// 不并行、pi followUp 排队）——用户"多线程开发"指多会话并行，不是
// 一会话内并发。
// ============================================================

import { create } from "zustand";
import type { AgentMessage, SessionStats, TodoItem } from "@/lib/types";
import type { ContextPressure } from "@/app/lib/context-occupancy";
import {
  approveTool,
  answerUserQuestion,
  executeCommand,
  fetchHistory,
  sendMessage,
  stopRun,
} from "@/app/services/chat";
import {
  EMPTY_RUN,
  applyCommandResult,
  applyHistory,
  deriveRunPhase,
  foldRunFrame,
  freshRun,
  type RunPhase,
  type RunState,
} from "./run-fold";
import { readStream, type StreamFrame } from "./sse";

// 在跑流的 abort 句柄（sessionId → controller）：不进 store state——
// controller 是运行时句柄不是 UI 状态，放 state 会让订阅误触发。
const activeAborts = new Map<string, AbortController>();
// 已删会话标记：hydrate 在途时删了会话，返回后不复活桶
// （sessionId 全局唯一 s_时间戳-随机，不会与新建会话重名）
const deletedSessions = new Set<string>();

export type RunStore = {
  /** sessionId → 桶。冷会话（从未跑过/刷新后）没有桶，用 EMPTY_RUN 兜底投影 */
  runs: Record<string, RunState>;
  /** 发消息：建桶 → SSE 消费循环 → 逐帧 foldRunFrame（一会话一 run） */
  startRun: (sessionId: string, text: string) => Promise<void>;
  /** 停止当前会话的 run：POST /stop（服务端中止模型请求 + 杀命令进程树） */
  stopRun: (sessionId: string, runId: string) => Promise<void>;
  /** 拉历史落桶（applyHistory）。只在桶不存在时由 hydrateIfMissing 调用 */
  hydrate: (sessionId: string) => Promise<void>;
  /** 冷会话补齐：桶不存在才 hydrate（桶在跑/有结果 → 跳过，实时流接上） */
  hydrateIfMissing: (sessionId: string) => Promise<void>;
  /** 删会话：abort 在跑流 + 删桶（流后续帧到达时桶已无 → 丢弃） */
  deleteRun: (sessionId: string) => void;
  /** 斜杠命令（C13）：执行 + 拉历史回填（不走模型） */
  runCommand: (sessionId: string, line: string) => Promise<boolean>;
  /** 写错误横幅文案（C13 命令面板未知命令复用） */
  setError: (sessionId: string, message: string) => void;
  /** 回传挂起工具确认的决定（审批卡属于桶——切走再切回，卡还在） */
  approve: (
    sessionId: string,
    decision: { allow: boolean; session?: boolean; persist?: boolean },
  ) => Promise<void>;
  /** 回传挂起模型提问的回答（A4，空数组 = 全部跳过） */
  answerAsk: (sessionId: string, answers: string[]) => Promise<void>;
};

/** 只替换一个桶（其他桶引用不变 → 订阅不触发）。桶已删则原样返回 */
function replaceRun(
  state: { runs: Record<string, RunState> },
  sessionId: string,
  next: RunState,
): { runs: Record<string, RunState> } {
  if (!(sessionId in state.runs)) return state;
  return { runs: { ...state.runs, [sessionId]: next } };
}

export const useRunStore = create<RunStore>()((set, get) => ({
  runs: {},

  startRun: async (sessionId, text) => {
    // 一会话一 run：loading 中禁发送（与其他会话并行不冲突）
    if (!sessionId || !text.trim()) return;
    if (get().runs[sessionId]?.loading) return;

    // 建桶起点：freshRun 保留会话内容（messages 跨 run 延续）、清 run 瞬态
    set((state) =>
      replaceRun(state, sessionId, {
        ...freshRun(state.runs[sessionId]),
        loading: true,
      }),
    );

    // 每个 run 一个 controller：删除会话时 abort 断流（不等服务端关流）
    const controller = new AbortController();
    activeAborts.set(sessionId, controller);

    try {
      const res = await sendMessage(
        { text: text.trim(), sessionId },
        { signal: controller.signal },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("当前浏览器不支持流式响应");

      // 消费循环：闭包只捕获 sessionId——帧永远只写自己的桶。
      // foldRunFrame 在 set 函数式里取最新桶（避免 get 与 set 竞态）
      await readStream(
        res.body,
        (frame: StreamFrame) => {
          set((state) => {
            const prev = state.runs[sessionId];
            if (!prev) return state; // 桶已被删除 → 丢弃后续帧
            return replaceRun(state, sessionId, foldRunFrame(prev, frame));
          });
        },
        { signal: controller.signal },
      );
    } catch (e) {
      // 主动删除/停止导致的 abort 不算错误（用户意图，不是 run 失败）
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message;
      set((state) => {
        const prev = state.runs[sessionId];
        if (!prev) return state;
        // 保持原 run-fold 语义：错误文案 + compacting 复位（error 帧同款）；
        // loading 由 finally 收尾
        return replaceRun(state, sessionId, { ...prev, error: msg, compacting: false });
      });
    } finally {
      activeAborts.delete(sessionId);
      // 流结束（done/error/abort/网络断）：loading 收尾。
      // done/error 帧已把 lastOutcome 写好，这里只负责熄灯
      set((state) => {
        const prev = state.runs[sessionId];
        if (!prev) return state;
        return replaceRun(state, sessionId, { ...prev, loading: false });
      });
    }
  },

  stopRun: async (sessionId, runId) => {
    // 只 POST /stop，不 abort 本地流——服务端停止是【受控收尾】
    // （stop/route.ts：引擎 return 半截档案，done 帧照发，含 contextPressure /
    // stats / todos 权威值）。本地流要等这帧 done 到达才收尾：
    //   ① 占用/统计随 done 更新（若 abort 本地，done 被掐断 → 圆环不刷新）
    //   ② loading 由消费循环 finally 熄灭
    // abort 本地只留给 deleteRun（桶都没了，流自然无用）
    try {
      await stopRun({ runId });
    } catch {
      // 停止失败不阻塞（run 可能刚好结束了）
    }
  },

  hydrate: async (sessionId) => {
    if (!sessionId) return;
    try {
      const data = await fetchHistory(sessionId);
      // 无桶才建：已有桶（竞态——刚 startRun / 并发 hydrate / 切回在跑会话）
      // 不覆盖，让在跑的继续（done 帧是权威值，历史快照不该盖它）
      set((state) => {
        if (state.runs[sessionId]) return state;
        if (deletedSessions.has(sessionId)) return state; // 已删，不复活
        return {
          runs: { ...state.runs, [sessionId]: applyHistory(EMPTY_RUN, data) },
        };
      });
    } catch (e) {
      // 历史拉不到：页面从空开始（留痕便于排查，不打扰 UI）
      console.warn("拉取会话历史失败", (e as Error).message, sessionId);
    }
  },

  hydrateIfMissing: async (sessionId) => {
    // 桶存在（在跑/跑完/已 hydrate）→ 跳过：切回实时流/看结果直接投影
    if (!sessionId || get().runs[sessionId]) return;
    await get().hydrate(sessionId);
  },

  deleteRun: (sessionId) => {
    activeAborts.get(sessionId)?.abort();
    activeAborts.delete(sessionId);
    deletedSessions.add(sessionId);
    set((state) => {
      if (!(sessionId in state.runs)) return state;
      const { [sessionId]: _gone, ...rest } = state.runs;
      return { runs: rest };
    });
  },

  runCommand: async (sessionId, line) => {
    if (!sessionId) return false;
    const prev = get().runs[sessionId] ?? EMPTY_RUN;
    if (prev.loading || prev.commandRunning) return false;

    // 命令面板执行中：先置位（输入框禁用、消息流末尾显示"正在执行"）
    set((state) =>
      replaceRun(state, sessionId, {
        ...prev,
        error: "",
        commandFeedback: "",
        commandRunning: true,
      }),
    );

    try {
      const { result } = await executeCommand({ line, sessionId });
      // 命令落盘了会话：重新拉历史（/compact 压缩卡片从 buildContext 渲染）
      const history = await fetchHistory(sessionId);
      set((state) => {
        const cur = state.runs[sessionId];
        if (!cur) return state; // 执行中删了会话 → 丢弃
        // 消息条数变化 = 真的压了（摘要替换旧消息）→ 卡片是反馈，不显示文案
        const changed = history.messages.length !== cur.messages.length;
        return replaceRun(
          state,
          sessionId,
          applyCommandResult(cur, {
            messages: history.messages,
            stats: history.stats,
            todos: history.todos ?? [],
            contextPressure: history.contextPressure,
            feedback: changed ? "" : (result.text ?? ""),
          }),
        );
      });
      return result.kind === "success";
    } catch (e) {
      const msg = (e as Error).message;
      set((state) => {
        const cur = state.runs[sessionId];
        if (!cur) return state;
        return replaceRun(state, sessionId, {
          ...cur,
          commandFeedback: `命令执行失败：${msg}`,
          commandRunning: false,
        });
      });
      return false;
    } finally {
      // 成功路径的 commandRunning 复位：applyCommandResult 不改它，
      // 这里统一收尾（幂等：没在跑的桶不会重复置位）
      set((state) => {
        const cur = state.runs[sessionId];
        if (!cur || !cur.commandRunning) return state;
        return replaceRun(state, sessionId, { ...cur, commandRunning: false });
      });
    }
  },

  setError: (sessionId, message) => {
    set((state) => {
      const prev = state.runs[sessionId];
      if (!prev) return state;
      return replaceRun(state, sessionId, { ...prev, error: message });
    });
  },

  approve: async (sessionId, decision) => {
    const pending = get().runs[sessionId]?.pendingApproval;
    if (!pending) return;
    // 立即关掉弹框；服务端那边 resolve 后引擎继续
    set((state) => {
      const prev = state.runs[sessionId];
      if (!prev) return state;
      return replaceRun(state, sessionId, { ...prev, pendingApproval: null });
    });
    try {
      await approveTool({ toolCallId: pending.toolCallId, ...decision, sessionId });
    } catch {
      // 404 = 已超时/已处理，无需处理
    }
  },

  answerAsk: async (sessionId, answers) => {
    const pending = get().runs[sessionId]?.pendingAsk;
    if (!pending) return;
    set((state) => {
      const prev = state.runs[sessionId];
      if (!prev) return state;
      return replaceRun(state, sessionId, { ...prev, pendingAsk: null });
    });
    try {
      await answerUserQuestion({ toolCallId: pending.toolCallId, answers });
    } catch (e) {
      // 404 = 服务端没有这个挂起提问（已超时 / 或 ask-user 路由未加载）。
      console.warn("回传提问回答失败", (e as Error).message, pending.toolCallId);
    }
  },
}));

// ---- 投影订阅 hooks（组件用，不直接碰 store 内部） ----

/** 只订当前会话的桶（冷会话 → EMPTY_RUN 兜底）。use-agent-run 投影层用 */
export function useSessionRun(sessionId: string): RunState {
  return useRunStore((s) => s.runs[sessionId] ?? EMPTY_RUN);
}

/**
 * 会话 run 阶段（状态点/决策区用）。极轻 selector：deriveRunPhase 返回
 * 一个小字符串，桶每帧更新时 phase 不变 → 订阅不重渲（列表 A 每帧刷新
 * 时只有 A 行的 selector 变，B 行/无状态点行不重渲）。
 */
export function useSessionRunPhase(sessionId: string): RunPhase {
  return useRunStore((s) => deriveRunPhase(s.runs[sessionId] ?? EMPTY_RUN));
}
