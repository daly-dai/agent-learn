"use client";

// ============================================================
// useStickyScroll —— 滚动容器的"吸底跟随"（自定义 Hook）
// ============================================================
// 返回"用户是否停靠在底部"：距底部 48px 内 = true（可以自动滚到底），
// 用户滚上去看历史 = false（停止跟随）。这是聊天类 UI 的标准模式——
// 无条件 scrollToEnd 会在每次流式 delta 时把滚动轴拽到底，用户看不了上面。
//
// 用法（调用方负责"跟随"动作，hook 只给判定）：
//   const follow = useStickyScroll(transcriptRef);
//   useEffect(() => {
//     if (follow) scrollToEnd(transcriptRef.current);
//   }, [messages, follow]);
//
// 为什么做成 hook（2026-08-26 评审指出）：转录稿和轨迹区都要用，逻辑
// 完全相同——内联摊两遍是重复代码，且 48px 阈值散落两处。封装后：
//   - 判定逻辑 + 阈值只写一次（高内聚）
//   - 页面组装层只写"转录稿吸底 / 轨迹区吸底"两行（低耦合）
// ============================================================

import { useEffect, useRef, type RefObject } from "react";

/** 距底部多少像素内算"停靠"（用户没在看历史，可以自动滚） */
const STICKY_THRESHOLD_PX = 48;

export function useStickyScroll(
  ref: RefObject<HTMLDivElement | null>,
): boolean {
  const stickyRef = useRef(true);

  // 绑滚动监听，实时更新"是否停靠"。
  // 注意：写 ref 不触发重渲染——判定值在下一次渲染时被读到（调用方
  // 的 effect 依赖它），所以流式更新时能拿到最新的停靠状态。
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const onScroll = () => {
      stickyRef.current =
        box.scrollHeight - box.scrollTop - box.clientHeight <
        STICKY_THRESHOLD_PX;
    };
    box.addEventListener("scroll", onScroll);
    return () => box.removeEventListener("scroll", onScroll);
  }, [ref]);

  return stickyRef.current;
}
