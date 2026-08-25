"use client";

// ============================================================
// 转录稿消息行 —— 用户 / Agent / 工具结果三种行
// 以及工具调用行（CALL）和工具结果卡片（可折叠）
// ============================================================

import { useState } from "react";
import type {
  AgentMessage,
  CompactionSummaryMessage,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
} from "@/lib/types";
import { Markdown } from "../../markdown";
import { formatClock } from "../../lib/format";
import styles from "./message-row.module.css";

/** 工具结果超过这个行数才默认折叠 */
const CLAMP_LINES = 12;

type MessageRowProps = {
  message: AgentMessage;
  attached: boolean;
  live: boolean;
  /** bash 命令的实时输出（toolCallId → 已累积文本），Phase 4 */
  toolOutputs?: Record<string, string>;
};

export function MessageRow({ message, attached, live, toolOutputs }: MessageRowProps) {
  if (message.role === "compactionSummary") {
    // 旧上下文压缩摘要（B2）：独立渲染成"压缩卡片"，不是用户气泡/工具行。
    // 为什么独立类型：摘要伪装 user 会被当用户消息渲染（多轮后页面出现
    // 一大坨 user:/assistant: 前缀文本）；独立类型让这里能认出它。
    return <CompactionCard message={message} />;
  }

  if (message.role === "user") {
    return (
      <Row tone="user" role="你" timestamp={message.timestamp}>
        <div className={styles.said}>
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
        <div className={`${styles.reply}${live ? " is-live" : ""}`}>
          {message.content.map((block, i) =>
            block.type === "toolCall" ? (
              <ToolCallLine
                key={i}
                block={block}
                output={toolOutputs?.[block.id]}
              />
            ) : (
              <Markdown key={i}>{block.text}</Markdown>
            ),
          )}
          {/* 首个 token 还没到：给一行明确的等待态，而不是留一块空白 */}
          {live && message.content.length === 0 && (
            <span className={styles.pondering}>思考中</span>
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
  // row-${tone} 是动态发言人色（user/agent/tool），保持全局字符串
  return (
    <article
      className={`${styles.row} row-${tone}${attached ? " is-attached" : ""}`}
    >
      <div className={styles.rowGutter}>
        {role ? (
          <>
            <span className={styles.rowRole}>{role}</span>
            <span className={styles.rowTime}>{formatClock(timestamp)}</span>
          </>
        ) : (
          // 工具结果没有独立身份：它属于上一条消息，用连接符表示从属
          <span className={styles.rowLink} aria-hidden="true">
            ↳
          </span>
        )}
      </div>
      <div className={styles.rowBody}>{children}</div>
    </article>
  );
}

function ToolCallLine({
  block,
  output,
}: {
  block: ToolCallContent;
  output?: string;
}) {
  return (
    <div className={styles.call}>
      <span className={styles.callTag}>CALL</span>
      <span className={styles.callName}>{block.name}</span>
      <code className={styles.callArgs}>{JSON.stringify(block.arguments)}</code>
      {/* bash 命令的实时输出：逐块追加，像真终端；结束后结果卡片再显示最终版 */}
      {output !== undefined && output.length > 0 && (
        <pre className={styles.toolOutputLive}>{output}</pre>
      )}
    </div>
  );
}

/** 旧上下文压缩摘要卡片（B2）：默认折叠，点开展示摘要内容 */
function CompactionCard({ message }: { message: CompactionSummaryMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.compaction}>
      <button
        className={styles.compactionHead}
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={styles.compactionTag}>压缩</span>
        <span className={styles.compactionLabel}>
          旧上下文已压缩（{message.tokensBefore} token）
        </span>
        <span className={styles.compactionToggle}>
          {expanded ? "收起" : "展开"}
        </span>
      </button>
      {expanded && (
        <pre className={styles.compactionBody}>{message.summary}</pre>
      )}
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
        styles.apparatus,
        message.isError ? styles.apparatusError : "",
        clamped ? styles.apparatusClamped : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.apparatusHead}>
        <span className={styles.apparatusName}>{message.toolName}</span>
        <span className={styles.apparatusVerdict}>
          {message.isError ? "✗ 失败" : "✓ 成功"}
        </span>
        <span className={styles.apparatusMeta}>{lines} 行</span>
        {lines > CLAMP_LINES && (
          <button
            className={styles.apparatusToggle}
            type="button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : `展开 ${lines} 行`}
          </button>
        )}
      </div>
      <div className={styles.apparatusBody}>
        <pre className={styles.toolOutput}>{text}</pre>
      </div>
    </div>
  );
}
