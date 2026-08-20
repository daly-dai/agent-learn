"use client";

// ============================================================
// 转录稿消息行 —— 用户 / Agent / 工具结果三种行
// 以及工具调用行（CALL）和工具结果卡片（可折叠）
// ============================================================

import { useState } from "react";
import type {
  AgentMessage,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
} from "@/lib/types";
import { Markdown } from "../markdown";
import { formatClock } from "../lib/format";

/** 工具结果超过这个行数才默认折叠 */
const CLAMP_LINES = 12;

type MessageRowProps = { message: AgentMessage; attached: boolean; live: boolean };

export function MessageRow({ message, attached, live }: MessageRowProps) {
  if (message.role === "user") {
    return (
      <Row tone="user" role="你" timestamp={message.timestamp}>
        <div className="said">
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
        <div className={`reply${live ? " is-live" : ""}`}>
          {message.content.map((block, i) =>
            block.type === "toolCall" ? (
              <ToolCallLine key={i} block={block} />
            ) : (
              <Markdown key={i}>{block.text}</Markdown>
            ),
          )}
          {/* 首个 token 还没到：给一行明确的等待态，而不是留一块空白 */}
          {live && message.content.length === 0 && (
            <span className="pondering">思考中</span>
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
  return (
    <article className={`row row-${tone}${attached ? " is-attached" : ""}`}>
      <div className="row-gutter">
        {role ? (
          <>
            <span className="row-role">{role}</span>
            <span className="row-time">{formatClock(timestamp)}</span>
          </>
        ) : (
          // 工具结果没有独立身份：它属于上一条消息，用连接符表示从属
          <span className="row-link" aria-hidden="true">
            ↳
          </span>
        )}
      </div>
      <div className="row-body">{children}</div>
    </article>
  );
}

function ToolCallLine({ block }: { block: ToolCallContent }) {
  return (
    <div className="call">
      <span className="call-tag">CALL</span>
      <span className="call-name">{block.name}</span>
      <code className="call-args">{JSON.stringify(block.arguments)}</code>
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
        "apparatus",
        message.isError ? "apparatus-error" : "",
        clamped ? "apparatus-clamped" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="apparatus-head">
        <span className="apparatus-name">{message.toolName}</span>
        <span className="apparatus-verdict">
          {message.isError ? "✗ 失败" : "✓ 成功"}
        </span>
        <span className="apparatus-meta">{lines} 行</span>
        {lines > CLAMP_LINES && (
          <button
            className="apparatus-toggle"
            type="button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : `展开 ${lines} 行`}
          </button>
        )}
      </div>
      <div className="apparatus-body">
        <pre className="tool-output">{text}</pre>
      </div>
    </div>
  );
}
