// ============================================================
// /api/repos —— 仓库更新面板（C15）
// ============================================================
// 接口一览：
//   GET  /api/repos          → 仓库列表 + 本地可探测状态（分支/落后/是否 git）
//   POST /api/repos/update   → 更新单个仓库（fetch → 增量 → 总结 → ff 合并）
//
// 安全：name 必须过 findRepo 白名单（路径来自 registry，不接受用户传路径）。
// 非 git 仓库（zip 快照）不接受更新：POST 直接 400。
//
// 分支：来自 registry.branch（已知数据，不运行时探测）——命令序列固定，
// 只有分支名按项目不同。
//
// 与 /api/sessions 的分工：sessions 管会话，这里管"参考仓库的更新"。
// 业务逻辑在 ./_lib/（特供业务功能：agent 核心在 lib/，业务模块放各自 api 下的 _lib/，
// 见 AGENTS.md 11.7 业务模块探索模式）——删掉本功能 = 删 app/api/repos + app/repos + app/services/repos。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { REPOS, findRepo } from "./_lib/registry";
import {
  checkRemoteAhead,
  fastForward,
  fetchRemote,
  getHeadCommit,
  getNewCommits,
} from "./_lib/git";
import { readBaseline, writeBaseline } from "./_lib/baseline";
import { saveUpdateLog, summarizeUpdate } from "./_lib/summarize";

export const runtime = "nodejs";

/** 仓库状态（GET 返回项） */
type RepoStatus = {
  name: string;
  isGit: boolean;
  /** git 仓库才有：主分支（registry.branch） */
  branch?: string;
  /**
   * git 仓库才有：远端是否有更新（每次进页面实时 ls-remote 检查）。
   * true = 有更新；false = 已最新；null = 检查失败（断网，前端不显示 tag）
   */
  hasUpdate?: boolean | null;
};

// --- GET /api/repos：仓库列表；?check=1 时附带实时更新检查 ---
// 设计（2026-08-31）：页面加载不能被网络检查阻塞。
//   不带 check → 只返回本地列表（瞬时，页面秒开）
//   带 check=1 → 额外并行 ls-remote 检查（每仓库 5s 超时，卡住只影响 tag）
// 前端：先 listRepos() 渲染，再 checkRepos() 渐进补 tag。
export async function GET(req: NextRequest) {
  // 基础列表（本地信息，无网络）
  const statuses: RepoStatus[] = REPOS.map((repo) => ({
    name: repo.name,
    isGit: repo.isGit,
    branch: repo.isGit ? repo.branch : undefined,
  }));

  // 带 check=1：并行检查所有 git 仓库（ls-remote 毫秒级；单个 5s 超时兜底）
  if (req.nextUrl.searchParams.get("check") === "1") {
    await Promise.all(
      statuses.map(async (item) => {
        if (!item.isGit || !item.branch) return;
        const repo = findRepo(item.name);
        if (!repo) return;
        item.hasUpdate = await checkRemoteAhead(repo.path, item.branch);
      }),
    );
  }

  return NextResponse.json({ repos: statuses });
}

// --- POST /api/repos/update：更新单个仓库 ---
// body: { name }；流程：白名单校验 → fetch → 读基线 → 增量 log →
//       空则"已最新"；非空则总结 + ff 合并 + 写基线 + 落盘。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  const repo = findRepo(name);
  if (!repo) {
    return NextResponse.json({ error: `未知仓库：${name}` }, { status: 400 });
  }
  if (!repo.isGit || !repo.branch) {
    return NextResponse.json(
      { error: `${name} 是 zip 快照（无 git 历史），不支持更新` },
      { status: 400 },
    );
  }

  try {
    // ① fetch：更新 origin/<branch> 引用（不动工作区）
    await fetchRemote(repo.path);

    // ② 读基线（上次更新到的 commit）；无基线 = 首刷
    const baseline = await readBaseline(repo.name);
    const base = baseline?.lastKnownCommit;

    // ③ 增量 commit 列表（命令固定，分支来自 registry）
    const commits = await getNewCommits(repo.path, repo.branch, base);

    if (commits.length === 0) {
      // 已是最新：基线仍在（无新增），返回 updated=false
      return NextResponse.json({ updated: false, commits: [] });
    }

    // ④ 生成总结（降级不阻塞：degraded=true 时页面显示"跳过总结"）
    const summary = await summarizeUpdate(repo.name, repo.note, commits);

    // ⑤ 快进合并（--ff-only：参考仓库不该有本地提交）
    await fastForward(repo.path, repo.branch);

    // ⑥ 写基线（ff 后的 HEAD）
    const head = await getHeadCommit(repo.path);
    await writeBaseline(repo.name, head);

    // ⑦ 落盘 workspace/更新日志/<日期>-<项目>.md（失败不阻塞）
    await saveUpdateLog(repo.name, summary, commits);

    return NextResponse.json({ updated: true, commits, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
