"use client";

// ============================================================
// app/repos/page.tsx —— 仓库更新面板（C15，首个独立路由页）
// ============================================================
// 参考项目"更新雷达"：手动点击更新开源项目 → LLM 总结本轮变更 →
// 按阅读优先级展示（⭐重点标注 → 更新概览 → 提交列表），历史累积成时间线。
//
// 设计（2026-08-31 frontend-design 重做，签名 = 重点标注卡）：
//   - 签名元素：重点标注卡（琥珀序号 + 左边条的"本轮值得学"清单）——
//     页面唯一的高光，其余保持安静（可读性 > 装饰）
//   - 状态点：侧栏每行 4px 圆点（有更新=琥珀/静默=灰），不靠文字喊
//   - 字体语言：项目名/分支/哈希/日期用等宽（代码世界的器物），正文无衬线
//   - 历史时间线：每次更新落盘一个文件，全部读回；每条重点标注都展开
//     （用户拍板：上周的重点标注也要可见），概览/提交折叠
//   - 令牌全部来自 globals.css，与观测台同语言（中性壳 + 五支笔色）
// ============================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { checkRepos, listRepos, readUpdateLog, updateRepo } from "@/app/services/repos";
import type { RepoStatus } from "@/app/services/repos/types";
import type { UpdateLogWithContent, UpdateResult } from "@/app/services/repos/types";
import { Markdown } from "@/app/markdown";
import { parseHighlights, parseSummary } from "@/app/lib/repos-summary";

type UpdateState = {
  name: string;
  /** true = 更新中（按钮禁用） */
  running: boolean;
  /** 最近一次更新结果 */
  result: UpdateResult | null;
  /** 最近一次错误（null = 无） */
  error: string | null;
};

