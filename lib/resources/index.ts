// ============================================================
// lib/resources —— 资源根的解析（C50）
// ============================================================
//
// "这台机器上，技能 / MCP / 项目级配置该从哪几个目录读"——**只有这一处答案**。
//
// 四层，优先级从高到低（同名的东西，第一个命中的赢，其余忽略）：
//   1. <cwd>/.statve       项目级 · 本项目私有
//   2. <cwd>/.agents       项目级 · 与别的 harness 共用（agents 是跨工具约定目录）
//   3. <dataRoot>          用户级 · 本项目私有（默认 `~/.statve`，STATVE_HOME 可改）
//   4. <userHome>/.agents  用户级 · 与别的 harness 共用
//
// 为什么 .statve 排在 .agents 前面（2026-11-11 用户定）：`.statve` 是**我们自己的**
// 目录，`.agents` 是"大家共用"的；出现冲突时，自家目录里的东西应该赢。
//
// ⚠️ 第 3、4 层的**父目录不同**（`~/.statve` vs `~`），这不是笔误：
// `.statve` 是数据根（可被 STATVE_HOME 指到别处），`.agents` 是跨工具约定的
// 用户级目录（就在家目录下）。若把第 4 层写成 `<dataRoot>/.agents`，
// STATVE_HOME 一改，装好的技能就全"消失"了。
//
// ⚠️ **只读**：我们**绝不**在项目里创建 `.statve` / `.agents` —— 上面四个根里
// 不存在就直接跳过。往用户的仓库里偷偷写配置目录，是比"读不到"严重得多的问题。
//
// 纯函数、无 IO：能在 node 里直接测，也不依赖"进程从哪启动"。
// ============================================================

import { join, resolve } from "node:path";

/** 解析资源根要的三个锚点：项目在哪、我们的数据根在哪、用户家目录在哪 */
export type ResourceRootsParams = {
  /** 工作空间目录（会话头里的 canonical cwd） */
  cwd: string;
  /** 数据根（`config.paths.home`，默认 `~/.statve`） */
  dataRoot: string;
  /** 用户家目录（`os.homedir()`）：跨工具共用的 `.agents` 就在它下面 */
  userHome: string;
};

/**
 * 四层资源根，按优先级从高到低。
 * 几个根重合时去重（例如在 dataRoot 里起 dev server、cwd 恰好等于它）：
 * 同一个目录扫两遍没有意义，还会让"同名的取第一个"凭空多出一层。
 */
export function resolveResourceRoots(params: ResourceRootsParams): string[] {
  const candidates = [
    join(params.cwd, ".statve"),
    join(params.cwd, ".agents"),
    params.dataRoot,
    join(params.userHome, ".agents"),
  ];

  const seen = new Set<string>();
  const roots: string[] = [];
  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    // 比较用小写：Windows 文件系统大小写不敏感，`E:\W` 与 `E:\w` 是同一个目录
    const key = absolute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(absolute);
  }
  return roots;
}

/**
 * 技能根：每个资源根下的 `skills/` 子目录。
 * 为什么不是资源根本身：`~/.agents` 里除了技能还有别的东西（各家的配置），
 * 把根目录当技能根扫，会把一堆非技能目录变成"读不到 SKILL.md"的噪音。
 */
export function resolveSkillRoots(params: ResourceRootsParams): string[] {
  return resolveResourceRoots(params).map((root) => join(root, "skills"));
}
