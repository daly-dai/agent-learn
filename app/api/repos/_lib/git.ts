// ============================================================
// lib/repos/git.ts —— git 命令薄封装（C15 仓库更新面板）
// ============================================================
// 唯一碰 child_process 的地方。命令序列固定，只有分支名是数据
// （来自 registry.branch，不运行时探测）：
//
//   git fetch origin                                  ← 固定
//   git log HEAD..origin/<branch> --oneline --no-merges  ← 分支是变量
//   git pull --ff-only origin <branch>                ← 分支是变量
//
// 为什么分支不探测（2026-08-31 用户拍板）：
//   分支是已知数据不是运行时事实——pi/codex 是 main，deepseek-harness
//   是 master，写在 registry 里即可。探测（rev-parse --abbrev-ref HEAD）
//   每次多跑一条命令，换来的是"万一仓库换分支了能自适应"——教学项目
//   不需要这个自适应，可读性优先：命令固定 + 数据驱动。
//
// 为什么 execFile 而不是 spawn（对照 bash-runner）：
//   bash 要流式输出（边跑边看）→ spawn；git log/pull 输出量小、
//   我们要的是完整结果 → execFile 攒完回调，代码更短。
// 为什么参数数组（防注入，AGENTS.md 教学点）：
//   execFile("git", ["-C", path, "log", ...]) —— 参数逐个传，不拼字符串，
//   branch/commit 里带空格、引号、$() 都不会被 shell 解释。
// 为什么 -C <path> 而不是 cwd 选项：
//   显式声明"作用于哪个仓库"，和 registry 白名单联动——路径不在
//   REPOS 里就根本到不了这里。
// ============================================================

import { execFile } from "node:child_process";

export type GitResult = {
  stdout: string;
  exitCode: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;
/** fetch 大仓库（codex 是大型 Rust 仓库）放宽超时，国内网络 GitHub 慢 */
const FETCH_TIMEOUT_MS = 180_000;

/** 执行 git 命令（-C 指定仓库路径，参数数组防注入） */
export function runGit(
  repoPath: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoPath, ...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          // execFile 的 error 对象带 stderr（git 报错信息都在 stderr）
          const detail = (error as { stderr?: string }).stderr?.trim();
          // 超时被杀：killed=true 且 stderr 常为空 → 给明确文案
          // （2026-08-31 实测：codex fetch 60s 超时，报错只有
          //  "Command failed: ..." 没有 stderr，用户看不懂）
          if ((error as { killed?: boolean }).killed) {
            reject(
              new Error(
                `git 命令超时（${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s）：${args.join(" ")}`,
              ),
            );
            return;
          }
          reject(new Error(detail || error.message || "git 命令失败"));
          return;
        }
        resolve({ stdout: stdout.trim(), exitCode: 0 });
      },
    );
  });
}

/** 当前 HEAD 完整 commit（写基线用） */
export async function getHeadCommit(repoPath: string): Promise<string> {
  const { stdout } = await runGit(repoPath, ["rev-parse", "HEAD"]);
  return stdout.trim();
}

/**
 * 解析 ls-remote 输出，取远端分支 hash。
 * 输入形如 "abc1234...\trefs/heads/main"，返回 hash；空/异常返回 null。
 * 单独抽出（纯函数）便于单测——网络部分测不了，解析逻辑可以测。
 */
export function parseLsRemoteHash(output: string): string | null {
  const hash = output.split(/\s+/)[0] ?? "";
  // hash 是 40 位 hex（完整 SHA-1）；短/空说明输出异常
  return /^[0-9a-f]{40}$/i.test(hash) ? hash : null;
}

/**
 * 快速检查远端是否有更新（用户 08-31 拍板：进页面自动检查，但必须快）。
 * 用 `git ls-remote origin <branch>`——只问远端分支当前指向的 commit hash
 * （一行文本，毫秒级，不下载任何对象），对比本地 HEAD hash：
 *   不同 → 远端有新 commit（有更新）
 *   相同 → 已是最新
 *
 * 为什么不用 fetch：fetch 会下载增量对象（大仓库可能几十秒），ls-remote
 * 只传引用。检查"有没有更新"用 ls-remote 足够；真正要更新内容时才 fetch。
 *
 * 失败（断网/认证问题/网络卡住）→ 返回 null：调用方静默降级（不显示 tag、
 * 不报错），页面照常可用。
 *
 * 超时为什么用 5s（2026-08-31 实测）：页面 GET /api/repos 并行检查所有 git
 * 仓库，只要有一个 ls-remote 卡住（SSH 网络慢/认证挂起），Promise.all 就要
 * 等它到超时。曾用默认 60s → 新增仓库后页面 loading 卡 60 秒。检查更新是
 * "锦上添花"（失败只影响 tag 显示），绝不能让页面等——5s 内必须返回。
 */
const CHECK_TIMEOUT_MS = 5_000;

export async function checkRemoteAhead(
  repoPath: string,
  branch: string,
): Promise<boolean | null> {
  try {
    const [remote, local] = await Promise.all([
      runGit(repoPath, ["ls-remote", "origin", branch], { timeoutMs: CHECK_TIMEOUT_MS }),
      getHeadCommit(repoPath),
    ]);
    const remoteHash = parseLsRemoteHash(remote.stdout);
    if (remoteHash === null) return null; // 远端无此分支 / 输出异常
    return remoteHash !== local;
  } catch {
    // 网络失败 / SSH 认证问题 / 超时 / 沙箱限制：静默降级
    return null;
  }
}

/** fetch 远端（更新 origin/<branch> 引用，不动工作区）。
 *  大仓库（codex）+ 国内网络慢 → 用放宽的 FETCH_TIMEOUT_MS */
export async function fetchRemote(repoPath: string): Promise<void> {
  await runGit(repoPath, ["fetch", "origin"], { timeoutMs: FETCH_TIMEOUT_MS });
}

/**
 * 新增 commit 列表（git log <base>..origin/<branch> --oneline --no-merges）。
 * 有基线 → 只取基线之后的；无基线（首刷）→ 取最近 N 条。
 * 返回形如 "abc1234 commit message" 的 oneline 数组。
 *
 * 坑（2026-08-31 实测踩到）：参数必须逐个 push，不能拼成一个字符串——
 * 把 `-n 20 origin/main` 拼成单个参数，git 会把整串当"一个值"解析，
 * 报 "not an integer"。execFile 参数数组的意义就在这：每个 token 单独传。
 */
export async function getNewCommits(
  repoPath: string,
  branch: string,
  base?: string,
  limit = 20,
): Promise<string[]> {
  const args = ["log", "--oneline", "--no-merges"];
  if (base) {
    // 增量：基线之后的提交
    args.push(`${base}..origin/${branch}`);
  } else {
    // 首刷：最近 N 条（-n 和 limit 分两个参数，origin/<branch> 单独一个）
    args.push("-n", String(limit), `origin/${branch}`);
  }
  const { stdout } = await runGit(repoPath, args);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 快进合并（git pull --ff-only origin <branch>） */
export async function fastForward(
  repoPath: string,
  branch: string,
): Promise<void> {
  await runGit(repoPath, ["pull", "--ff-only", "origin", branch]);
}

/** 判断仓库是否落后远端（有新增 commit 返回 true） */
export async function isBehind(
  repoPath: string,
  branch: string,
  base?: string,
  limit = 20,
): Promise<boolean> {
  const commits = await getNewCommits(repoPath, branch, base, limit);
  return commits.length > 0;
}