export default function ReposPage() {
  const [repos, setRepos] = useState<RepoStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [states, setStates] = useState<Record<string, UpdateState>>({});

  /** 更新后刷新（带检查：tag 归零/更新真实状态） */
  const refresh = useCallback(async () => {
    try {
      const data = await checkRepos();
      setRepos(data.repos ?? []);
    } catch {
      // 刷新失败不影响结果展示
    }
  }, []);

  // 挂载：先拉列表（瞬时，页面秒开），再异步检查更新补 tag。
  // 分两步：listRepos 不等网络检查（曾 60s 超时卡页面——新增仓库后 ls-remote
  // 卡住会拖垮加载）；checkRepos 单独跑，结果到了 setRepos 更新「有更新」。
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await listRepos({ signal: controller.signal });
        if (controller.signal.aborted) return;
        const list = data.repos ?? [];
        setRepos(list);
        setSelected((prev) => prev || list[0]?.name || "");
      } catch {
        setRepos([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    async function check() {
      try {
        const data = await checkRepos({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setRepos((prev) => data.repos ?? prev); // 用带 hasUpdate 的结果替换
      } catch {
        // 检查失败：保留已渲染的列表，tag 不显示（静默降级）
      }
    }
    load();
    check(); // 与 load 并行：页面秒开，tag 稍后出现
    return () => controller.abort();
  }, []);

  // 更新完成后刷新列表（tag 归零）
  useEffect(() => {
    const anyRunning = Object.values(states).some((s) => s.running);
    if (!anyRunning && Object.keys(states).length > 0) {
      refresh();
    }
  }, [states, refresh]);

  /** 点更新：调 POST /api/repos，结果写进该仓库的 state */
  const handleUpdate = useCallback(async (name: string) => {
    setStates((prev) => ({
      ...prev,
      [name]: { name, running: true, result: null, error: null },
    }));
    try {
      const result = await updateRepo(name);
      setStates((prev) => ({
        ...prev,
        [name]: { name, running: false, result, error: null },
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStates((prev) => ({
        ...prev,
        [name]: { name, running: false, result: null, error: message },
      }));
    }
  }, []);

  /** 全部更新：串行遍历 git 仓库（复用 handleUpdate，逐个跑，互不阻塞） */
  const handleUpdateAll = useCallback(async () => {
    const gitRepos = repos.filter((r) => r.isGit);
    for (const repo of gitRepos) {
      await handleUpdate(repo.name);
    }
  }, [repos, handleUpdate]);

  const stateOf = (name: string): UpdateState =>
    states[name] ?? { name, running: false, result: null, error: null };

  const anyRunning = Object.values(states).some((s) => s.running);
  const gitCount = repos.filter((r) => r.isGit).length;
  const selectedRepo = repos.find((r) => r.name === selected);

  return (
    <div className={styles.page}>
      {/* 顶栏 */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <h1 className={styles.title}>仓库更新</h1>
          <span className={styles.subtitle}>参考开源项目 · 按天跟进</span>
        </div>
        <Link href="/" className={styles.back}>
          返回观测台
        </Link>
      </header>

      <div className={styles.body}>
        {/* 左侧：项目侧边栏 */}
        <aside className={styles.sidebar}>
          <button
            type="button"
            className={styles.updateAllBtn}
            disabled={anyRunning || gitCount === 0}
            onClick={handleUpdateAll}
          >
            {anyRunning ? "更新中…" : `全部更新（${gitCount}）`}
          </button>

          <nav className={styles.repoList} aria-label="参考项目">
            {loading ? (
              <p className={styles.hint}>加载中…</p>
            ) : (
              repos.map((repo) => (
                <div
                  key={repo.name}
                  role="button"
                  tabIndex={0}
                  className={`${styles.repoItem}${
                    selected === repo.name ? ` ${styles.repoItemActive}` : ""
                  }${!repo.isGit ? ` ${styles.repoItemMuted}` : ""}`}
                  onClick={() => setSelected(repo.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(repo.name);
                    }
                  }}
                >
                  {/* 状态点：有更新=琥珀，静默=灰 */}
                  <span
                    className={`${styles.repoDot}${
                      repo.isGit && repo.hasUpdate === true ? ` ${styles.repoDotHot}` : ""
                    }`}
                    aria-hidden="true"
                  />
                  <span className={styles.repoName}>{repo.name}</span>
                  {repo.isGit && repo.hasUpdate === true && (
                    <span className={styles.tag}>有更新</span>
                  )}
                  {repo.isGit && (
                    <button
                      type="button"
                      className={styles.rowUpdateBtn}
                      disabled={stateOf(repo.name).running}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpdate(repo.name);
                      }}
                      aria-label={`更新 ${repo.name}`}
                    >
                      {stateOf(repo.name).running ? "…" : "更新"}
                    </button>
                  )}
                </div>
              ))
            )}
          </nav>
        </aside>

        {/* 右侧：选中项目的详情 */}
        <main className={styles.detail}>
          {selectedRepo ? (
            <RepoDetail
              key={selectedRepo.name}
              repo={selectedRepo}
              state={stateOf(selectedRepo.name)}
              onUpdate={handleUpdate}
            />
          ) : (
            <p className={styles.hint}>选择左侧项目查看更新。</p>
          )}
        </main>
      </div>
    </div>
  );
}

/** 右侧详情：项目名（主角）+ 更新 + 时间线（每条重点标注展开） */
function RepoDetail({
  repo,
  state,
  onUpdate,
}: {
  repo: RepoStatus;
  state: UpdateState;
  onUpdate: (name: string) => void;
}) {
  // 历史时间线：该项目全部落盘日志（刷新后仍可见——文件持久化，state 会丢）
  const [history, setHistory] = useState<UpdateLogWithContent[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 选中项目变化时加载它的全部历史日志
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistory(null);
    readUpdateLog(repo.name)
      .then((data) => {
        if (!cancelled) setHistory(data.logs ?? []);
      })
      .catch(() => {
        // 读取失败：静默，不显示时间线
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.name]);

  return (
    <div className={styles.detailInner}>
      {/* 头部：项目名是主角 */}
      <div className={styles.detailHead}>
        <div className={styles.detailTitle}>
          <h2 className={styles.detailName}>{repo.name}</h2>
          {repo.isGit && repo.branch && (
            <span className={styles.detailBranch}>{repo.branch}</span>
          )}
        </div>
        {repo.isGit && (
          <button
            type="button"
            className={styles.updateBtn}
            disabled={state.running}
            onClick={() => onUpdate(repo.name)}
          >
            {state.running ? "更新中…" : "更新"}
          </button>
        )}
      </div>

      {!repo.isGit ? (
        <p className={styles.hint}>zip 快照（无 git 历史），不支持更新。</p>
      ) : state.error ? (
        <p className={styles.resultError}>{state.error}</p>
      ) : state.result ? (
        state.result.updated ? (
          state.result.summary?.degraded ? (
            <>
              <p className={styles.hint}>
                未生成 LLM 总结（未配置 API key 或调用失败），仅列出提交。
              </p>
              <CommitFold commits={state.result.commits} />
            </>
          ) : (
            <SummaryBlock
              markdown={state.result.summary?.text ?? ""}
              commits={state.result.commits}
              label="本轮更新"
            />
          )
        ) : (
          <p className={styles.hint}>已是最新，无新增提交。</p>
        )
      ) : (
        // 没有本轮更新时：不显示空 hint——重点标注直接来自历史（下面时间线）。
        // 用户核心诉求：进页面就要看到重点标注，而不是一句"点更新"。
        null
      )}

      {/* 历史时间线：全部落盘日志（倒序，最新在前）。
          ⭐重点标注是主内容，永远展开——用户最想看的，进页面就可见。
          有本轮更新结果时跳过第一条（它就是本轮，避免重复显示） */}
      {!historyLoading && history && history.length > 0 && (
        <section className={styles.timeline}>
          {history.map((entry, i) => {
            // 本轮更新已显示 → 跳过时间线第一条（同一份内容）
            const skip = i === 0 && state.result?.updated;
            if (skip) return null;
            return (
              <div key={entry.fileName} className={styles.timelineEntry}>
                <span className={styles.timelineDate}>
                  {i === 0 ? "最近更新" : entry.date}
                </span>
                <SummaryBlock markdown={entry.content} label={entry.date} />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

/**
 * 按用户阅读优先级渲染总结：⭐重点标注（卡）→ 更新概览（折叠）→ 提交（折叠）。
 * label 用于区分"本轮更新"与历史日期。
 */
function SummaryBlock({
  markdown,
  commits,
  label,
}: {
  markdown: string;
  commits?: string[];
  label?: string;
}) {
  const parsed = parseSummary(markdown);
  // 直接扫整块 markdown（不依赖标题定位——LLM 偶发不输出"## ⭐ 重点标注"
  // 标题会降级成原始文本；只要有序号条目就能解析成卡）
  const highlights = parseHighlights(markdown);

  // 完全没有可拆的内容（防御）：整块渲染
  if (
    highlights.length === 0 &&
    !parsed.overview &&
    !parsed.commits.length &&
    !commits?.length
  ) {
    return <Markdown>{markdown}</Markdown>;
  }

  return (
    <div className={styles.summary}>
      {label && <span className={styles.summaryLabel}>{label}</span>}

      {/* 1. 重点标注卡（签名元素：永远展开，琥珀序号 + 左边条） */}
      {highlights.length > 0 && (
        <ol className={styles.takeaways}>
          {highlights.map((item) => (
            <li key={item.rank} className={styles.takeaway}>
              <span className={styles.takeawayRank}>{item.rank}</span>
              <div className={styles.takeawayBody}>
                <p className={styles.takeawayTitle}>{item.title}</p>
                {item.detail && (
                  <div className={styles.takeawayDetail}>
                    <Markdown>{item.detail}</Markdown>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* 2. 更新概览（默认折叠） */}
      {parsed.overview && (
        <FoldSection dot="model" label="更新概览">
          <div className={styles.overview}>
            <Markdown>{parsed.overview}</Markdown>
          </div>
        </FoldSection>
      )}

      {/* 3. 提交列表（默认折叠） */}
      <CommitFold commits={commits ?? parsed.commits} />
    </div>
  );
}

/** 统一折叠区块：小圆点 + 标签 + 内容（点开才显示） */
function FoldSection({
  dot,
  label,
  children,
}: {
  dot: "model" | "faint";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.fold}>
      <summary className={styles.foldSummary}>
        <span className={`${styles.foldDot} ${styles[`foldDot-${dot}`]}`} />
        {label}
      </summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
}

/** 提交列表折叠（默认收起，优先级最低） */
function CommitFold({ commits }: { commits: string[] }) {
  if (commits.length === 0) return null;
  return (
    <FoldSection dot="faint" label={`提交 · ${commits.length} 条`}>
      <ul className={styles.commitList}>
        {commits.map((c, i) => (
          <li key={i} className={styles.mono}>
            {c}
          </li>
        ))}
      </ul>
    </FoldSection>
  );
}
