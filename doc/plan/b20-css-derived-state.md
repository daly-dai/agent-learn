# B20 · 前端状态派生 CSS 化（方法论）

> **这是一条"纯知识条目"的记录**（`AGENTS.md` 第 10 条：材料住 `doc/plan/<名>.md`）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 B20 行（2026-09-18 搬入；它没有家 ⇒ 建本文件）。**它是 B21（落点实施）的方法论依据。**

## 一、这条知识是什么

学自 DSH `chatperf` 三个 commit（2026-09-01 触发）：**把"纯视觉派生状态"从 React 运行时搬到 CSS**，三种形态——

| # | 形态 | DSH 的做法 |
|---|---|---|
| ① | **结构位置关系** → CSS 兄弟选择器 | `derive user action reveal`：`data-chat-flow-kind` + `:has(~ 同类)` 表达"非最新一条" ⇒ 删掉 `useChat` 全局订阅 + `reveal` prop |
| ② | **布尔状态** → `data-*` + 属性选择器 | `move reasoning tail alignment`：删 40 行 `useThrottledVisualUpdate` rAF hook，`data-follow-end` + flex `justify-content:flex-end` + `width:max-content` 等效"滚动到末尾" |
| ③ | **尺寸适配** → container query | `move overflow sizing`：`ProducedFiles` 删探针树 + layout effect + ResizeObserver，`container-type:inline-size` + `@container` 宽度档位选显示几个 chip。**决策笔记明写代价：近似换零 JS 布局观察** |

## 二、⚠️ 不适用边界（诚实记录）

- **消息流每帧文本变化**是**数据状态**（CSS 救不了）
- **trace-rail 宽度**是**数据 → 尺寸映射**
- **键盘焦点**是**交互状态**

## 三、怎么用

**方法论先记下，写新 UI 时按此选型**；container query 留给 A3 / C15。
**落点实施见 B21**（command-menu hover 去 JS 化 + 布尔类名改 `data-*`）—— B21 动手前**先读本文件理解边界**。

## 四、依据（一手来源）

DSH `chatperf` 三个 commit：`f808112ec8` / `203e2440ac` / `e5bbee893b` + 决策笔记 `c11c3f98ad` / `a718d1f0a1`。

## 五、状态

✅ 已记录（2026-09-01）—— 知识点在 **B21 施工时引用**。
