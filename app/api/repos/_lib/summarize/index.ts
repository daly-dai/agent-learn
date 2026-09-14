// ============================================================
// lib/repos/summarize.ts —— 仓库变更总结（C15）
// ============================================================
// 复用 B2 的模型管道（不是抄代码，是同一个模板）：
//   selectModel() 拿 TeachingModel → model.complete() → fail-soft。
// 摘要（summarize.ts）和变更总结（本文件）是同一模式的两种 prompt。
//
// 输入：仓库名 + 新增 commit oneline 列表。
// 输出：结构化 markdown 总结（更新概览 + 分节 + ⭐ 重点标注），
//   并落盘 workspace/更新日志-<日期>-<项目>.md（人看的临时材料，
//   不进 git，与走读笔记同定位；看完有价值再补进 PLAN）。
//
// 降级（fail-soft，对齐 generateSummary）：无 key / 调用失败 / 空输出
//   → degraded=true，text 为空。页面显示"跳过总结"，不崩、不阻塞更新。
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { selectModel } from "@/lib/selectModel";
import { createUserMessage, messageText } from "@/lib/message";
import { config } from "@/lib/config";
import type { TeachingModel } from "@/lib/model";

/** 每次总结最多喂给模型的 commit 数（防撑爆请求；多的提示截断） */
const MAX_COMMITS_IN_PROMPT = 40;

export type UpdateSummary = {
  /** LLM 生成的总结文本（markdown）；降级时为空串 */
  text: string;
  /** true = 未配置 key / 调用失败 / 空输出（页面显示"跳过总结"） */
  degraded: boolean;
};

// ------------------------------------------------------------
// 提示词：只总结，不对话（对齐 SUMMARIZATION_SYSTEM_PROMPT 的纪律）
// ------------------------------------------------------------

const SYSTEM_PROMPT = `You are a repository change reviewer for a learning project. You read the list of new commits of an open-source reference project, and produce a structured Chinese summary that helps the learner decide what is worth studying.

ONLY output the summary. Do NOT continue the conversation. Do NOT ask questions.`;

/**
 * 组装总结提示词。
 * totalCount 单独传（2026-09-01 修）：调用方先 slice(0, MAX) 再传 commits，
 * buildPrompt 从 commits.length 看不出原始总数——截断提示"共 N 条"永不触发
 * （死代码，被单测逮住）。把原始数量作为独立参数，提示才有意义。
 * 关注点（repo.note）来自导航手册——告诉模型"这个项目对我们学什么
 * 最有价值"，让 ⭐ 标注结合本项目实际，而不是泛泛而谈。
 */
function buildPrompt(
  repoName: string,
  note: string,
  commits: string[],
  totalCount: number,
): string {
  const commitLines = commits
    .map((c) => `- ${c}`)
    .join("\n");

  const truncated = totalCount > MAX_COMMITS_IN_PROMPT
    ? `\n\n(共 ${totalCount} 条，以下展示前 ${MAX_COMMITS_IN_PROMPT} 条)`
    : "";

  return `以下是一个开源参考项目 "${repoName}" 最近的新增提交（git log --oneline）：

${commitLines}${truncated}

项目背景（我们为什么参考它）：${note}

请用中文输出以下结构（没有的分节省略，不要硬凑）：

## 更新概览
（一句话：这一轮更新的主题是什么）

### 新功能
（列表）

### 修复
（列表）

### 重构 / 其他
（列表）

## ⭐ 重点标注
（这是最重要的部分：不是罗列 commit，而是**提炼总结**这一轮更新里
哪些值得我重点关注、哪些值得我学习。结合"项目背景"里我们参考它的目的。
按重要程度排序，最多 3 条。
**格式要求（严格遵守）**：每条用编号行开头，标题用 **加粗**，下面
固定两行——"学习价值：…"和"使用价值：…"，例如：

1. **<值得学的点标题>**
   学习价值：<它教了什么新机制/新思路，为什么值得学>
   使用价值：<能否直接借鉴到我们项目，怎么用>

不要用别的格式（不要用 - 列表，不要只写一句话）。没有值得学的
就不要硬凑，宁可少。）；`
}

// ------------------------------------------------------------
// 主入口
// ------------------------------------------------------------

/**
 * 生成变更总结。失败/无 key/空输出 → degraded=true（页面显示跳过总结）。
 */
export async function summarizeUpdate(
  repoName: string,
  note: string,
  commits: string[],
  signal?: AbortSignal,
): Promise<UpdateSummary> {
  // 没有可总结的内容：不算降级，但也没得写（调用方应避免传空）
  if (commits.length === 0) {
    return { text: "", degraded: false };
  }

  let model: TeachingModel;
  try {
    ({ model } = selectModel());
  } catch {
    // 未配置 API key / MOCK 模式不可用 → 降级
    return { text: "", degraded: true };
  }

  const prompt = buildPrompt(
    repoName,
    note,
    commits.slice(0, MAX_COMMITS_IN_PROMPT),
    commits.length, // 原始总数（截断提示用）
  );

  const result = await model.complete({
    systemPrompt: SYSTEM_PROMPT,
    messages: [createUserMessage(prompt)],
    tools: [],
    signal,
  });

  // 失败/中止/空输出 → 降级（不把半截总结当真，对齐 D9 fail-closed）
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    return { text: "", degraded: true };
  }
  const text = messageText(result).trim();
  if (text.length === 0) {
    return { text: "", degraded: true };
  }

  return { text, degraded: false };
}

// ------------------------------------------------------------
// 落盘：workspace/更新日志-<日期>-<项目>.md
// ------------------------------------------------------------

/** 日期前缀：2026-08-31（本地时区，文件名用） */
function datePrefix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 总结落盘到 workspace/更新日志-<日期>-<项目>.md。
 * 失败不抛错（落盘是附赠，不阻塞更新主流程）——返回是否成功。
 */
export async function saveUpdateLog(
  repoName: string,
  summary: UpdateSummary,
  commits: string[],
): Promise<boolean> {
  try {
    const date = datePrefix();
    const dir = join(config.paths.workspace, "更新日志");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${date}-${repoName}.md`);

    const commitList = commits.map((c) => `- ${c}`).join("\n");
    const content = `# ${repoName} 更新日志（${date}）

新增 ${commits.length} 条提交：

${commitList}

---

${summary.degraded ? "（本次未生成 LLM 总结：未配置 API key 或调用失败）" : summary.text}
`;

    await writeFile(file, content, "utf8");
    return true;
  } catch {
    return false;
  }
}
