// ============================================================
// lib/repos/baseline.ts —— 仓库更新基线（C15）
// ============================================================
// 增量总结的关键：记住"上次更新到哪个 commit"，下次只总结
// <基线>..origin/<branch> 的新增部分——重复点击不重复总结。
//
// 存储：.repo-updates/<name>.json（config.paths.repoBaselines，已 gitignore）。
// 内容：{ lastKnownCommit, updatedAt }。机器读，不是给人看的文档。
// 人看的总结落盘在 workspace/（saveUpdateLog，见 summarize.ts）。
// ============================================================

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "@/lib/config";

export type Baseline = {
  /** 上次更新到的 commit（git rev-parse HEAD 的完整 hash） */
  lastKnownCommit: string;
  /** 上次更新时间（ISO 字符串） */
  updatedAt: string;
};

/** 基线文件路径：.repo-updates/<name>.json */
export function baselinePath(repoName: string): string {
  return join(config.paths.repoBaselines, `${repoName}.json`);
}

/** 读基线；文件不存在/损坏返回 null（首刷信号） */
export async function readBaseline(repoName: string): Promise<Baseline | null> {
  try {
    const raw = await readFile(baselinePath(repoName), "utf8");
    const parsed = JSON.parse(raw) as Baseline;
    if (typeof parsed.lastKnownCommit !== "string") return null;
    return parsed;
  } catch {
    // 文件不存在 / JSON 损坏：都当首刷
    return null;
  }
}

/** 写基线（目录不存在则创建） */
export async function writeBaseline(
  repoName: string,
  lastKnownCommit: string,
): Promise<void> {
  await mkdir(config.paths.repoBaselines, { recursive: true });
  const baseline: Baseline = {
    lastKnownCommit,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(baselinePath(repoName), JSON.stringify(baseline, null, 2), "utf8");
}
