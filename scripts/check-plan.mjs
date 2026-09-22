#!/usr/bin/env node
/**
 * 池子 ↔ 迭代 的一致性检查。
 *
 * 为什么要有它：手写的状态列**必然漂**（2026-09-14 实测 10 处不一致）——
 * 这个脚本把「记得同步」换成「跑一下就报」。（需求池的 C28）
 *
 * 用法：
 *   node scripts/check-plan.mjs          检查；漂了 → 退出码 1
 *   node scripts/check-plan.mjs --list   顺便打印池子现状
 *
 * 约定（改文档时要跟着改的地方）：
 *   1. 池子行形如 `| C39 | … | 未开始 |` —— **格子数必须是 6**
 *      （ID / 做什么 / 依据 / 详细设计 / 验收 / 状态）
 *   2. **状态值域只有四个**（2026-09-18 用户定）：
 *      `未开始` · `已纳入 <迭代或另一项>`（`已纳入 I1` / `已纳入 C24`）· `进行中` · `已交付`
 *   3. 迭代文档头部有一行 `> **成员**：C36 · C35 · …`
 *   4. 迭代文档若含 `**例外**：`，跳过池子交叉检查
 *      —— 唯一的例外是 `doc/iteration/i0.md`（self-hosting：它正是来让池子存在的）
 *   5. 新建的 `doc/plan/<名>.md` **必须在 `PLAN.md` 里被提到**
 *      （池子行 /「横切文档」表 /「地基」小节都算）—— 没有入口的文件就是空壳，
 *      要么挂入口，要么搬 `doc/plan-archive/`（归档区不参与这条检查）
 *   6. `已纳入 <另一项>` 的**容器必须是活的** —— 不能指向 `已交付`（收工的容器 =
 *      死指针），也不能指向另一个 `已纳入`（指针套指针）。2026-09-21 加。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ITERATION_DIR = join(ROOT, "doc", "iteration");
const POOL_CELL_COUNT = 6;
/** 状态值域（PLAN.md 需求池顶部那份口径就是它）。**没有例外** —— 全池子每一行都在这四个值里。 */
const STATUS_RE = /^(未开始|进行中|已交付|已纳入\s+(I\d+|[A-Z]+\d+))$/;

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
    const cells = line
      .trimEnd()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    rows.push({
      id: id[1],
      cellCount: cells.length,
      detail: cells[3] ?? "", // 第 4 格 =「详细设计」（导航：文件在哪）
      acceptance: cells[4] ?? "", // 第 5 格 =「验收」—— **定案的门禁就是这一格**
      status: lastCell(line), // 第 6 格 =「状态」（值域只有四个）
      // 行内引用的详案文件 —— 用来查悬空引用
      planRefs: [...line.matchAll(/doc\/plan\/[A-Za-z0-9._-]+\.md/g)].map(
        (m) => m[0],
      ),
      line: index + 1,
    });
  });
  return rows;
}

/** 迭代 = `doc/iteration/*.md`，成员来自头部那行 `> **成员**：…`。 */
function readIterations() {
  const found = [];
  for (const name of readdirSync(ITERATION_DIR).filter((f) =>
    f.endsWith(".md"),
  )) {
    const text = readFileSync(join(ITERATION_DIR, name), "utf8");
    if (/\*\*例外\*\*：/.test(text)) {
      found.push({ name, members: [], selfHosting: true });
      continue;
    }
    const header = text.match(/^> \*\*成员\*\*：(.+)$/m);
    const members = header
      ? header[1]
          .split("·")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    found.push({ name, members, selfHosting: false });
  }
  return found;
}

/** 迭代文件名 `i1.md` → 状态里的代号 `I1`。 */
function iterationCode(name) {
  return "I" + name.replace(/^i/, "").replace(/\.md$/, "");
}

