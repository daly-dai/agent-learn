"use client";

// ============================================================
// AskUserCard —— 模型提问卡片（A4，多问题逐题作答版）
// ============================================================
// 形态抄 Reasonix AskCard 完整形态：1-N 问、逐题作答、进度显示
// "Question 1/3"、返回上题、每道题可选选项点选 或 自定义补充 或 跳过。
// 渲染在输入框位置（替换输入台，Reasonix composer-decision-host 同款）。
//
// 设计语言（走纸记录仪）：
//   - 问题用 model 绿（--pen-model）= "模型那支笔在说"
//   - 选项/提交用 user 蓝（--pen-user）= "该你回笔了"
//   - 等待信号点用 signal 琥珀 + lamp 脉冲（全局动画）
//   - 进度 "1/3" 用等宽读数（序号带信息，不是装饰）
//
// 交互：点选项 = 记答案进下一题；或自定义输入 + 提交；或跳过；
// ← 返回上一题可改；答完最后一题 → 一次性回传全部 answers。
// ============================================================

import { useState } from "react";
import type { AskQuestion } from "@/lib/tools/ask-user";
import type { PendingAsk } from "../../lib/use-agent-run";
import styles from "./ask-user-card.module.css";

type AskUserCardProps = {
  ask: PendingAsk;
  onAnswer: (answers: string[]) => void;
};

export function AskUserCard({ ask, onAnswer }: AskUserCardProps) {
  const questions = ask.questions;
  const [index, setIndex] = useState(0);
  // answers[index] = 当前这题已选的答案（未答 = undefined）
  const [answers, setAnswers] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  const question = questions[index];
  const total = questions.length;
  const isLast = index === total - 1;
  // 单题简化：不显示进度读数，交互更干净（点选项/输入即在最后一题的语义上）
  const isSingle = total === 1;

  // 记录答案并前进（isLast 时回传全部）
  const commit = (answer: string) => {
    const next = [...answers.slice(0, index), answer];
    setAnswers(next);
    if (isLast) {
      onAnswer(next);
      return;
    }
    setIndex(index + 1);
    setCustom("");
  };

  const goBack = () => {
    if (index > 0) {
      setIndex(index - 1);
      setCustom("");
    }
  };

  return (
    <section className={styles.card} role="dialog" aria-label="模型提问">
      {/* 标题行：等待信号 + 等宽标签 + 进度读数（i/N，多题才显示）+ 键盘提示 */}
      <div className={styles.titleRow}>
        <span className={styles.signal} aria-hidden="true" />
        <span className={styles.title}>模型提问</span>
        {!isSingle && (
          <span className={styles.progress}>{index + 1}/{total}</span>
        )}
        <span className={styles.hint}>点选项或输入 · 返回上一题可改</span>
      </div>

      {/* 当前问题：model 绿 + 等宽——"模型那支笔在说" */}
      <p className={styles.question}>{question.question}</p>

      {/* 有选项 → 渲染成可点选项行；否则直接是自由输入框 */}
      {question.options && question.options.length > 0 ? (
        <>
          <div className={styles.optionList}>
            {question.options.map((opt, i) => (
              <button
                key={opt.label}
                type="button"
                className={styles.option}
                onClick={() => commit(opt.label)}
              >
                <span className={styles.optionKey}>{i + 1}</span>
                <span className={styles.optionLabel}>{opt.label}</span>
                {opt.description && (
                  <span className={styles.optionDesc}>{opt.description}</span>
                )}
              </button>
            ))}
          </div>
          <p className={styles.customHint}>或自定义补充：</p>
          <textarea
            className={styles.input}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (custom.trim()) commit(custom);
              }
            }}
            placeholder="输入你的答案…"
            rows={1}
          />
        </>
      ) : (
        <textarea
          className={styles.input}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (custom.trim()) commit(custom);
            }
          }}
          placeholder="输入你的答案…"
          rows={2}
        />
      )}

      {/* 确认条：返回(非首页) + 提交（有自定义输入时）/ 跳过 */}
      <div className={styles.confirmBar}>
        {index > 0 && (
          <button type="button" className={styles.backBtn} onClick={goBack}>
            ← 上一题
          </button>
        )}
        <button type="button" className={styles.skipBtn} onClick={() => commit("")}>
          跳过
        </button>
        <button
          type="button"
          className={styles.submitBtn}
          onClick={() => {
            if (custom.trim()) commit(custom);
          }}
          disabled={!custom.trim()}
        >
          提交答案
        </button>
      </div>
    </section>
  );
}
