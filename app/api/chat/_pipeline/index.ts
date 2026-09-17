// ============================================================
// _pipeline/index.ts —— runPipeline 编排（E2 步骤 4）
// ============================================================
// 一次 POST 请求的"编排层"：按序调用各阶段文件。
//   - 1b 落盘用户消息 + 读上下文
//   - 1c 组装工具注册表
//   - 2  跑 Agent Loop（引擎）
//   - 2b 落盘本轮新消息
//   - 2c 可能压缩
//   - 3  推 done 权威结果
//
// 边界（为什么这些留 route 壳、不进这里）：
//   - send（SSE 帧推送）、abort、req.signal、finalizeRun → route 壳
//     （Next.js 特有的请求生命周期，不该进编排层）
//   - 本文件只"编排"，不碰 SSE 管道细节。
//   - 未来新阶段（C13 斜杠命令 → commands.ts、C14 @注入 → mentions.ts）
//     在这里按序插入，route 壳不动——这是"膨胀被结构挡住"的落点。
// ============================================================

import type { AgentMessage, ToolCallContent, UserMessage } from "@/lib/types";
import type { TeachingModel } from "@/lib/model";
import type { JsonlSessionStore } from "@/lib/session";
import type { TraceRecorder } from "@/lib/trace";
import { runAgentLoop, type ToolDecision } from "@/lib/agent";
import {
  loadSkills,
  buildSkillCatalog,
  renderSkillContent,
  findSkillInvocations,
  messageText,
  type Skill,
} from "@/lib";
import type { ToolContext } from "@/lib/tools";
import { config } from "@/lib/config";
import type { StreamFrame } from "./frames";
import { buildSystemPrompt } from "./prompt";
import { createPipelineTools } from "./tools";
import { maybeCompact } from "./compact";
import { askUserAnswer } from "./ask-user";
import { computeContextPressure } from "./context";

export type RunPipelineParams = {
  model: TeachingModel;
  userMessage: AgentMessage;
  store: JsonlSessionStore;
  // 轨迹记录器
  recorder: TraceRecorder;
  send: (frame: StreamFrame) => void;
  signal: AbortSignal;
  /**
   * 这次请求的环境（工作区根 + 技能根）：工具注册表与（T3 之后的）系统提示词共用它。
   * 由 route.ts 组装一次 —— 值与理由见 `lib/tools/index.ts` 的 `ToolContext`。
   */
  toolContext: ToolContext;
  /** 审批钩子（route 组装，含副作用：日志+弹框） */
  beforeToolCall: (call: ToolCallContent) => Promise<ToolDecision>;
};

