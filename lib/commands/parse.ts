// ============================================================
// lib/commands/parse.ts —— 斜杠命令解析纯函数（C13 seam）
// ============================================================
// 抄谁、为什么抄：
//   - name/rest/restOffset 三元组 ← codex parse_slash_name（prompt_args.rs）：
//     无状态、可单测，restOffset 留给未来"光标/选区编辑"用
//   - 分隔符断言 (?=$|[\t\n\r ]) ← DSH parseCommand（interaction/commands）：
//     /foo/bar 不会误命中 /foo（粘贴的路径不触发命令解析）
//   - isSlashCommandLine ← codex should_parse_on_dequeue：
//     行首无空格 + trim 后 / 开头；行首空格是"退出符"（粘贴代码不被误判）
// 本文件不 import 任何东西——命令解析层不碰注册表、不碰文件系统。
// ============================================================

// 命令名：小写字母开头 + 字母/数字/下划线/连字符（DSH COMMAND_NAME 同款）
const COMMAND_NAME = "[a-z][a-z0-9_-]*";
// 行首 / + 合法名，后面必须是行尾或空白分隔（断言，不消费字符）
const SLASH_LINE = new RegExp(`^\\/(${COMMAND_NAME})(?=$|[\\t\\n\\r ])`);

export type ParsedSlashCommand = {
  /** 命令名（不含前导斜杠） */
  name: string;
  /** 命令名后的参数（已去掉前导空白） */
  rest: string;
  /** rest 在原文中的偏移（codex rest_offset，未来光标编辑用） */
  restOffset: number;
};

/**
 * 解析一行命令。返回 null = 不是命令形态（普通消息/路径/大写开头…）。
 * 名字有效性不在这里判——validateSubmission 负责（这里只管"怎么解析"）。
 */
export function parseSlashName(line: string): ParsedSlashCommand | null {
  const match = SLASH_LINE.exec(line);
  if (match === null) return null;
  const name = match[1];
  if (name === undefined) return null; // 正则保证存在，但类型上要收窄
  // match[0] 只含 "/名字"（分隔符是零宽断言），尾部从名字后开始
  const rawTail = line.slice(match[0].length);
  const rest = rawTail.trimStart();
  const restOffset = match[0].length + (rawTail.length - rest.length);
  return { name, rest, restOffset };
}

/**
 * 这行要不要按命令解析（codex should_parse_on_dequeue）：
 * 行首无空格 + trim 后以 / 开头。只看首行、不看多行。
 */
export function isSlashCommandLine(text: string): boolean {
  return !text.startsWith(" ") && text.trim().startsWith("/");
}

/**
 * 提交验证（codex SubmissionValidation 硬边界）：
 * 解析不出命令（普通消息/行首空格/路径）→ ok（按普通消息发）；
 * 解析出名字但未注册 → ok: false（不进模型，报错给用户）。
 * @param names 已注册命令名集合（调用方从注册表取）
 */
export function validateSubmission(
  text: string,
  names: ReadonlySet<string>,
): { ok: true } | { ok: false; name: string } {
  const parsed = parseSlashName(text);
  if (parsed === null) return { ok: true };
  if (names.has(parsed.name)) return { ok: true };
  return { ok: false, name: parsed.name };
}
