// ============================================================
// 会话路径 —— 唯一的一处拼法（C48）
// ============================================================
// 「会话文件在哪」这件事以前散在 4 处各自 join（manager / 导出 / pipeline /
// 轨迹），漏改一处不报错、只静默少东西。从这个模块起，**谁都不许自己拼**。
//
// 布局（详案 4.1）：
//   <root>/<工作空间键>/<会话目录名>/session.jsonl
//                                   /trace.<runId>.jsonl
//
// 两段编码的判据不同（照抄 DSH 的取舍，判据是"撞了的代价"）：
//   - 工作空间键（projectKey）：**有损** —— 只为"人能看懂、能排序"；
//     撞了只是两个项目混一个目录，身份仍在会话头的 cwd 里。
//   - 会话目录名（encodeSegment）：**单射（无损）** —— 撞了就是覆盖别人的会话。
//
// 纯函数、无 IO：所以能在 node 里直接测，不需要起 dev server。
// ============================================================

import { join } from "node:path";

/** 没有 cwd 的坏数据落这里（DSH 同款约定，正常路径不该出现） */
export const NO_CWD_PROJECT = "_no-cwd";

/** 文件系统单个名字的长度上限留 4 位余量（Windows 255 / ext4 255，取 251 是 DSH 的取舍） */
const MAX_PROJECT_SLUG = 251;

/** 路径段里"原样保留"的字符。故意不含 `~`（它是转义引导符） */
const SAFE_NAME_CHAR = /^[A-Za-z0-9._-]$/;

/**
 * Windows 设备名：无论带不带扩展名，都会被系统当成设备而不是文件。
 * 不避开的话 `sessions/<键>/con/session.jsonl` 在 Windows 上直接写不出来。
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 由工作目录算出「工作空间键」。
 * 有损：`/ \ :` 连续出现压成一个 `-`，其它非法码元转义成 `~XXXX`，末尾截断。
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) {
    throw new Error("工作空间键：工作目录不能为空");
  }

  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index);
    const char = String.fromCharCode(code);
    if (char === "/" || char === "\\" || char === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (char !== "~" && SAFE_NAME_CHAR.test(char)) {
      readable += char;
      separatorRun = false;
    } else {
      readable += escapeCode(code);
      separatorRun = false;
    }
  }

  // 首尾的 `-` 都去掉：`C:\` 这类根路径否则会变成 `--C---`
  const slug = readable.replace(/^-+/, "").replace(/-+$/, "") || "root";
  return `--${truncate(slug, MAX_PROJECT_SLUG)}--`;
}

/**
 * 会话 id → 一个安全的目录名。**单射**：不同 id 永远得到不同结果。
 * 为什么不直接用 id：id 可能来自外部（将来）—— 白名单校验挡得住 `../`，
 * 挡不住 Windows 设备名与结尾的点/空格（系统会静默吃掉它们，导致两个 id 落同一个目录）。
 */
export function encodeSegment(id: string): string {
  if (id.length === 0) {
    throw new Error("会话目录名：id 不能为空");
  }

  let encoded = "";
  for (let index = 0; index < id.length; index++) {
    const code = id.charCodeAt(index);
    const char = String.fromCharCode(code);
    encoded +=
      char !== "~" && SAFE_NAME_CHAR.test(char) ? char : escapeCode(code);
  }

  // `.` / `..` 是路径本身的语法，不能当名字（先于"结尾点"处理，
  // 否则 ".." 会先被结尾规则改掉一半，得到 ".~002E"）
  if (encoded === "." || encoded === "..") {
    encoded = encoded.replace(/\./g, escapeCode(0x2e));
  }
  // Windows 对结尾的 `.` 与空格会静默裁剪 ⇒ 必须在编码层就避开，
  // 否则 "a." 与 "a" 会落成同一个目录（这正是不允许的"撞"）。
  encoded = escapeTrailing(encoded);
  // Windows 设备名会写到设备而不是文件
  if (WINDOWS_RESERVED.test(encoded)) {
    encoded = escapeCode(encoded.charCodeAt(0)) + encoded.slice(1);
  }
  return encoded;
}

/** 会话 id 合法性：只允许字母/数字/下划线/连字符（id 会拼进路径，必须校验） */
export function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/** `<root>/<工作空间键>`；cwd 缺失走 `_no-cwd`（不猜、不补） */
export function projectDir(root: string, cwd: string | undefined): string {
  return join(root, cwd === undefined ? NO_CWD_PROJECT : projectKey(cwd));
}

/** 一个会话独占的目录：主日志与轨迹都住这里，删会话 = 删这个目录 */
export function sessionDir(
  root: string,
  cwd: string | undefined,
  id: string,
): string {
  return join(projectDir(root, cwd), encodeSegment(id));
}

/** 会话主日志（模型上下文） */
export function sessionLogPath(
  root: string,
  cwd: string | undefined,
  id: string,
): string {
  return sessionLogPathIn(sessionDir(root, cwd, id));
}

/**
 * 已经拿到会话目录时的日志路径。
 * 为什么还要一个：按 id 找会话时目录是**扫出来的**（`encodeSegment` 单射但
 * 不可逆，没法从目录名反推 id），此时只有目录、没有 cwd，`sessionLogPath`
 * 用不上。两个入口共用一个常量，日志名仍然只有一处。
 */
export function sessionLogPathIn(sessionDirPath: string): string {
  return join(sessionDirPath, "session.jsonl");
}

/** 一次 run 的轨迹。归属由**目录**保证（传会话目录进来），文件名只承载 runId */
export function tracePath(sessionDirPath: string, runId: string): string {
  return join(sessionDirPath, `trace.${encodeSegment(runId)}.jsonl`);
}

// ------------------------------------------------------------
// 内部：编码原语
// ------------------------------------------------------------

/** 把一个 UTF-16 码元转义成 `~XXXX`（四位大写十六进制） */
function escapeCode(code: number): string {
  return `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * 末尾若落在"Windows 会吃掉"的字符上，就把它转义。
 * `encodeSegment` 循环里只可能残留 `.` / 空格 / `~XXXX` 的尾巴，
 * 所以只处理 `.`（空格已被转义）。
 */
function escapeTrailing(encoded: string): string {
  let trimmed = encoded;
  while (trimmed.endsWith(".")) {
    trimmed = `${trimmed.slice(0, -1)}${escapeCode(0x2e)}`;
  }
  return trimmed;
}

/** 按码元截断，但不切开代理对（切开会产生孤立代理项，落盘后名字就变了） */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const lastKept = value.charCodeAt(max - 1);
  const isHighSurrogate = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return value.slice(0, isHighSurrogate ? max - 1 : max);
}