/** 状态 → 它指向的迭代代号（`已纳入 I1` → `I1`；别的都返回 null）。 */
function statusIteration(status) {
  const m = status.match(/^已纳入\s+(I\d+)$/);
  return m ? m[1] : null;
}

/** 状态 → 它指向的另一项 ID（`已纳入 C24` → `C24`；但 `I1` 不算 ID）。 */
function statusAbsorbedBy(status) {
  const m = status.match(/^已纳入\s+([A-Z]+\d+)$/);
  if (!m) return null;
  return /^I\d+$/.test(m[1]) ? null : m[1];
}

/**
 * 硬检查（漂了就失败）：
 *   ① 迭代列了某 ID，池子那一格却不是「已纳入 本迭代 / 进行中 / 已交付」
 *   ② 池子写「已纳入 I<n>」，却没有那个迭代文件、或那个迭代没列它
 *   ③ 池子写「已纳入 <另一项>」，而那一项不在池子里
 */
function check(pool, iterations) {
  const problems = [];
  const byId = new Map(pool.map((row) => [row.id, row]));

  for (const iteration of iterations) {
    const expected = iteration.selfHosting
      ? null
      : iterationCode(iteration.name);
    for (const id of iteration.members) {
      const row = byId.get(id);
      if (!row) {
        problems.push(`${iteration.name} 列了 ${id}，但需求池里没有这一行`);
        continue;
      }
      if (!expected) continue;
      const ok =
        statusIteration(row.status) === expected ||
        row.status === "进行中" ||
        row.status === "已交付";
      if (!ok) {
        problems.push(
          `需求池 ${id}（PLAN.md:${row.line}）状态是「${row.status}」，但它已在 ${iteration.name} —— ` +
            `应写成「已纳入 ${expected}」（或 进行中 / 已交付）`,
        );
      }
    }
  }

  for (const row of pool) {
    const code = statusIteration(row.status);
    if (code) {
      const owner = `${code.toLowerCase()}.md`;
      const iteration = iterations.find((i) => i.name === owner);
      if (!iteration) {
        problems.push(
          `需求池 ${row.id}（PLAN.md:${row.line}）写「${row.status}」，但没有 ${owner} 这个迭代文件`,
        );
      } else if (!iteration.members.includes(row.id)) {
        problems.push(
          `需求池 ${row.id} 写「${row.status}」，但 ${owner} 的成员行里没有它`,
        );
      }
      continue;
    }
    const absorbed = statusAbsorbedBy(row.status);
    if (absorbed && !byId.has(absorbed)) {
      problems.push(
        `需求池 ${row.id}（PLAN.md:${row.line}）写「${row.status}」，但池子里没有 ${absorbed} 这一项`,
      );
    }
  }

  return problems;
}

/** 状态必须在值域里（四个值）。**没有例外** —— C38 那一格 2026-09-20 搬进文件后也收编了。 */
function checkStatusDomain(pool) {
  const problems = [];
  for (const row of pool) {
    if (!STATUS_RE.test(row.status)) {
      problems.push(
        `需求池 ${row.id}（PLAN.md:${row.line}）状态是「${row.status}」，不在值域里` +
          `（未开始 / 已纳入 <迭代或另一项> / 进行中 / 已交付）`,
      );
    }
  }
  return problems;
}

/**
 * 池子行的形状：必须 6 格。
 * 为什么值得单列一条：多出来的那格是**旧状态位没删**（`⏳ 排队` 后面又追一个 `已纳入 I1`）——
 * 它不影响 `lastCell` 取到正确状态，但**同一行里躺着两个状态**，正是底部那句
 * 「每个值只在一次动作里变一次 —— 所以它不会漂」要防的东西。
 * （2026-09-18 手工体检抓出 C36 / C24 两行，才补上这条检查。）
 */
