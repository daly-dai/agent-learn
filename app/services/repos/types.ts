// ============================================================
// /api/repos 类型定义（与 app/api/repos/route.ts 响应一一对应）
// ============================================================

/** GET /api/repos 单项：仓库状态 */
export type RepoStatus = {
  name: string;
  isGit: boolean;
  /** git 仓库才有 */
  branch?: string;
  /**
   * git 仓库才有：远端是否有更新（进页面实时 ls-remote 检查）。
   * true = 有更新；false = 已最新；null = 检查失败（断网，不显示 tag）
   */
  hasUpdate?: boolean | null;
};

/** GET /api/repos 响应 */
export type RepoListResult = {
  repos: RepoStatus[];
};

/** LLM 总结（与 lib/repos/summarize.ts 的 UpdateSummary 一致） */
export type UpdateSummary = {
  text: string;
  degraded: boolean;
};

/** POST /api/repos/update 响应 */
export type UpdateResult =
  | {
      /** 有新 commit，已更新 */
      updated: true;
      commits: string[];
      summary: UpdateSummary;
    }
  | {
      /** 已是最新，无新增 */
      updated: false;
      commits: [];
    };

/** 更新历史条目（元信息） */
export type UpdateLogEntry = {
  /** 日期（如 2026-08-31） */
  date: string;
  /** 项目名（如 pi） */
  repoName: string;
  /** 完整文件名 */
  fileName: string;
};

/** 带全文的日志条目（时间线渲染用） */
export type UpdateLogWithContent = {
  /** 日期（如 2026-08-31） */
  date: string;
  /** 完整文件名 */
  fileName: string;
  /** 日志全文（markdown） */
  content: string;
};

/** GET /api/repos/logs 响应（列表） */
export type UpdateLogListResult = {
  logs: UpdateLogEntry[];
};

/** GET /api/repos/logs?name= 响应（该项目全部日志，倒序） */
export type UpdateLogContentResult = {
  logs: UpdateLogWithContent[];
};
