"use client";

// ============================================================
// Markdown 渲染组件 —— 对话消息体的"可插拔消费者"
// ============================================================
//
// 用 react-markdown + remark-gfm（表格/删除线/任务列表）
// + rehype-highlight（代码高亮，highlight.js 驱动）。
//
// 关键点：
//   1. react-markdown 默认转义原始 HTML —— 模型输出里的 <script> 等
//      不会被当 DOM 执行，安全。
//   2. 只覆盖 <pre> 加"复制"按钮，其余元素走默认渲染。
//   3. 这是我们协议（content blocks）的一个纯渲染消费者：协议/引擎/
//      SSE 完全没被改动。
//
// 注意：当前是"整段文本一次性渲染"。等做真·流式（message_update 逐
// token）时，换用 streamdown（专为增量 markdown 渲染设计），组件接口
// 不变，仍只改这一个文件。
// ============================================================

import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

// B17③：memo —— react-markdown + rehypeHighlight 是重活（解析 + 语法高亮）。
// 流式输出时只有正在更新的那行文本在变，其余行 children 引用/值不变 →
// memo 浅比较直接跳过，不再每帧全量重解析。
export const Markdown = memo(function Markdown({
  children,
}: {
  children: string;
}) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

/** 带"复制"按钮的代码块 */
function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  async function copy() {
    const code = preRef.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非 localhost/https）时静默忽略
    }
  }

  return (
    <div className="code-block">
      <button className="code-copy" type="button" onClick={copy}>
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}
