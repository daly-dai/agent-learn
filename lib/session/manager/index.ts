// ============================================================
// SessionManager —— 会话目录级操作（Phase 2 多会话）
// ============================================================
//
// 布局（唯一一处拼法在 `lib/session/paths`）：
//   <根>/<工作空间键>/<会话目录>/session.jsonl
//                                  /trace.<runId>.jsonl
//
// 本模块管「会话本身」：list / create / rename / delete / locate。
// 对话读写不在这里——那是 JsonlSessionStore 的事（每请求新建）。
//
// 为什么方法都自己扫目录、不留内存索引（2026-11-11）：
//   索引会与磁盘漂移（删了目录索引还在 / 手工放进来的会话查不到），而这里
//   一次 readdir 的量级是「几十个项目 × 几十个会话」，代价远小于"两个真相"。
//
// 为什么列表要扫**所有**项目目录：会话不再有"当前工作区"这个概念 ——
//   侧栏是按工作空间分组的全量列表，所以 `list()` 天然是全局的。
// ============================================================

import {
  readFile,
  readdir,
  rename as renameFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { SessionEntry } from "../../types";
import { messageText } from "../../message";
import { config } from "../../config";
import { JsonlSessionStore } from "../store";
import {
  encodeSegment,
  isValidSessionId,
  projectDir,
  sessionDir,
  sessionLogPathIn,
} from "../paths";

export type SessionSummary = {
  id: string;
  title?: string;
  /** 文件最后修改时间（毫秒），用作「最近活跃」排序与展示 */
  updatedAt: number;
  /** 首条用户消息的文本（截断），列表里给个上下文提示 */
  preview?: string;
  /** 会话所属工作空间的 canonical 路径（来自会话头），分组就靠它 */
  cwd: string;
};

/** 一个会话在磁盘上的三样东西：目录、主日志、工作空间路径 */
export type SessionLocation = {
  dir: string;
  logPath: string;
  cwd: string;
};

export class SessionManager {
  /** 会话根（`config.paths.sessions`），下面一层是工作空间键、再一层是会话目录 */
  constructor(private readonly root: string) {}

  /** 扫全部分组列出所有会话，按最近活跃倒序 */
  async list(): Promise<SessionSummary[]> {
    const summaries: SessionSummary[] = [];

    for (const found of await scanSessions(this.root)) {
      const summary = await summarizeSessionFile(found);
      // 坏会话跳过，不挂掉整个列表（半创建的目录 / 手工放进去的垃圾）
      if (summary) summaries.push(summary);
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 新建空会话：先写临时目录再整体改名；title 可选；返回生成的 id */
  async create(input: { cwd: string; title?: string }): Promise<string> {
    const id = generateSessionId();
    const targetDir = sessionDir(this.root, input.cwd, id);
    // 临时目录与目标同在「项目目录」下 ⇒ rename 是同一文件系统内的原子操作。
    // 为什么要原子：半创建的会话目录 = 列表里一条打不开的会话（有目录、没头）。
    const tempDir = join(
      projectDir(this.root, input.cwd),
      `.tmp-${encodeSegment(id)}-${Math.random().toString(36).slice(2, 8)}`,
    );

    // 复用 JsonlSessionStore 写头：文件不存在时 loadOrCreate 会建目录 + 写头。
    // 实例用完即弃（没有消息可读），这只是「借它的写头逻辑」。
    new JsonlSessionStore({
      filePath: sessionLogPathIn(tempDir),
      cwd: input.cwd,
      sessionId: id,
      title: input.title,
    });

    await renameFile(tempDir, targetDir);
    return id;
  }

  /** 重命名：只改文件第一行（头）的 title，其余行不动 */
  async rename(id: string, title: string): Promise<void> {
    const location = await this.locate(id);
    if (!location) throw new Error(`会话不存在：${id}`);

    const raw = await readFile(location.logPath, "utf8");
    const lines = raw.split("\n");
    if (!lines[0]?.trim()) {
      throw new Error(`会话文件为空：${id}`);
    }
    const header = JSON.parse(lines[0]) as SessionEntry;
    if (header.type !== "session") {
      throw new Error(`会话文件头损坏：${id}`);
    }
    // title 为空串 = 清除显示名，回退用 id
    lines[0] = JSON.stringify(
      title.trim()
        ? { ...header, title: title.trim() }
        : { ...header, title: undefined },
    );

    // 原子替换（C18 A 档 ②）：先写同目录临时文件，再 rename 覆盖。
    // 为什么必须原子：本函数是「全量读 → 改首行 → **全量写回**」，实测最大会话
    // 124KB。直接 writeFile 到目标路径时，若进程在写回中途被杀——**dev server
    // 随改代码反复重启，这个窗口天天出现**——文件会被截断成半截 JSON，会话永久
    // 损坏。同一目录内的 rename 在同一文件系统上是原子的：任何时刻崩溃，要么
    // 看到完整旧内容、要么看到完整新内容，最坏只留一个 .tmp 残骸。
    const tmpPath = `${location.logPath}.tmp`;
    await writeFile(tmpPath, lines.join("\n"), "utf8");
    await renameFile(tmpPath, location.logPath);
  }

  /** 删除整个会话目录（含全部轨迹）。会话层不再需要知道轨迹布局：目录就是边界 */
  async delete(id: string): Promise<void> {
    const location = await this.locate(id);
    if (!location) throw new Error(`会话不存在：${id}`);
    // force: 目录已空/只剩轨迹也能删干净；recursive: 轨迹与日志一起走
    await rm(location.dir, { recursive: true, force: true });
  }

  /**
   * 按 id 找会话（扫所有项目目录，拿目录名与 `encodeSegment(id)` 比）。
   * 为什么用编码比而不是读头里的 id：编码是**单射**的，比一次字符串就知道
   * 是不是同一个会话；读头则要为每个候选都开文件。
   */
  async locate(id: string): Promise<SessionLocation | undefined> {
    const dirName = encodeSegment(id);

    for (const found of await scanSessions(this.root)) {
      if (found.dirName !== dirName) continue;
      return readLocation(found);
    }
    return undefined;
  }
}

// ------------------------------------------------------------
// 生产环境的单例
// ------------------------------------------------------------
/**
 * 会话根来自 `config.paths.sessions`（唯一配置入口）。
 * 为什么放这里而不是每个路由各 new 一个：根只有一个，"会话在哪"的答案也只该
 * 有一份；测试要换根时直接 `new SessionManager(临时目录)`，不碰这个单例。
 * ⚠️ 必须写在 class 之后：class 声明有 TDZ（暂时性死区），写在前面会 ReferenceError。
 */
export const sessionManager = new SessionManager(config.paths.sessions);

// ------------------------------------------------------------
// 模块级纯函数
// ------------------------------------------------------------

/** 会话 id 合法性：只允许字母/数字/下划线/连字符。
 *  为什么必须校验：id 会拼进文件路径，不校验就能用 `../../x` 越界读写
 *  ——这是 tools.ts 路径沙箱（resolveInsideWorkspace）的精神在会话层的补课。 */
export { isValidSessionId };

export function generateSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `s_${stamp}_${random}`;
}

/** 扫出来的一层：会话目录 + 目录名（比 id 用） */
type FoundSession = {
  dir: string;
  dirName: string;
  logPath: string;
};

/** 会话根 → 所有「看起来像会话目录」的位置。读不到目录就返回空（还没建过会话） */
async function scanSessions(root: string): Promise<FoundSession[]> {
  const found: FoundSession[] = [];

  for (const projectPath of await listProjectDirs(root)) {
    const entries = await readdir(projectPath, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      // `.tmp-*` 是 create() 中途的临时目录：它不是会话，别列也别匹配
      if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue;
      found.push({
        dir: join(projectPath, entry.name),
        dirName: entry.name,
        logPath: sessionLogPathIn(join(projectPath, entry.name)),
      });
    }
  }

  return found;
}

async function listProjectDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

/** 读会话头拿工作空间路径；头坏了就没有「地点」可言，返回 undefined 让调用方跳过 */
async function readLocation(
  found: FoundSession,
): Promise<SessionLocation | undefined> {
  const header = await readHeader(found.logPath);
  if (!header) return undefined;
  return { dir: found.dir, logPath: found.logPath, cwd: header.cwd };
}

async function readHeader(
  logPath: string,
): Promise<Extract<SessionEntry, { type: "session" }> | undefined> {
  try {
    const raw = await readFile(logPath, "utf8");
    const firstLine = raw.split("\n").find((line) => line.trim());
    if (!firstLine) return undefined;
    const header = JSON.parse(firstLine) as SessionEntry;
    return header.type === "session" ? header : undefined;
  } catch {
    return undefined;
  }
}

/** 读一个会话文件，压成列表用的一条摘要。坏文件返回 null（不挂掉整个列表） */
async function summarizeSessionFile(
  found: FoundSession,
): Promise<SessionSummary | null> {
  try {
    const raw = await readFile(found.logPath, "utf8");
    const mtime = await stat(found.logPath).then((s) => s.mtimeMs);

    let id: string | undefined;
    let cwd: string | undefined;
    let title: string | undefined;
    let preview: string | undefined;

    for (const line of raw.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as SessionEntry;
      if (entry.type === "session") {
        id = entry.id;
        cwd = entry.cwd;
        title = entry.title;
        continue;
      }
      // 预览是单行展示：messageText 保留结构（模型/摘要用），
      // 这里把换行压成空格再截断，避免会话列表出现换行。
      if (
        entry.type === "message" &&
        preview === undefined &&
        entry.message.role === "user"
      ) {
        preview = truncate(messageText(entry.message).replace(/\n/g, " "), 60);
      }
    }

    // 没有头 = 不是会话（半创建目录 / 别的什么东西），不列
    if (!id || !cwd) return null;

    return {
      id,
      cwd,
      ...(title ? { title } : {}),
      updatedAt: mtime,
      ...(preview ? { preview } : {}),
    };
  } catch {
    return null;
  }
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}…`;
}
