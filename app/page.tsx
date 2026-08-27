"use client";

// ============================================================
// 页面 —— 观测台的「组装层」
// ============================================================
// 它本身不含业务逻辑，只做三件事：
//   1. 调 useAgentRun() 拿状态和行为（消息、事件、loading、发送、清空）
//   2. 派生展示数据（phase / turn / rows 三个纯函数）
//   3. 组合组件（Nameplate / Overture / MessageRow / TraceRail…）
//
// 样式：组件样式跟组件走（components/<组件>/<组件>.module.css）；
// 页面自己的布局（对话面容器 + 指令台 + 错误横幅）在 ./page.module.css；
// 骨架与设计令牌在 ./globals.css（全局层）。
//
// ── 调用地图：页面调用的每个东西是什么、在哪、干什么 ──
//   useSessions()   app/lib/use-sessions.ts
//                   Phase 2 多会话：会话列表 + 当前会话 id。返回
//                   { sessions, currentId, select, create, rename, remove }。
//                   页面把 currentId 传给 useAgentRun —— 切换会话 = 换 id。
//   useAgentRun()   app/lib/use-agent-run.ts
//                   run 的全部状态 + 行为。内部封装了 fetch POST /api/chat、
//                   readStream 逐帧消费、会话历史 GET 恢复。
//                   返回 { messages, observed, loading, error, runId, model,
//                          send(text), stats }。
//                   （2026-08-26：reset 已删——清空会话功能移除，
//                    见 nameplate 头注释）
//   foldEvents()    app/lib/trace-fold.ts（纯函数）
//                   把原始 AgentEvent 流折叠成记录条行：连续 message_update
//                   收成一条墨线、工具 start/end 配成一段跨度（105 条事件
//                   实测塌成 2 行），结果喂给 <TraceRail> 渲染。
//   derivePhase()   本文件底部（纯函数）—— 根据最近一条事件推断状态灯相位
//   currentTurn()   本文件底部（纯函数）—— 从 turn_start 事件数出当前轮次
//   <Nameplate>     app/components/nameplate/ —— 页头：标志/标题/run 信息/
//                   状态灯/清空按钮
//   <SessionList>   app/components/session-list/ —— 左侧会话栏
//                   （列表 / 新建 / 行内重命名 / 删除）
//   <Overture>      app/components/overture/ —— 空态引导 + 例句按钮
//   <MessageRow>    app/components/message-row/ —— 转录稿单条消息
//                   （用户/Agent 文本/工具调用行/工具结果卡片）
//   <TraceRail>     app/components/trace-rail/ —— 右侧时间轴记录条
//                   （时间轴 + 底部轮次/工具/token 统计）
//   <ApprovalDialog> app/components/approval-dialog/ —— 写/改/删工具的
//                   人工确认弹框（允许/拒绝），配合 pendingApproval/approve
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { Nameplate, type Phase } from "./components/nameplate";
import { Overture } from "./components/overture";
import { MessageRow } from "./components/message-row";
import { TraceRail } from "./components/trace-rail";
import { SessionList } from "./components/session-list";
import { ApprovalDialog } from "./components/approval-dialog";
import { ApprovalModeSwitch } from "./components/approval-mode-switch";
import { TaskPanel } from "./components/task-panel";
import { AskUserCard } from "./components/ask-user-card";
import { useAgentRun } from "./lib/use-agent-run";
import { useSessions } from "./lib/use-sessions";
import { useStickyScroll } from "./lib/use-sticky-scroll";
import { foldEvents } from "./lib/trace-fold";
import type { ObservedEvent } from "./lib/sse";
import type { ApprovalMode } from "./services/chat/types";
import { getApprovalMode, setApprovalMode } from "./services/chat";