function checkRowShape(pool) {
  const problems = [];
  for (const row of pool) {
    if (row.cellCount !== POOL_CELL_COUNT) {
      problems.push(
        `需求池 ${row.id}（PLAN.md:${row.line}）有 ${row.cellCount} 格，应为 ${POOL_CELL_COUNT} 格` +
          `（ID / 做什么 / 依据 / 详细设计 / 验收 / 状态）—— 多出来的通常是没删干净的旧状态`,
      );
    }
  }
  return problems;
}

/** 池子行指向的详案文件必须真实存在 —— 「一个错的索引比没有索引更糟」。 */
function checkPlanFileRefs(pool) {
  const problems = [];
  for (const row of pool) {
    for (const ref of row.planRefs) {
      if (!existsSync(join(ROOT, ref))) {
        problems.push(
          `需求池 ${row.id}（PLAN.md:${row.line}）指向 ${ref}，但那个文件不存在`,
        );
      }
    }
  }
  return problems;
}

/**
 * 反方向的那一条：盘上每个 `doc/plan/*.md`，**必须在 `PLAN.md` 里被提到**
 * （池子行 /「横切文档」表 /「地基」小节都算 —— 判据是"PLAN.md 是唯一入口"）。
 * 为什么要有它：规则写着「空壳文件数应当永远是 0」「建新文件前先找现成的」——
 * 但**没人指向的文件，人不会去打开它**，所以只能机器查。
 * `doc/plan-archive/` 不参与：那是归档区，"没有入口"正是搬进去的理由。
 */
function checkOrphanPlanFiles() {
  const problems = [];
  const planText = readFileSync(join(ROOT, "PLAN.md"), "utf8");
  for (const name of readdirSync(join(ROOT, "doc", "plan")).filter((f) =>
    f.endsWith(".md"),
  )) {
    if (planText.includes(name)) continue;
    problems.push(
      `doc/plan/${name} 在 PLAN.md 里没有任何地方提到它 —— ` +
        `要么给它挂个入口（需求池行 /「横切文档」表 /「地基」小节），要么搬去 doc/plan-archive/`,
    );
  }
  return problems;
}

/**
 * 「已纳入 <另一项>」的**容器必须是活的**（2026-09-21 加）。
 *
 * 这条指针的语义是"**进度看被并入的那一项**"（`PLAN.md` 顶部那份口径）——
 * 所以容器若已经**交付**，指针就指着一个不会再动的东西（想跟也跟不动）；
 * 若它自己也写着「已纳入 Y」，那是指针套指针、中间那层谁都不落到实地。
 *
 * 为什么值得单列一条：前面几条只查"目标**存在**" —— 2026-09-21 实测，
 * C22 / C23 一直写着「已纳入 C24」，而 C24 已经是 `已交付`，脚本照样报 ✅。
 * **「一个事实几份」的漂移，正是从这种"被引用那一端没人管"里漏出来的。**
 * （合法容器：`未开始` / `进行中` / `已纳入 I<n>` —— 前两者是"还有活要干"，
 * 后者是"已经在跑、进度看那份迭代 md"。）
 */
function checkAbsorbedTargetAlive(pool) {
  const problems = [];
  const byId = new Map(pool.map((row) => [row.id, row]));
  for (const row of pool) {
    const absorbed = statusAbsorbedBy(row.status);
    if (!absorbed) continue;
    const target = byId.get(absorbed);
    if (!target) continue; // 目标不存在由 check() 报，别重复报同一个因
    const chained = statusAbsorbedBy(target.status);
    if (target.status === "已交付") {
      problems.push(
        `需求池 ${row.id}（PLAN.md:${row.line}）写「${row.status}」，但 ${absorbed} 已经是「已交付」` +
          ` —— 指针指向一个收工的容器：跟着它一起处置（已交付 / 未开始），或改指还在跑的项`,
      );
    } else if (chained) {
      problems.push(
        `需求池 ${row.id}（PLAN.md:${row.line}）写「${row.status}」，而 ${absorbed} 自己也写「${target.status}」` +
          ` —— 指针套指针，拉直成「已纳入 ${chained}」`,
      );
    }
  }
  return problems;
}

