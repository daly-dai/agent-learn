#!/usr/bin/env node
/**
 * 池子 ↔ 迭代 的一致性检查。
 *
 * 为什么要有它：手写的状态列**必然漂**（2026-09-14 实测 10 处不一致）——
 * 这个脚本把「记得同步」换成「跑一下就报」。（需求池的 C28 / C42）
 *
 * 用法：
 *   node scripts/check-plan.mjs          检查；漂了 → 退出码 1
 *   node scripts/check-plan.mjs --list   顺便打印池子现状
 *
 * 三条约定（改文档时要跟着改的地方）：
 *   1. 池子行形如 `| C39 | … | 池中 |` —— 只认**最后一个 `|` 之前那一格**（行内可以有别的 `|`）
 *   2. 迭代文档头部有一行 `> **成员**：C36 · C35 · …`
 *   3. 迭代文档若含 `**例外**：`，跳过池子交叉检查
 *      —— 唯一的例外是 `doc/iteration/i0.md`（self-hosting：它正是来让池子存在的）
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ITERATION_DIR = join(ROOT, "doc", "iteration");
const LEGACY_MARKS = ["💡", "⏳"]; // 过渡期口径：这两个视同「池中」，见 PLAN.md 需求池顶部

/** 取表格行最后一格的内容。行内的 `|` 不影响结果——从行尾往前找。 */
function lastCell(line) {
  const trimmed = line.trimEnd();
  if (!trimmed.endsWith("|")) return "";
  const cellEnd = trimmed.length - 1;
  const cellStart = trimmed.lastIndexOf("|", cellEnd - 1);
  return trimmed.slice(cellStart + 1, cellEnd).trim();
}

/** 池子 = `PLAN.md` 里所有 `| <ID> |` 开头的行。锚点是行首 ID（稳定引用符）。 */
function readPool() {
  const text = readFileSync(join(ROOT, "PLAN.md"), "utf8");
  const rows = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const id = line.match(/^\| ([A-Z]+\d+) \|/);
    if (!id) return;
    rows.push({ id: id[1], destination: lastCell(line), line: index + 1 });
  });
  return rows;
}

/** 迭代 = `doc/iteration/*.md`，成员来自头部那行 `> **成员**：…`。 */
function readIterations() {
  const found = [];
  for (const name of readdirSync(ITERATION_DIR).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(ITERATION_DIR, name), "utf8");
    if (/\*\*例外\*\*：/.test(text)) {
      found.push({ name, members: [], selfHosting: true });
      continue;
    }
    const header = text.match(/^> \*\*成员\*\*：(.+)$/m);
    const members = header
      ? header[1].split("·").map((s) => s.trim()).filter(Boolean)
      : [];
    found.push({ name, members, selfHosting: false });
  }
  return found;
}

/** 迭代文件名 `i1.md` → 去向里的代号 `I1`（大小写不敏感地比）。 */
function iterationCode(name) {
  return "I" + name.replace(/^i/, "").replace(/\.md$/, "");
}

/**
 * 两条硬检查（漂了就失败）：
 *   ① 迭代列了某 ID，池子却没把它标成 `→ 对应迭代`
 *   ② 池子标了 `→ I<n>`，那个迭代却没列它
 */
function check(pool, iterations) {
  const problems = [];
  const byId = new Map(pool.map((row) => [row.id, row]));
  const listedIn = new Map(); // ID → [迭代文件名]

  for (const iteration of iterations) {
    const expected = iteration.selfHosting ? null : iterationCode(iteration.name);
    for (const id of iteration.members) {
      if (!listedIn.has(id)) listedIn.set(id, []);
      listedIn.get(id).push(iteration.name);

      const row = byId.get(id);
      if (!row) {
        problems.push(`${iteration.name} 列了 ${id}，但需求池里没有这一行`);
        continue;
      }
      if (expected && row.destination !== `→ ${expected}`) {
        problems.push(
          `需求池 ${id}（PLAN.md:${row.line}）去向是「${row.destination}」，` +
            `但它已在 ${iteration.name} —— 应写成「→ ${expected}」`
        );
      }
    }
  }

  for (const row of pool) {
    const target = row.destination.match(/^→\s*(I\d+)$/);
    if (!target) continue;
    const owner = `${target[1].toLowerCase()}.md`;
    const iteration = iterations.find((i) => i.name === owner);
    if (!iteration) {
      problems.push(`需求池 ${row.id}（PLAN.md:${row.line}）写「${row.destination}」，但没有 ${owner} 这个迭代文件`);
    } else if (!iteration.members.includes(row.id)) {
      problems.push(`需求池 ${row.id} 写「${row.destination}」，但 ${owner} 的成员行里没有它`);
    }
  }

  return problems;
}

function main() {
  const pool = readPool();
  const iterations = readIterations();
  const problems = check(pool, iterations);
  const legacy = pool.filter((row) => LEGACY_MARKS.some((m) => row.destination.includes(m)));

  if (process.argv.includes("--list")) {
    const extracted = pool.filter((row) => /^→\s*I\d+$/.test(row.destination));
    const done = pool.filter((row) => row.destination.startsWith("✅"));
    console.log(`池子 ${pool.length} 行：池中 ${pool.length - extracted.length - done.length}` +
      ` / 已提取 ${extracted.length} / 已交付 ${done.length}`);
    for (const iteration of iterations) {
      console.log(`  ${iteration.name}：${iteration.selfHosting ? "（self-hosting 例外）" : iteration.members.join(" · ") || "（空）"}`);
    }
  }

  if (legacy.length > 0) {
    // 过渡期提示，不是失败：等 C42（表结构收缩）落地后才升为失败。
    console.log(`提示：${legacy.length} 行还在用旧状态位（${LEGACY_MARKS.join(" / ")}）——` +
      `按过渡期口径视同「池中」，见 PLAN.md 需求池顶部。`);
  }

  if (problems.length === 0) {
    console.log("池子 ↔ 迭代：一致 ✅");
    return;
  }
  console.log(`池子 ↔ 迭代：${problems.length} 处不一致 ❌`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}

main();
