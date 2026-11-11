"use client";

// ============================================================
// DirectoryBrowser —— 「选一个文件夹当工作空间」的对话框（C6）
// ============================================================
// 形态继承已批准原型（workspace/prototype-workspace.html 第二屏）：
//   标题 / 面包屑 / 可编辑路径 / 盘符条 / 目录列表 / 页脚。
//
// 三条与原型不同的决定（都有具体理由，见 doc/plan/workspace.md 4.7）：
//   ① **只读**：原型里的"新建文件夹"已按用户意见砍掉（鸡肋 + 白送一份写权限）。
//   ② **盘符条**：家目录在 C:、工作空间常在 E:，没有它只能手打路径。
//   ③ **点一行 = 进这一层**（不做"选中态"）：选中态和"进入"是两种意图，
//      挤在一个点击上会让人不知道点了会发生什么。要选哪层就进到哪层，
//      页脚会明确写出"将加为工作空间：<当前路径>"。
//
// 生命周期：**关闭即卸载**（页面用 `{open && <DirectoryBrowser/>}`）。所以这里
// 没有 `open` 属性、也不需要"打开时复位"的 effect —— 每次打开都是全新实例，
// 状态天然干净（这比在 effect 里同步 setState 复位可靠，也少一类竞态）。
//
// 键盘：Esc 关闭；路径框里 Enter = 跳到该路径；打开即聚焦路径框。
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { browseDirectory } from "@/app/services/workspaces";
import type {
  Crumb,
  DirectoryEntry,
  DirectoryListing,
} from "@/app/services/workspaces/types";
import styles from "./index.module.css";

type DirectoryBrowserProps = {
  /** 正在提交（登记中）：按钮禁用，避免连点建出两条记录 */
  busy?: boolean;
  /** 服务端拒绝的原因（409 已登记 / 400 路径不对 …），原样显示 */
  error?: string | null;
  /** 会显示在页脚："将加为工作空间：<path>" */
  onPick: (path: string) => void;
  onClose: () => void;
};

export function DirectoryBrowser({
  busy = false,
  error = null,
  onPick,
  onClose,
}: DirectoryBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (path: string | undefined) => {
    try {
      const next = await browseDirectory(path);
      setListing(next);
      setDraftPath(next.path);
      setLoadError(null);
    } catch (e) {
      // 保留上一层的列表：路径打错时不该把已经看到的目录清空
      setLoadError((e as Error).message);
    }
  }, []);

  // 进来先看家目录，并把焦点放到路径框（可以直接粘贴一个路径回车）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首次进入必得发请求，结果只能由 effect 驱动；改成派生值要推翻整个"列表来自网络"的模型（重构级改动）→ 见池子 C46
    load(undefined);
    const timer = setTimeout(() => pathInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = (listing?.entries ?? []).filter(
    (entry) => showHidden || !entry.hidden,
  );
  const currentPath = listing?.path ?? "";

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        // 只有点"背景"才关（点对话框内部不关）
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-browser-title"
      >
        <div className={styles.head}>
          <h2 className={styles.title} id="directory-browser-title">
            新增工作空间 · 选一个文件夹
          </h2>

          <Crumbs crumbs={listing?.crumbs ?? []} onEnter={load} />

          <div className={styles.pathRow}>
            <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
              <path
                d="M2 11h2.2l6.1-6.1-2.2-2.2L2 8.8V11Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <input
              ref={pathInputRef}
              className={styles.pathInput}
              value={draftPath}
              aria-label="直接输入路径"
              spellCheck={false}
              onChange={(event) => setDraftPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") load(draftPath.trim());
              }}
            />
          </div>

          <DriveBar drives={listing?.drives ?? []} onEnter={load} />
        </div>

        <BrowserList
          entries={entries}
          truncated={listing?.truncated ?? false}
          empty={entries.length === 0 && !loadError}
          onEnter={load}
        />

        <div className={styles.foot}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            显示隐藏项
          </label>

          <span className={styles.target} title={currentPath}>
            {currentPath ? `将加为工作空间：${currentPath}` : "正在读取…"}
          </span>

          <button className={styles.ghost} type="button" onClick={onClose}>
            取消
          </button>
          <button
            className={styles.primary}
            type="button"
            disabled={busy || !currentPath}
            onClick={() => onPick(currentPath)}
          >
            {busy ? "登记中…" : "加为工作空间"}
          </button>
        </div>

        {loadError || error ? (
          <p className={styles.error} role="status">
            {loadError ?? error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** 目录列表：点一行 = 进这一层（不做"选中态"，见文件头第 ③ 条） */
function BrowserList({
  entries,
  truncated,
  empty,
  onEnter,
}: {
  entries: DirectoryEntry[];
  truncated: boolean;
  empty: boolean;
  onEnter: (path: string) => void;
}) {
  return (
    <div className={styles.list}>
      {empty ? <p className={styles.note}>这里没有子文件夹。</p> : null}
      {entries.map((entry) => (
        <button
          key={entry.path}
          className={styles.row}
          type="button"
          onClick={() => onEnter(entry.path)}
        >
          <FolderIcon />
          <span className={styles.name}>{entry.name}</span>
          <svg
            className={styles.chevron}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M4.5 2.5 8 6l-3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
      {truncated ? (
        <p className={styles.note}>
          目录太多，只显示了前 1000 个 —— 用面包屑或直接输入路径缩小范围。
        </p>
      ) : null}
    </div>
  );
}

/** 面包屑：每一节都能跳；最后一节是当前层（不可点的观感） */
function Crumbs({
  crumbs,
  onEnter,
}: {
  crumbs: Crumb[];
  onEnter: (path: string) => void;
}) {
  return (
    <nav className={styles.crumbs} aria-label="路径">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={crumb.path} className={styles.crumbItem}>
            <button
              className={
                last ? `${styles.crumb} ${styles.crumbLast}` : styles.crumb
              }
              type="button"
              onClick={() => onEnter(crumb.path)}
            >
              {crumb.name}
            </button>
            {last ? null : (
              <span className={styles.crumbSep} aria-hidden="true">
                ›
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** 盘符条：Windows 上从家目录点不到别的盘，这是必须的出口 */
function DriveBar({
  drives,
  onEnter,
}: {
  drives: string[];
  onEnter: (path: string) => void;
}) {
  if (drives.length === 0) return null;
  return (
    <div className={styles.drives} role="group" aria-label="盘符">
      {drives.map((drive) => (
        <button
          key={drive}
          className={styles.drive}
          type="button"
          onClick={() => onEnter(drive)}
        >
          {drive}
        </button>
      ))}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg
      className={styles.folderIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M1.8 3.6h4.1l1.3 1.5h7v7.3H1.8V3.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