/**
 * 「有文件」≠「能开工」：已进迭代（或已开工）的项，**验收格非 `—`** 才算定案。
 * 现在只当提示（I1 正在跑、按顺序补详案是既定计划）；等模型稳定后升为失败。
 * 为什么不查文件里的小标题：C33 的详案是 `c8-skills.md` 的 11.2 节，标题里没有「详细设计」四个字 ⇒ 猜就会误报。
 */
function planReadinessHints(pool) {
  const hints = [];
  for (const row of pool) {
    if (!statusIteration(row.status) && row.status !== "进行中") continue;
    if (row.acceptance === "—" || row.acceptance === "") {
      hints.push(`${row.id} 的「验收」格还是空的 ⇒ 没定案，不许开工`);
    }
  }
  return hints;
}

/**
 * 「现在在跑哪个迭代」—— **由池子推导，不落成字段**（落了就会漂，C28 的老毛病）。
 * 判据：迭代成员里只要还有一行**没到 `已交付`**，这个迭代就还在跑；
 * 一个都没有 ⇒ 如实说"没有在跑的迭代"，并给出**起新一批**的三步（免得下个会话
 * 面对"入口是空的"发愣）。派生出来的读数不会漂，因为它没有第二份。
 */
function reportCurrentIterations(iterations, pool) {
  const byId = new Map(pool.map((row) => [row.id, row]));
  const running = iterations
    .filter((iteration) => !iteration.selfHosting)
    .map((iteration) => ({
      name: iteration.name,
      total: iteration.members.length,
      pending: iteration.members.filter(
        (id) => byId.get(id)?.status !== "已交付",
      ),
    }))
    .filter((iteration) => iteration.pending.length > 0);

  if (running.length === 0) {
    console.log(
      "当前没有在跑的迭代（池子里没有「已纳入 I<n>」的行）—— 起新一批：从池子挑成员（三格齐）" +
        " → 建 doc/iteration/i<n>.md（头部写「> **成员**：…」）→ 那几格标「已纳入 I<n>」",
    );
    return;
  }
  for (const iteration of running) {
    console.log(
      `当前在跑：${iteration.name}（${iteration.pending.length}/${iteration.total} 未交付：${iteration.pending.join(" · ")}）`,
    );
  }
}

function main() {
  const pool = readPool();
  const iterations = readIterations();
  const problems = [
    ...check(pool, iterations),
    ...checkPlanFileRefs(pool),
    ...checkOrphanPlanFiles(),
    ...checkRowShape(pool),
    ...checkStatusDomain(pool),
    ...checkAbsorbedTargetAlive(pool),
  ];
  const hints = planReadinessHints(pool);
  const count = (re) => pool.filter((row) => re.test(row.status)).length;

  if (process.argv.includes("--list")) {
    const absorbed = pool.filter((row) => statusAbsorbedBy(row.status)).length;
    const inIteration = pool.filter((row) =>
      statusIteration(row.status),
    ).length;
    console.log(
      `池子 ${pool.length} 行：未开始 ${count(/^未开始$/)} / 已纳入 ${inIteration + absorbed}` +
        `（迭代 ${inIteration} · 被并入 ${absorbed}）/ 进行中 ${count(/^进行中$/)} / 已交付 ${count(/^已交付$/)}`,
    );
    for (const iteration of iterations) {
      console.log(
        `  ${iteration.name}：${iteration.selfHosting ? "（self-hosting 例外）" : iteration.members.join(" · ") || "（空）"}`,
      );
    }
  }

  reportCurrentIterations(iterations, pool);

  if (hints.length > 0) {
    // 提示，不是失败：I1 正在跑，成员按顺序补详案是既定计划。
    console.log(`提示：${hints.length} 项已进迭代但还没定案 ——`);
    for (const hint of hints) console.log(`  · ${hint}`);
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
