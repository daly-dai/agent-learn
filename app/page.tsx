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
//   useTraces()     app/lib/use-traces.ts（A3）
//                   拉某个会话的轨迹文件（列表 → 按同序逐个 run）→ foldTrace
//                   折叠 → buildTraceView 排层次，交给 <TraceViewer> 渲染。
//                   （旧的 trace-rail + trace-fold 留在仓库作回滚，页面不再渲染）
//   derivePhase()   本文件底部（纯函数）—— 根据最近一条事件推断状态灯相位
//   currentTurn()   本文件底部（纯函数）—— 从 turn_start 事件数出当前轮次
//   <Nameplate>     app/components/nameplate/ —— 页头：标志/标题/run 信息/
//                   状态灯/清空按钮
//   <SessionList>   app/components/session-list/ —— 左侧会话栏
//                   （列表 / 新建 / 行内重命名 / 删除）
//   <Overture>      app/components/overture/ —— 空态引导 + 例句按钮
//   <MessageRow>    app/components/message-row/ —— 转录稿单条消息
//                   （用户/Agent 文本/工具调用行/工具结果卡片）
//   <TraceViewer>   app/components/trace-viewer/ —— 轨迹 tab：竖轴记录表
//                   （A3；顶部 tab 与它一起把原来的右侧轨迹栏收进了中间）
//   <ApprovalDialog> app/components/approval-dialog/ —— 写/改/删工具的
//                   人工确认弹框（允许/拒绝），配合 pendingApproval/approve
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { Nameplate, type Phase } from "./components/nameplate";
import { Overture } from "./components/overture";
import { MessageRow } from "./components/message-row";
import { TraceViewer } from "./components/trace-viewer";
import { SessionList } from "./components/session-list";
import { ApprovalDialog } from "./components/approval-dialog";
import { ApprovalModeSwitch } from "./components/approval-mode-switch";
import { TaskPanel } from "./components/task-panel";
import { AskUserCard } from "./components/ask-user-card";
import { CommandMenu } from "./components/command-menu";
import { ContextMeter } from "./components/context-meter";
import { useAgentRun } from "./lib/use-agent-run";
import { useRunStore } from "./lib/run-store";
import { useCommandMenu } from "./lib/use-command-menu";
import { useSessions } from "./lib/use-sessions";
import { useStickyScroll } from "./lib/use-sticky-scroll";
import { useTraces } from "./lib/use-traces";
import { formatTokens } from "./lib/format";
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
  //   stats       会话级累计统计（轮次 / 工具 / token 数，服务端从会话文件算出）
  //               A3 起显示在输入台底栏（原先长在 <TraceRail> 底部）
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
    runCommand,
    commandFeedback,
    commandRunning,
    contextPressure,
    setError,
  } = useAgentRun(currentId);

  // 输入控制台 + 命令面板（C13 拆出）：input 状态/快照/过滤/键盘导航/
  // pick/submit 的命令分支全在 hook 里，页面只接线（use-command-menu.ts）。
  const {
    input,
    setInput,
    inputRef,
    commandMenuOpen,
    commandActiveIndex,
    setCommandActiveIndex,
    commandMenuRef,
    filteredCommands,
    handleInputChange,
    handleKeyDown,
    handleBlur,
    pickCommand,
    submit,
  } = useCommandMenu({
    onRunCommand: runCommand,
    onSend: send,
    onError: setError,
    sessionId: currentId,
    disabled: loading,
  });

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

  // ---- 滚动跟随（吸底）----
  // 2026-08-26 修：原来每次 messages/observed 更新都强制 scrollToEnd——
  // 流式每来一个 delta 就把滚动轴拽到底，用户想翻上面的历史做不到。
  // 现在用 useStickyScroll 判定"用户是否停靠底部"：停靠才自动滚，
  // 用户滚上去看历史就停止跟随，滚回底部自动恢复（标准聊天 UX）。
  // 判定逻辑封装在 hook（阈值 48px 也在里面），这里只剩两行组装。
  // （轨迹那一份跟随随 <TraceRail> 一起搬进了 <TraceViewer>——它自己持有
  //   滚动容器，自己用同一个 hook，页面不必再管。）
  const followTranscript = useStickyScroll(transcriptRef);

  useEffect(() => {
    if (followTranscript) scrollToEnd(transcriptRef.current);
  }, [messages, followTranscript]);

  // 列表保鲜（2026-08-26 修，2026-09-02 B22 升级）：
  // 会话列表只在 挂载/新建/重命名/删除 时刷新，聊天后不刷 → 停在旧快照：
  // 会话跑完仍是旧预览/旧时间。B22 前用「当前会话 loading 跳变」判断——
  // 只覆盖前台会话；B22 多会话并行后，后台会话跑完当前页面无感。
  // 现在订阅 store：任一会话桶 run 结束（loading true→false，含 done/error/
  // 停止/网络断）或命令执行完 → refresh。刷新幂等，多触发只是多一次 GET。
  const prevCommandRunningRef = useRef(commandRunning);
  useEffect(() => {
    if (prevCommandRunningRef.current && !commandRunning) {
      refresh(); // 命令改写了会话文件（/clear 清空、/compact 压缩）→ 列表保鲜
    }
    prevCommandRunningRef.current = commandRunning;
  }, [commandRunning, refresh]);

  useEffect(() => {
    // zustand subscribe：任何桶的 run 收尾（loading 熄灭）都刷新列表。
    // 为什么不用 done 帧事件：覆盖 error/停止/网络断等没有 done 帧的收尾
    return useRunStore.subscribe((state, prev) => {
      const anyRunEnded = Object.keys(state.runs).some((id) => {
        const was = prev.runs[id];
        const now = state.runs[id];
        return was?.loading === true && now?.loading === false;
      });
      if (anyRunEnded) refresh();
    });
  }, [refresh]);

  // 点空态例句：把文案填进输入框并聚焦（不直接发送，用户可再改）
  function pickSeed(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  // A3：顶部 tab（对话 / 轨迹）。轨迹只在 tab 打开时才拉数据——没打开就
  // 不请求（useTraces 的 enabled）；`live` 让它在本轮 run 进行中轮询，
  // run 一结束 effect 重跑，自动补一次完整加载。
  const [tab, setTab] = useState<"chat" | "trace">("chat");
  const traces = useTraces(currentId, {
    enabled: tab === "trace",
    live: loading,
  });

  // 派生展示数据（都是纯函数，不改状态；B17③：useMemo 只在依赖变时重算——
  // 否则每次渲染都全量重跑 derivePhase/currentTurn）：
  //   phase  状态灯相位（待命/思考中/执行工具/输出中）—— 看最近一条事件推断
  //   turn   当前进行到第几轮 —— 从 turn_start 事件数出来
  const phase = useMemo(() => derivePhase(observed, loading), [observed, loading]);
  const turn = useMemo(() => currentTurn(observed), [observed]);

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
            // B22：删会话 = 服务端删除 + 本地清桶（abort 在跑流，帧不再写）
            useRunStore.getState().deleteRun(id);
            remove(id);
          }}
        />

        <main className={styles.stage}>
          {/* A3 顶部 tab：对话 / 轨迹。指令台在 .stage 的最后一行，两个 tab
              共用它——切到轨迹也照样能发消息（B17④ 的常驻输入框）。 */}
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chat"}
              className={`${styles.tab}${tab === "chat" ? ` ${styles.tabOn}` : ""}`}
              onClick={() => setTab("chat")}
            >
              对话
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "trace"}
              className={`${styles.tab}${tab === "trace" ? ` ${styles.tabOn}` : ""}`}
              onClick={() => setTab("trace")}
            >
              轨迹
            </button>
          </div>

          {/* 两个 tab 共用同一个 1fr 槽位——所以这里必须二选一。
              代价：切走再回来，转录稿的滚动位置会丢（组件卸载了）。
              一期先接受；要保住就得两个都挂着用 visibility 藏，不值当。 */}
          {tab === "chat" ? (
          <div className={styles.transcript} ref={transcriptRef}>
            <div className={styles.reel}>
              {/* 空态 → 起手式引导；有消息 → 逐条渲染。
                  attached：工具结果行从属于上一条消息（视觉上缩进连接）
                  live：最后一条且正在加载 → 流式增长动画 + 思考中占位 */}
              {messages.length === 0 ? (
                <Overture onPick={pickSeed} />
              ) : (
                messages.map((msg, i) => {
                  // B17③：toolOutputs 只下发给"含 toolCall 的 assistant 行"。
                  // 为什么不能全量传：toolOutputs 是每帧新对象，MessageRow 又
                  // 是 memo 组件——若每行都收新引用，memo 浅比较全部失效，
                  // 流式就退回全树重渲。只有渲染 toolCall 的行才消费它
                  // （bash 实时输出挂在 ToolCallLine 下），其余行传 undefined。
                  const needsLiveOutput =
                    msg.role === "assistant" &&
                    msg.content.some((block) => block.type === "toolCall");
                  return (
                    <MessageRow
                      key={`${msg.role}-${msg.timestamp}-${i}`}
                      message={msg}
                      attached={i > 0 && msg.role === "toolResult"}
                      live={loading && i === messages.length - 1}
                      toolOutputs={needsLiveOutput ? toolOutputs : undefined}
                    />
                  );
                })
              )}
              {/* 上下文压缩进行中（B2）：后端在调模型生成摘要，给用户明确反馈，
                  而不是让 transcript 停在原地像卡住 */}
              {compacting && (
                <div className={styles.compacting} role="status">
                  <span className={styles.compactingLabel}>上下文超出上限</span>
                  <span>正在压缩上下文，请稍候…</span>
                </div>
              )}
              {/* C13 命令执行状态：渲染在消息流末尾（跟 compacting 同位置），
                  不叠在输入框上。执行中提示 / 无变化的兜底结果文案
                  （压缩成功时卡片即反馈，文案为空） */}
              {commandRunning && (
                <div className={styles.compacting} role="status">
                  <span className={styles.compactingLabel}>命令</span>
                  <span>正在执行，请稍候…</span>
                </div>
              )}
              {commandFeedback && (
                <div className={styles.compacting} role="status">
                  <span>{commandFeedback}</span>
                </div>
              )}
              {/* 待确认卡片（B1-④）已从消息流移到底部决策区（2026-08-26，
                  用户要求"像 askUser 悬浮在输入框位置"）——见下方 decisionBar */}
            </div>
          </div>
          ) : (
            <TraceViewer
              fold={traces.fold}
              runs={traces.runs}
              loading={traces.loading}
            />
          )}

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
              sessionId 用于关闭状态按会话隔离（Reasonix 式，纯前端 localStorage）。
              B17②：key={currentId} —— dismissed 是 useState 初始值，只在挂载时
              读 localStorage；切会话不重挂载会停留在旧会话的关闭标记（A 关了
              面板 B 也被藏掉）。key 变 = 强制重挂载 = 重新读。 */}
          <div className={styles.todoBar}>
            <TaskPanel key={currentId} todos={todos} sessionId={currentId} />
          </div>

          {/* 错误横幅：提到提问卡/输入框之外，两种状态下都可见 */}
          {error && (
            <div className={styles.alarm} role="alert">
              <span className={styles.alarmTag}>运行失败</span>
              <span>{error}</span>
            </div>
          )}

          {/* 底部决策区（B17④：输入框常驻 + 覆盖层，替换原三选一）。
              B17④ 动机：原结构 pendingApproval ? 审批卡 : pendingAsk ?
              提问卡 : 输入框——审批/提问出现时输入框整个卸载，卡关闭后
              重建 → 焦点/IME/滚动丢失（输入框虽是 loading 禁用的，命令
              面板也随 console 一起卸载）。
              改法：输入框永远在 DOM；审批/提问卡需要时文档流占位（视觉
              与改造前完全一致——卡片仍占决策区、上面内容被推挤），输入框
              absolute + visibility:hidden 藏起（DOM/ref 保留，卡关闭即恢复）。
              两卡天然互斥（串行 run 同时只会等一个请求）→ && 各自独立，
              无需优先级判断。 */}
          <div className={styles.decisionHost}>
            {pendingApproval && (
              <div className={styles.decisionBar}>
                <ApprovalDialog request={pendingApproval} onApprove={approve} />
              </div>
            )}
            {pendingAsk && (
              <div className={styles.decisionBar}>
                <AskUserCard ask={pendingAsk} onAnswer={answerAsk} />
              </div>
            )}
            <form
              className={`${styles.console}${
                pendingApproval || pendingAsk
                  ? ` ${styles.consoleCovered}`
                  : ""
              }`}
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className={styles.consoleFrame}>
                {/* C13 命令补全面板：贴输入框上方浮起；键盘导航在 textarea
                    onKeyDown 处理（焦点始终在输入框，只移高亮项）。
                    display:contents —— 包裹 div 不生成盒模型，不占 consoleFrame
                    grid 的子项位（否则 popup 会把两列布局撑成两行），
                    popup 的 absolute 定位祖先仍是 consoleFrame。 */}
                {commandMenuOpen && (
                  <div ref={commandMenuRef} className={styles.commandLayer}>
                    <CommandMenu
                      commands={filteredCommands}
                      activeIndex={commandActiveIndex}
                      onActiveChange={setCommandActiveIndex}
                      onPick={pickCommand}
                    />
                  </div>
                )}
                <textarea
                  className={styles.consoleInput}
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleBlur}
                  placeholder="给它一个目标，例如：读取 agent-notes.md 并总结要点"
                  disabled={loading}
                  autoFocus
                />
                {/* 上下文占用圆环（C13，抄 DSH ContextMeter）：发送按钮旁，
                    压缩后回落——占用感知的直观闭环 */}
                {/* 右侧控件组：圆环 + 发送/停止按钮。
                    必须包成一个 grid 子项（col2），否则圆环会当第三个
                    grid 子项把按钮挤到下一行（三级布局 bug，见 .consoleActions） */}
                <div className={styles.consoleActions}>
                  <ContextMeter pressure={contextPressure} />
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
              </div>
              {/* 输入台底栏（A3，参考 DSH）：左 = 会话级读数，右 = 操作提示。
                  读数原本长在 <TraceRail> 底部，轨迹栏下线后搬到这里——
                  这样"会话跑了多少"在任何 tab 下都看得见。 */}
              <div className={styles.statusBar}>
                <span className={styles.statusStats}>
                  {stats.turns} 轮 · {stats.tools} 工具 ·{" "}
                  {formatTokens(stats.tokens)} token
                </span>
                <span className={styles.statusHint}>
                  Enter 发送 · Shift + Enter 换行 · 每次发送开始新的一次 run
                </span>
              </div>
            </form>
          </div>
        </main>
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