export default function Home() {
  // 会话栏（Phase 2）：列表 + 当前会话 id。currentId 传给 useAgentRun，
  // 切换会话 = 换 currentId，聊天区随之清空并加载对应历史。
  // refresh 额外用于"run 结束后列表保鲜"（见下方 loading 跳变 effect）
  const { sessions, currentId, select, create, rename, remove, refresh } =
    useSessions();

  // hook：一次 run 的观测状态和行为。页面从这里拿数据，不再自己发 fetch。
  //   messages  转录稿消息（当前会话历史 + 本次 run 新增）
  //   observed  带到达时间戳的事件流（右侧时间线的原始素材）
  //   loading   请求进行中（按钮禁用、状态灯判断都用它）
  //   error     请求/流式错误信息（显示在输入框上方横幅）
  //   runId     本次 run 的唯一 id（铭牌展示，来自 run 帧）
  //   model     本次用的模型名（铭牌展示）
  //   send(text)  发送一次 run：fetch → readStream 逐帧消费 → applyFrame
  //   stats       会话级累计统计（轮次/工具/token）：服务端从会话文件算出，
  //               切换会话/run 结束时更新，读数盘直接展示
  //   pendingApproval  挂起的工具确认（写/改/删弹框用）；approve(allow) 回传决定
  //   toolOutputs  bash 命令的实时输出（toolCallId → 文本）；stop(runId) 停止当前 run
  //   todos        任务清单（Phase 5）：模型 todo_write 更新，前端只读展示
  //   （2026-08-26：reset 已删——清空会话功能移除，见 nameplate 头注释）
  const {
    messages,
    observed,
    loading,
    error,
    runId,
    model,
    send,
    stats,
    pendingApproval,
    approve,
    pendingAsk,
    answerAsk,
    toolOutputs,
    todos,
    stop,
    compacting,
  } = useAgentRun(currentId);

  const [input, setInput] = useState("列出工作区文件"); // 输入框内容（表单状态留在页面，不进 hook）

  // 审批模式（B1-②）：页面挂载时读服务端当前值；切换调接口（运行时生效，
  // 重启恢复 config 默认）。参考项目都有此入口（pi /settings、DSH /permission）
  const [approvalMode, setApprovalModeState] = useState<ApprovalMode>("suggest");

  useEffect(() => {
    getApprovalMode()
      .then((r) => setApprovalModeState(r.mode))
      .catch(() => {
        /* 接口失败保持默认 suggest */
      });
  }, []);

  const switchApprovalMode = useCallback((mode: ApprovalMode) => {
    setApprovalMode(mode)
      .then(() => setApprovalModeState(mode))
      .catch(() => {
        /* 切换失败保持原状 */
      });
  }, []);
  const transcriptRef = useRef<HTMLDivElement>(null); // 转录稿容器，新消息到达时滚到底
  const traceRef = useRef<HTMLDivElement>(null); // 轨迹容器，新事件到达时滚到底
  const inputRef = useRef<HTMLTextAreaElement>(null); // 输入框，聚焦/自适应高度用

  // ---- 滚动跟随（吸底）----
  // 2026-08-26 修：原来每次 messages/observed 更新都强制 scrollToEnd——
  // 流式每来一个 delta 就把滚动轴拽到底，用户想翻上面的历史做不到。
  // 现在用 useStickyScroll 判定"用户是否停靠底部"：停靠才自动滚，
  // 用户滚上去看历史就停止跟随，滚回底部自动恢复（标准聊天 UX）。
  // 判定逻辑封装在 hook（阈值 48px 也在里面），这里只剩两行组装。
  const followTranscript = useStickyScroll(transcriptRef);
  const followTrace = useStickyScroll(traceRef);

  useEffect(() => {
    if (followTranscript) scrollToEnd(transcriptRef.current);
  }, [messages, followTranscript]);

  useEffect(() => {
    if (followTrace) scrollToEnd(traceRef.current);
  }, [observed, followTrace]);

  // 输入框随内容长高（上限由 CSS 的 max-height 兜住）
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [input]);

  // 列表保鲜（2026-08-26 修）：run 结束（loading true→false）后刷新会话列表。
  // 会话列表只在 挂载/新建/重命名/删除 时刷新，聊天后不刷 → 停在旧快照：
  // 新建会话聊完仍是"未命名会话 0 条"（消息数/预览/排序都不更新）。
  // 用 loading 跳变（而非 done 帧）判断：也覆盖出错/停止导致 run 结束的情况。
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refresh();
    }
    prevLoadingRef.current = loading;
  }, [loading, refresh]);

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
      {/* 页头：runId / 模型名 / 状态灯（清空按钮已删，见 nameplate 头注释）。
          停止按钮不在这：它在输入框旁（run 进行中发送按钮变身），见 console 区 */}
      <Nameplate runId={runId} model={model} phase={phase} turn={turn} />

      <div className="deck">
        {/* 左侧会话栏（Phase 2）：点击切换 / ＋新建 / ⋯ 重命名·删除 */}
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

        <main className={styles.stage}>
          <div className={styles.transcript} ref={transcriptRef}>
            <div className={styles.reel}>
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
              {/* 上下文压缩进行中（B2）：后端在调模型生成摘要，给用户明确反馈，
                  而不是让 transcript 停在原地像卡住 */}
              {compacting && (
                <div className={styles.compacting} role="status">
                  <span className={styles.compactingLabel}>上下文超出上限</span>
                  <span>正在压缩上下文，请稍候…</span>
                </div>
              )}
              {/* 待确认卡片（B1-④）已从消息流移到底部决策区（2026-08-26，
                  用户要求"像 askUser 悬浮在输入框位置"）——见下方 decisionBar */}
            </div>
          </div>

          {/* 审批模式切换（B1-②）：运行时切信任档位（建议/YOLO/禁止），
              参考项目都有此入口；默认 suggest 不动它即可 */}
          <div className={styles.modeBar}>
            <ApprovalModeSwitch
              mode={approvalMode}
              onChange={switchApprovalMode}
            />
          </div>

          {/* 任务面板（Phase 5）：钉在输入台上方，与输入框同列宽（830 居中）。
              只读展示（todo 唯一写者是模型）；头部常驻显示进度，展开看明细；
              sessionId 用于关闭状态按会话隔离（Reasonix 式，纯前端 localStorage） */}
          <div className={styles.todoBar}>
            <TaskPanel todos={todos} sessionId={currentId} />
          </div>

          {/* 错误横幅：提到提问卡/输入框之外，两种状态下都可见 */}
          {error && (
            <div className={styles.alarm} role="alert">
              <span className={styles.alarmTag}>运行失败</span>
              <span>{error}</span>
            </div>
          )}

          {/* 底部决策区三选一（Reasonix 式）：
              pendingApproval → 工具审批卡（用户决定允许/拒绝）
              pendingAsk      → 模型提问卡（用户逐题作答）
              否则 → 输入控制台
              "模型需要你"时，输入框隐藏，对应卡片占据输入框的位置——
              钉在底部永远可见，不用滚动去找（2026-08-26：审批卡从消息流
              挪到这里，与 askUser 同款）。共用 .decisionBar/.console 列宽 */}
          {pendingApproval ? (
            <div className={styles.decisionBar}>
              <ApprovalDialog request={pendingApproval} onApprove={approve} />
            </div>
          ) : pendingAsk ? (
            <div className={styles.decisionBar}>
              <AskUserCard ask={pendingAsk} onAnswer={answerAsk} />
            </div>
          ) : (
            <form
              className={styles.console}
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className={styles.consoleFrame}>
                <textarea
                  className={styles.consoleInput}
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
                {/* 发送按钮在 run 进行中「变身」为停止按钮：
                    位置永远不变（操作跟随视线），角色随 loading 切换。
                    stop 需要 runId（来自 SSE run 帧），未到时短暂不可点 */}
                {loading ? (
                  <button
                    className={styles.consoleStop}
                    type="button"
                    onClick={() => stop(runId)}
                    disabled={!runId}
                  >
                    停止
                  </button>
                ) : (
                  <button
                    className={styles.consoleSend}
                    type="submit"
                    disabled={!input.trim()}
                  >
                    发送
                  </button>
                )}
              </div>
              <p className={styles.consoleHint}>
                Enter 发送 · Shift + Enter 换行 · 每次发送开始新的一次 run
              </p>
            </form>
          )}
        </main>

        {/* 轨迹区：rows 是折叠后的行（时间轴），observed 用于耗时计算，
            stats 是会话级累计统计（读数盘，服务端算出） */}
        <TraceRail rows={rows} observed={observed} stats={stats} reelRef={traceRef} />
      </div>
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
