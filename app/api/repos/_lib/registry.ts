// ============================================================
// app/api/repos/_lib/registry.ts —— 参考开源项目清单（C15 仓库更新面板）
// ============================================================
// 定位（2026-08-31 决策，见 AGENTS.md 11.7 业务模块探索模式）：
// 本目录是**业务模块**（基于 agent 内核探索的落地实践，特供小工具），
// 不是 agent 内核。原在 lib/repos/，后迁到 app/api/repos/_lib/——
// 业务模块不进 lib，放各自 api 下的 _lib/（_ 前缀 = App Router 非路由）。
// 边界：删本功能 = 删 app/api/repos + app/repos + app/services/repos 三处，
// 不影响 agent 内核。lib 不反向依赖 app 的红线依然要守（本目录只 import @/lib/*）。
//
// 单一事实源：页面展示哪些仓库、更新按钮给谁、git 操作作用在哪个路径，
// 全部从这里来。路径 = config.paths.reposRoot（E:\agents-read）拼接，
// 不硬编码绝对路径（config 是唯一配置入口）。
//
// isGit 区分两类：
//   true  —— git clone 的仓库（pi/codex/deepseek-harness/langchainjs/opencode），
//            可 fetch/pull/增量总结
//   false —— zip 解压的快照（无 .git 历史），只展示、灰置、不提供更新按钮
// ============================================================

import { join } from "node:path";
import { config } from "@/lib/config";

export type RepoEntry = {
  /** 显示名（页面/基线文件名都用它） */
  name: string;
  /** 仓库绝对路径 */
  path: string;
  /** 是否 git 仓库（有历史可更新） */
  isGit: boolean;
  /**
   * 主分支名（git 仓库才有）。分支是已知数据不是运行时探测：
   * pi/codex 是 main，deepseek-harness 是 master——写死在这里，
   * git 命令序列固定，只有这个值按项目不同。
   */
  branch?: string;
  /** 一句话备注（展示用） */
  note: string;
};

export const REPOS: RepoEntry[] = [
  {
    name: "pi",
    path: join(config.paths.reposRoot, "pi"),
    isGit: true,
    branch: "main",
    note: "主参考：agent-loop / session / compaction",
  },
  {
    name: "codex",
    path: join(config.paths.reposRoot, "codex"),
    isGit: true,
    branch: "main",
    note: "审批引擎 / 沙箱 / rollout",
  },
  {
    name: "deepseek-harness",
    path: join(config.paths.reposRoot, "deepseek-harness"),
    isGit: true,
    branch: "master",
    note: "即 DSH：会话/终端/task 面板完整落地",
  },
  {
    name: "langchainjs",
    path: join(config.paths.reposRoot, "langchainjs"),
    isGit: true,
    branch: "main",
    note: "LangChain JS：agent / 工具 / 记忆生态（生态参考）",
  },
  {
    name: "opencode",
    path: join(config.paths.reposRoot, "opencode"),
    isGit: true,
    branch: "dev",
    note: "opencode：终端 Agent（AI 编码）参考",
  },
  {
    name: "smolagents",
    path: join(config.paths.reposRoot, "smolagents-main"),
    isGit: false,
    note: "zip 解压快照：轻量 agent 框架对照",
  },
  {
    name: "DeepSeek-Reasonix",
    path: join(config.paths.reposRoot, "DeepSeek-Reasonix-main-v2"),
    isGit: false,
    note: "zip 解压快照：UI / 面板 / 审批交互主参考",
  },
  {
    name: "CodeWhale",
    path: join(config.paths.reposRoot, "CodeWhale-main"),
    isGit: false,
    note: "zip 解压快照：审批四档 / hooks 参考",
  },
  {
    name: "Survey",
    path: join(config.paths.reposRoot, "Agent-Harness-Survey-ZH-main"),
    isGit: false,
    note: "zip 解压快照：ETCLOVG 七层综述",
  },
];

/** 按 name 查仓库；查不到返回 undefined（route 校验白名单用） */
export function findRepo(name: string): RepoEntry | undefined {
  return REPOS.find((repo) => repo.name === name);
}
