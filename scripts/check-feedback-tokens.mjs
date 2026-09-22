#!/usr/bin/env node
/**
 * 反馈色不许复用「面」的 token（C35）—— 跑一下就报。
 *
 * 为什么要有它（2026-09-16 的真实事故）：两个表面色收成同一个 `#ffffff`，于是
 * **反馈静默归零**——幽灵按钮的 hover、菜单的键盘高亮全变成"白底画白"。
 * 它不报错、不变红、构建也不失败，只是"手感变差"，用户当天才发现。
 * C28 的判据：**凡是「需要有人定期回头检查」的字段都会烂** ⇒ 把它变成跑一下就报。
 *
 * 规则：**选择器里带状态**的规则（`:hover` / `:focus` / `:active` / `[data-*]` /
 * `.is-current` …），其 `background` 不许是「面」的 token（`--plate` / `--paper` /
 * `--recorder`）—— 反馈档只许 `var(--feed-*)`，或者干脆用**结构编码**
 * （`box-shadow` / `border` / `outline` 不在这条规则里，它们不算"复用面色"）。
 *
 * 豁免：在声明那一行或**紧邻上一行**写一条 `c35-allow: <理由>` 注释。
 * 理由必须写清楚——豁免是给人看的，`--list` 会把它们全列出来。
 *   （先例：`session-list` 的 `.is-current` 用的是面 + 边，那是"当前项的面"，
 *     不是反馈——原型 `.sess.on` 同款。它该豁免，但要写明。）
 *
 * 用法：
 *   node scripts/check-feedback-tokens.mjs         检查；有违规 → 退出码 1
 *   node scripts/check-feedback-tokens.mjs --list  顺便打印全部命中与豁免的清单
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "app");

/** 「面」的 token：它们只回答"这块地方是什么表面"，不回答"这里发生了什么" */
const SURFACE_TOKENS = ["--plate", "--paper", "--recorder"];
/** 反馈档：C35 新立的两个语义 token */
const FEED_TOKENS = ["--feed-hover", "--feed-active"];

/**
 * 选择器里出现这些 = 它在表达"状态/反馈"，不是在铺面。
 * ⚠️ 键盘选中也走这里（`[data-active]` / `.is-current` / `.active`）——
 * 因为方向键导航改的是 JS 状态，**不走 DOM 焦点**，`:focus-visible` 兜不住。
 */
const STATE_SELECTOR =
  /:hover|:focus|:active|:checked|:target|\[data-|\.is-|\.on\b|\.active\b|current|selected|open/;

const ALLOW_MARK = "c35-allow:";

/**
 * 找出文件里所有块注释的**行号区间**，并挑出带豁免标记的那些。
 *
 * 为什么要按"注释块"而不是"上一行"来认豁免：豁免理由常常一行写不完（换行后第二行
 * 就不含标记了）—— 初版脚本就是这么把自己的豁免看漏的（第一次跑仍报 `.is-current` 违规）。
 * 判据：**豁免注释的结尾必须落在声明那一行、或紧邻它的上一行** —— 写远了的豁免不算数，
 * 免得与它保护的声明失联。
 */
function allowCommentsIn(lines) {
  const comments = [];
  let open = null;
  lines.forEach((line, index) => {
    const starts = line.indexOf("/*");
    const ends = line.indexOf("*/");
    if (open === null && starts !== -1) {
      open = { startLine: index, endLine: null, text: "" };
    }
    if (open !== null) {
      open.text += `${line}\n`;
      if (ends !== -1 && (starts === -1 || ends > starts)) {
        open.endLine = index;
        comments.push(open);
        open = null;
      }
    }
  });
  return comments.filter((comment) => comment.text.includes(ALLOW_MARK));
}

function collectCssFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...collectCssFiles(full));
    else if (name.endsWith(".css")) found.push(full);
  }
  return found;
}

/** 扫一个 CSS 文件，返回违规（借面色的反馈规则）与被豁免的命中。 */
function scanFile(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const allowComments = allowCommentsIn(lines);
  const selectorStack = [];
  const violations = [];
  const allowed = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // 选择器入栈：`sel {` —— 也覆盖 `@media (...) {`（它进栈但不会命中状态正则）
    if (trimmed.includes("{")) {
      const selector = trimmed.replace(/\{.*$/, "").trim();
      if (selector) selectorStack.push(selector);
    }
    if (trimmed.includes("}")) {
      const closes = (trimmed.match(/\}/g) ?? []).length;
      for (let i = 0; i < closes; i++) selectorStack.pop();
    }

    const declaration = trimmed.match(
      /^background(?:-color)?:\s*var\((--[a-z-]+)\)/,
    );
    if (!declaration) return;
    const token = declaration[1];
    if (!SURFACE_TOKENS.includes(token)) return;

    const selector = selectorStack.filter(Boolean).join(" | ");
    if (!STATE_SELECTOR.test(selector)) return;

    const hit = {
      where: `${relative(ROOT, file).replace(/\\/g, "/")}:${index + 1}`,
      token,
      selector,
    };
    // 豁免看本行与紧邻上一行（注释块按"结尾落在哪一行"算）—— 写远了的豁免不算数
    const allowedHere = allowComments.some(
      (comment) => comment.endLine === index || comment.endLine === index - 1,
    );
    (allowedHere ? allowed : violations).push(hit);
  });

  return { violations, allowed };
}

function main() {
  const files = collectCssFiles(SCAN_DIR);
  const violations = [];
  const allowed = [];

  for (const file of files) {
    const result = scanFile(file);
    violations.push(...result.violations);
    allowed.push(...result.allowed);
  }

  if (process.argv.includes("--list")) {
    console.log(
      `扫描 ${files.length} 个 CSS 文件；反馈档只许：${FEED_TOKENS.join(" / ")}`,
    );
    if (allowed.length > 0) {
      console.log(`\n已豁免 ${allowed.length} 处（都写了理由）：`);
      for (const hit of allowed)
        console.log(`  ✓ ${hit.where}  [${hit.token}] ${hit.selector}`);
    }
  }

  if (violations.length === 0) {
    console.log("反馈色与「面」的 token：分家 ✅");
    return;
  }

  console.log(`反馈色借了「面」的 token：${violations.length} 处 ❌`);
  for (const hit of violations) {
    console.log(`  - ${hit.where}  [${hit.token}]`);
    console.log(`      ${hit.selector}`);
  }
  console.log(
    "\n为什么这会出事：面值一改（2026-09-16 就是两个面收成同一个 #ffffff），" +
      "反馈就静默归零 —— 不报错、不变红，只是「手感变差」。\n" +
      `改成 var(${FEED_TOKENS[0]}) / var(${FEED_TOKENS[1]})，或改成结构编码（环 / 条）；` +
      `确实是「面」而非「反馈」的，用 /* ${ALLOW_MARK} 理由 */ 豁免并写明理由。`,
  );
  process.exitCode = 1;
}

main();