// 运行整个 pipeline：用户消息 + 落盘 + Agent Loop + 压缩 + 推 done
export async function runPipeline(params: RunPipelineParams) {
  const {
    model,
    userMessage,
    store,
    recorder,
    send,
    signal,
    toolContext,
  } = params;

  // 1) 用户消息生命周期事件：既进 SSE（前端画气泡），也进轨迹（黑匣子）
  const userStart = { type: "message_start" as const, message: userMessage };
  const userEnd = { type: "message_end" as const, message: userMessage };

  // 轨迹记录器，记录用户消息开始事件
  recorder.record(userStart);
  // 发送用户消息开始事件
  send({ type: "event", event: userStart });
  // 轨迹记录器，记录用户消息结束事件
  recorder.record(userEnd);
  // 发送用户消息结束事件
  send({ type: "event", event: userEnd });

  // 1b) 技能根**每请求只扫这一遍**（C8）：手势注入与系统提示词清单共用这份结果。
  //     ⚠️ 必须在 `buildContext()` **之前** —— 上下文一旦读出来，再往 store 里追加就
  //     赶不上这一轮的请求体了；而"模型零工具调用"靠的正是正文已经在这一轮的上下文里。
  const { skills, diagnostics } = loadSkills(toolContext.skillsRoot);
  for (const diagnostic of diagnostics) {
    // 坏技能**不阻塞**（跳过，其余照常加载），但**诊断必须看得见** —— 三处一起兜（详案 §17）：
    //   ① 服务端日志（就是下面这一行）
    //   ② `GET /api/chat/commands` 的响应字段（前端**目前不渲染**，是留给"资源视图"的接口）
    //   ③ ⭐ **系统提示词里那段交代** —— 抄 Reasonix：把话**写给模型**、让模型转告用户
    //      （`buildSkillCatalog` 的第二个参数；这是我们唯一"真的到得了人眼前"的一处）
    console.warn(
      `[skill] ${diagnostic.name}：${diagnostic.reason}（${diagnostic.dir}）`,
    );
  }

  // 1c) 多轮记忆的核心：先把用户消息落盘，再按文件顺序读出完整上下文。
  await store.appendMessage(userMessage);

  // 1d) 技能手势（C8 T4）：扫刚落的**这一条**消息里有没有 `/技能名`，命中就再追加一条
  //     user 消息放技能正文 —— 形状抄 DSH，模型**零工具调用**。
  //     三条边界（R3-3）：① 只扫这一条，不回头扫历史（否则旧消息每轮都重复注入）
  //       ② 带 `source` 标记的注入件不再被扫（防递归 / 防伪造）
  //       ③ 查不中静默当普通文本（`/usr/bin`、`5/8` 天然查不中 —— 我们查名单，不用正则猜）
  if (userMessage.role === "user" && userMessage.source === undefined) {
    for (const skill of findSkillInvocations(messageText(userMessage), skills)) {
      const injected = createSkillInvocationMessage(skill);
      // 事件推给前端 —— 界面上那块"已加载技能 X"就来自它。
      // ⚠️ **不需要新帧**（详案落点 10 判断有误，2026-09-16 T4 施工时核正）：`done` 发的是
      // `store.buildContext()`（全量历史），注入件已经落盘 ⇒ 它在 done 之后照样留在界面里。
      const injectedStart = { type: "message_start" as const, message: injected };
      const injectedEnd = { type: "message_end" as const, message: injected };
      for (const event of [injectedStart, injectedEnd]) {
        recorder.record(event);
        send({ type: "event", event });
      }
      await store.appendMessage(injected);
    }
  }

  const context = store.buildContext();

  // 1e) 每请求组装工具注册表（_pipeline/tools.ts）：
  //     todo/askUser 两个 hooks 闭包都在 tools.ts 内部统一绑定（传 recorder 拿 runId）。
  const toolRegistry = createPipelineTools({
    toolContext,
    store,
    recorder,
    send,
  });

  // 1f) 系统提示词的**唯一装配点**（C34，2026-09-16 从 route.ts 搬来）。
  //     为什么搬：提示词有三个输入，其中"各工具专属的规矩"来自 `toolRegistry.guidelines()`
  //     —— 而注册表是在这一层建的。放在 route.ts 就只能装两个，第三个没地方来。
  //     搬完的收益是三个输入同源；代价是 route 少一个参数、这里多十行。
  //   - 时间：每请求现取（模型需要知道"现在"，否则把训练截止当今年 —— 2026-09-14 真机 bug）
  //   - 技能清单：用上面那份 `skills`（**同一遍扫描**，不为了提示词再扫一次）
  //   - 工具规矩：各工具自己声明、注册表收集（文本住工具文件，不住提示词 —— 见 C34 判据）
  const systemPrompt = buildSystemPrompt(
    undefined, // now 走默认（注入时刻只是为了可测）
    buildSkillCatalog(skills, diagnostics),
    toolRegistry.guidelines(),
  );

  // 2) 运行 Agent Loop。onEvent 同时落盘轨迹 + 推浏览器。
  const result = await runAgentLoop({
    // 系统提示词
    systemPrompt,
    // 上下文
    messages: context,
    // ·工具注册表
    tools: toolRegistry.definitions(),
    // 模型
    model,
    // 工具注册表
    toolRegistry,
    // 最大轮数
    maxTurns: config.agent.maxTurns,
    // 工具调用前审批钩子
    beforeToolCall: params.beforeToolCall,
    // 取消信号
    signal,
    // 工具调用输出
    onToolOutput: (toolCallId, text) => {
      send({ type: "tool_output", toolCallId, text });
    },
    // 轨迹记录器 + 推浏览器
    onEvent: (event) => {
      recorder.record(event);
      // 事件监听
      send({ type: "event", event });
    },
  });

  // 2b) 本轮新增的 assistant/toolResult 逐条落盘，成为下一轮的"记忆"
  for (const message of result.newMessages) {
    await store.appendMessage(message);
  }

  // 2c) 上下文超窗口时压缩（_pipeline/compact.ts，含 MOCK 降级）
  await maybeCompact({
    store,
    model,
    signal,
    onCompacting: (tokensBefore) => send({ type: "compacting", tokensBefore }),
  });

  // 3) 推送最终权威结果（全量历史 + 统计 + 任务清单 + 上下文占用）
  send({
    type: "done",
    messages: store.buildContext(),
    tools: toolRegistry.definitions(),
    runId: recorder.runId,
    stats: store.stats(),
    todos: store.getLatestTodos() ?? [],
    contextPressure: computeContextPressure(store),
  });
}

/**
 * 造一条「宿主注入的技能正文」消息（C8 T4）。
 *
 * 两句引导语都是**故意**的：
 *   - "已经加载好了，不要再调 `skill` 工具加载它" —— 清单（`buildSkillCatalog`）里
 *     **故意不写**这条（它只对手势路径有意义，写成每请求都付的清单成本不划算，
 *     见 `lib/skill` 里那条注释），所以由注入这一侧就近说。
 *   - 点名 `/${skill.name}` —— 让模型知道"这是谁要的"，而不是凭空冒出一段说明书。
 *
 * 正文用**和 `skill` 工具同一个** `renderSkillContent`：两条加载路径给模型的形状一致。
 */
function createSkillInvocationMessage(skill: Skill): UserMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text:
          `用户用 /${skill.name} 主动加载了这个技能，正文见下 —— 已经加载好了，` +
          "不要再调 `skill` 工具加载它。\n\n" +
          renderSkillContent(skill),
      },
    ],
    timestamp: Date.now(),
    source: {
      kind: "skill-invocation",
      name: skill.name,
      baseDir: skill.baseDir,
    },
  };
}
