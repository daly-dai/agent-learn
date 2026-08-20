"use client";

// ============================================================
// 页面 —— 观测台的「组装层」
// ============================================================
// 它本身不含业务逻辑，只做三件事：
//   1. 调 useAgentRun() 拿状态和行为（消息、事件、loading、发送、清空）
//   2. 派生展示数据（phase / turn / rows 三个纯函数）
//   3. 组合四个组件（Nameplate / Overture / MessageRow / TraceRail）
//
// ── 调用地图：页面调用的每个东西是什么、在哪、干什么 ──
//   useSessions()   app/lib/use-sessions.ts
//                   Phase 2 多会话：会话列表 + 当前会话 id。返回
//                   { sessions, currentId, select, create, rename, remove }。
//                   页面把 currentId 传给 useAgentRun —— 切换会话 = 换 id。
//   useAgentRun()   app/lib/use-agent-run.ts
//                   run 的全部状态 + 行为。内部封装了 fetch POST /api/chat、
//                   readStream 逐帧消费、会话历史 GET 恢复、DELETE 清空。
//                   返回 { messages, observed, loading, error, runId, model,
//                          send(text), reset(), stats }。
//   foldEvents()    app/lib/trace-fold.ts（纯函数）
//                   把原始 AgentEvent 流折叠成记录条行：连续 message_update
//                   收成一笔墨迹、工具 start/end 配成一段跨度（105 条事件
//                   实测塌成 2 行），结果喂给 <TraceRail> 渲染。
//   derivePhase()   本文件底部（纯函数）—— 根据最近一条事件推断状态灯相位
//   currentTurn()   本文件底部（纯函数）—— 从 turn_start 事件数出当前轮次
//   <SessionList>   app/components/session-list.tsx —— 左侧会话栏
//                   （列表 / 新建 / 行内重命名 / 删除）
//   <Nameplate>     app/components/nameplate.tsx —— 页头：标志/标题/run 信息/
//                   状态灯/清空按钮
//   <Overture>      app/components/overture.tsx —— 空态引导 + 例句按钮
//   <SessionList>   app/components/session-list.tsx —— 左侧会话栏
//                   （列表 / 新建 / 行内重命名 / 删除）
//   <ApprovalDialog> app/components/approval-dialog.tsx —— 写/改/删工具的
//                   人工确认弹框（允许/拒绝），配合 pendingApproval/approve
//   <Nameplate>     app/components/nameplate.tsx —— 页头：标志/标题/run 信息/
//                   状态灯/清空按钮
//   <Overture>      app/components/overture.tsx —— 空态引导 + 例句按钮
//   <MessageRow>    app/components/message-row.tsx —— 转录稿单条消息
//                   （用户/Agent 文本/工具调用行/工具结果卡片）
//   <TraceRail>     app/components/trace-rail.tsx —— 右侧走纸记录条
//                   （时间轴 + 底部轮次/工具/token 统计）
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Nameplate, type Phase } from "./components/nameplate";
import { Overture } from "./components/overture";
import { MessageRow } from "./components/message-row";
import { TraceRail } from "./components/trace-rail";
import { SessionList } from "./components/session-list";
import { ApprovalDialog } from "./components/approval-dialog";
import { useAgentRun } from "./lib/use-agent-run";
import { useSessions } from "./lib/use-sessions";
import { foldEvents } from "./lib/trace-fold";
import type { ObservedEvent } from "./lib/sse";

export default function Home() {
  // 会话栏（Phase 2）：列表 + 当前会话 id。currentId 传给 useAgentRun，
  // 切换会话 = 换 currentId，聊天区随之清空并加载对应历史。
  const { sessions, currentId, select, create, rename, remove } = useSessions();

  // hook：一次 run 的观测状态和行为。页面从这里拿数据，不再自己发 fetch。
  //   messages  转录稿消息（当前会话历史 + 本次 run 新增）
  //   observed  带到达时间戳的事件流（右侧时间线的原始素材）
  //   loading   请求进行中（按钮禁用、状态灯判断都用它）
  //   error     请求/流式错误信息（显示在输入框上方横幅）
  //   runId     本次 run 的唯一 id（铭牌展示，来自 run 帧）
  //   model     本次用的模型名（铭牌展示）
  //   send(text)  发送一次 run：fetch → readStream 逐帧消费 → applyFrame
  //   reset()     清空当前会话：先 DELETE /api/chat（清服务端 JSONL），再清本地
  //   stats       会话级累计统计（轮次/工具/token）：服务端从会话文件算出，
  //               切换会话/run 结束时更新，读数盘直接展示
  //   pendingApproval  挂起的工具确认（写/改/删弹框用）；approve(allow) 回传决定
  //   toolOutputs  bash 命令的实时输出（toolCallId → 文本）；stop(runId) 停止当前 run
  const {
    messages,
    observed,
    loading,
    error,
    runId,
    model,
    send,
    reset,
    stats,
    pendingApproval,
    approve,
    toolOutputs,
    stop,
  } = useAgentRun(currentId);

  const [input, setInput] = useState("列出工作区文件"); // 输入框内容（表单状态留在页面，不进 hook）
  const transcriptRef = useRef<HTMLDivElement>(null); // 转录稿容器，新消息到达时滚到底
  const traceRef = useRef<HTMLDivElement>(null); // 轨迹容器，新事件到达时滚到底
  const inputRef = useRef<HTMLTextAreaElement>(null); // 输入框，聚焦/自适应高度用

  // 两个滚动效果：messages / observed 更新时把对应面板滚到底部
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

  // 发送入口（表单提交 / 回车都走这里）：
  // 页面负责「校验非空 + 清空输入框」，真正的请求交给 hook 的 send(text)
  function submit() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    send(text);
  }

  // 点空态例句：把文案填进输入框并聚焦（不直接发送，用户可再改）
  function pickSeed(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  // 派生展示数据（都是纯函数，不改状态）：
  //   phase  状态灯相位（待命/思考中/执行工具/输出中）—— 看最近一条事件推断
  //   turn   当前进行到第几轮 —— 从 turn_start 事件数出来
  //   rows   事件流折叠后的记录条行 —— 给 <TraceRail> 画时间轴
  const phase = derivePhase(observed, loading);
  const turn = currentTurn(observed);
  const rows = foldEvents(observed);

  return (
    <div className="app">
      {/* 页头：runId / 模型名 / 状态灯 / 清空按钮。canReset 在非加载且有内容时可点 */}
      <Nameplate
        runId={runId}
        model={model}
        phase={phase}
        turn={turn}
        onReset={reset}
        canReset={!loading && (messages.length > 0 || observed.length > 0)}
        canStop={loading && Boolean(runId)}
        onStop={() => {
          stop(runId);
        }}
      />

      <div className="deck">
        {/* 左侧会话栏（Phase 2）：点击切换 / ＋新建 / ✎重命名 / ×删除 */}
        <SessionList
          sessions={sessions}
          currentId={currentId}
          onSelect={select}
          onCreate={() => {
            create();
          }}
          onRename={(id, title) => {
            rename(id, title);
          }}
          onDelete={(id) => {
            remove(id);
          }}
        />

        <main className="stage">
          <div className="transcript" ref={transcriptRef}>
            <div className="reel">
              {/* 空态 → 起手式引导；有消息 → 逐条渲染。
                  attached：工具结果行从属于上一条消息（视觉上缩进连接）
                  live：最后一条且正在加载 → 流式增长动画 + 思考中占位 */}
              {messages.length === 0 ? (
                <Overture onPick={pickSeed} />
              ) : (
                messages.map((msg, i) => (
                  <MessageRow
                    key={`${msg.role}-${msg.timestamp}-${i}`}
                    message={msg}
                    attached={i > 0 && msg.role === "toolResult"}
                    live={loading && i === messages.length - 1}
                    toolOutputs={toolOutputs}
                  />
                ))
              )}
            </div>
          </div>

          {/* 输入控制台：提交走 submit()；错误横幅显示在输入框上方 */}
          <form
            className="console"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
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
                  // 回车发送；Shift+Enter 换行；中文输入法选词时的回车不算发送
                  if (e.key !== "Enter" || e.shiftKey) return;
                  if (e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  submit();
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

        {/* 轨迹区：rows 是折叠后的行（时间轴），observed 用于耗时计算，
            stats 是会话级累计统计（读数盘，服务端算出） */}
        <TraceRail rows={rows} observed={observed} stats={stats} reelRef={traceRef} />
      </div>

      {/* 写/改/删工具的人工确认弹框（Phase 3）：pendingApproval 非空时弹出 */}
      <ApprovalDialog request={pendingApproval} onApprove={approve} />
    </div>
  );
}

// ============ 状态推导（纯函数，跟着页面走） ============

// 状态灯相位：加载中才显示；看最近一条事件——
//   工具执行 → "执行工具"；流式增量 → "输出中"；否则 → "思考中"
function derivePhase(observed: ObservedEvent[], loading: boolean): Phase {
  if (!loading) return "idle";
  const last = observed[observed.length - 1]?.event;
  if (last?.type === "tool_execution_start" || last?.type === "tool_execution_end") {
    return "tool";
  }
  if (last?.type === "message_update") return "streaming";
  return "thinking";
}

// 当前轮次：事件流里最后一个 turn_start 的 turn 值
function currentTurn(observed: ObservedEvent[]): number {
  let turn = 0;
  for (const { event } of observed) {
    if (event.type === "turn_start") turn = event.turn;
  }
  return turn;
}

function scrollToEnd(box: HTMLDivElement | null) {
  box?.scrollTo(0, box.scrollHeight);
}
