// ============================================================
// skill —— 技能加载与渲染（C8）
// ============================================================
// 技能 = 用户级目录 `~/.agents/skills/<名字>/SKILL.md`（外加可选的脚本 /
// 参考文件）。它是**外部数据**（用户手写、随时会改），本模块每条规则都按
// "数据是别人写的"来定：
//
//   1. **身份 = 目录名**，不是 frontmatter 里的 name。目录名天然唯一 ⇒
//      重名冲突从结构上消失；name 降级为校验项，不符就报一条诊断、
//      **仍按目录名加载**（中文技能名是正常的，所以不做 kebab 正则校验——
//      正则只会制造假失败）。
//   2. frontmatter 只认 3 个键（name / description / disable-model-invocation），
//      其余键忽略且不报错（真实技能里就长着 version / author / license /
//      metadata / argument-hint）。
//   3. **坏技能跳过但不静默**：一个 YAML 缩进错不该让 agent 起不来，
//      但"加载失败"必须看得见 —— 诊断随返回值带出去。
//
// 为什么没有缓存：本机 30 个技能全量加载是毫秒级，而技能是用户随时会改的
// 文件 —— 缓存要处理失效，换不来可感知的收益。
// 为什么是同步 IO：调用点都在"组装一次请求"的路径上，量小，且必须拿到
// 结果才能往下走（异步只是把同一段等待换个写法）。
// ============================================================

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 一个加载成功的技能（字段都是**已经解析好**的，调用方不再碰文件） */
export type Skill = {
  /** 身份 = 目录名（不是 frontmatter 的 name） */
  name: string;
  /** frontmatter 的 description（模型靠它判断"这活该不该用这个技能"） */
  description: string;
  /** 技能目录绝对路径（模型读资源时相对它解析） */
  baseDir: string;
  /** 这个技能是从**哪个根**加载的（诊断与界面能说"它从哪来"） */
  root: string;
  /** SKILL.md 去掉 frontmatter 之后的正文 */
  content: string;
  /** 目录下的文件（相对路径、递归、字母序、不含 SKILL.md） */
  files: string[];
  /** false = frontmatter 写了 disable-model-invocation（作者禁止模型自己喊） */
  modelInvocable: boolean;
};

/** 一条"这个技能没加载成功 / 加载了但有毛病"的记录（必须能被看见） */
export type SkillDiagnostic = {
  /** 目录名（或技能根本身），用来定位 */
  name: string;
  /** 绝对路径（拿了就能去改那个文件） */
  dir: string;
  /** 人话原因 */
  reason: string;
};

export type LoadSkillsResult = {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
};

const SKILL_FILE = "SKILL.md";
/** 给模型看的文件清单上限（照 opencode：列不完就别把上下文塞满） */
export const MAX_LISTED_FILES = 10;

/**
 * 扫多个技能根，返回**能用的技能**和**看不见就会出问题的诊断**。
 *
 * 根的顺序 = 优先级（C50，见 `lib/resources`）：**同名技能取第一个命中的**，
 * 后面的同名技能直接忽略（不合并、不覆盖 —— 合并会产生一个"现实中不存在的
 * 技能"，模型看到的东西没人写过）。
 *
 * 根目录不存在 = 这台机器/项目没往这一层放技能 → 跳过，不算错误。
 * 为什么**不**为缺失的根记诊断：四层里通常有两层是不存在的（项目级多半没有），
 * 记了就是每次请求两条噪音；"这技能从哪来"由 `Skill.root` 回答。
 */
export function loadSkills(roots: string[]): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  // 已经出现过的技能名：先到的根赢，后面的同名项不再进列表
  const taken = new Set<string>();

  for (const root of roots) {
    const loaded = loadSkillsFromRoot(root);
    diagnostics.push(...loaded.diagnostics);

    for (const skill of loaded.skills) {
      if (taken.has(skill.name)) continue;
      taken.add(skill.name);
      skills.push(skill);
    }
  }

  return { skills, diagnostics };
}

/** 扫**一个**根（内部用；多根的顺序与去重由 `loadSkills` 负责） */
function loadSkillsFromRoot(skillsRoot: string): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  let dirNames: string[];
  try {
    dirNames = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    // 根不存在不是错（新机器 / 这一层没放技能）；其它读不了要说话
    // —— 静默失败是这个项目最恨的 bug 形态
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { skills, diagnostics };
    }
    return {
      skills,
      diagnostics: [
        {
          name: skillsRoot,
          dir: skillsRoot,
          reason: `技能根读取失败：${errorMessage(error)}`,
        },
      ],
    };
  }

  for (const dirName of dirNames.sort(compareNames)) {
    const loaded = loadOneSkill(dirName, join(skillsRoot, dirName), skillsRoot);

    if (loaded.skill) skills.push(loaded.skill);
    diagnostics.push(...loaded.diagnostics);
  }

  return { skills, diagnostics };
}

/**
 * 读一个技能目录。三种结局：
 *   - 没有 SKILL.md → 不是技能目录（用户会往技能根里放草稿），**不加载也不报警**
 *   - 读到了但不合规 → 只带诊断回来（跳过这个技能）
 *   - 读到了 → 带技能回来（可能**同时**带一条 name 不符的警告）
 */
function loadOneSkill(
  dirName: string,
  baseDir: string,
  root: string,
): { skill: Skill | null; diagnostics: SkillDiagnostic[] } {
  const skillFile = join(baseDir, SKILL_FILE);
  let raw: string;
  try {
    raw = readFileSync(skillFile, "utf8");
  } catch {
    return { skill: null, diagnostics: [] };
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    return {
      skill: null,
      diagnostics: [
        {
          name: dirName,
          dir: baseDir,
          reason: `${SKILL_FILE} 开头不是合法的 frontmatter（应以一行 --- 开始、以一行 --- 结束）—— 跳过这个技能`,
        },
      ],
    };
  }

  const description = parsed.fields.get("description") ?? "";
  if (description === "") {
    return {
      skill: null,
      diagnostics: [
        {
          name: dirName,
          dir: baseDir,
          reason: `frontmatter 缺少 description（标准要求必填）—— 跳过这个技能`,
        },
      ],
    };
  }

  const diagnostics: SkillDiagnostic[] = [];
  const declaredName = parsed.fields.get("name") ?? "";
  if (declaredName !== dirName) {
    diagnostics.push({
      name: dirName,
      dir: baseDir,
      reason:
        declaredName === ""
          ? `frontmatter 没有 name —— 按目录名加载（身份 = 目录名）`
          : `frontmatter 的 name 是 "${declaredName}"，与目录名 "${dirName}" 不一致 —— 按目录名加载（身份 = 目录名）`,
    });
  }

  return {
    skill: {
      name: dirName,
      description,
      baseDir,
      root,
      content: parsed.body,
      files: collectFiles(baseDir),
      modelInvocable: parsed.fields.get("disable-model-invocation") !== "true",
    },
    diagnostics,
  };
}

type Frontmatter = {
  fields: Map<string, string>;
  body: string;
};

/**
 * 解析 SKILL.md 的 frontmatter（`---` 包起来的那一段）。
 *
 * 只管够用：**只认顶格的 `key: value`**。缩进行属于上一个键的嵌套块（真实
 * 技能里 `metadata:` 就带缩进子键）、空行、YAML 注释 —— 这三类都算"合法的
 * 非键行"，忽略。但**顶格又不像 `key: value` 的行**（一句正文）是 YAML 自己
 * 的语法错 ⇒ 说明上面那个"收尾"是假的（其实是正文里的分隔线），判坏、返回
 * null，交给调用方"跳过 + 诊断"。判据就一句：**真 YAML 解析器会报错的行我们
 * 也不收，它会接受的行我们照收** —— 别家全用真解析器，这样谁都不比谁严。
 * 也不做 YAML 全量解析 —— 我们只读 3 个键，为这 3 个键引一个依赖不划算。
 */
function parseFrontmatter(raw: string): Frontmatter | null {
  // Windows 上手写的技能多半是 CRLF；正文要给模型看，统一成 \n
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;

  const endIndex = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (endIndex === -1) return null;

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!match) {
      // 合法的"非键行"三类：空行 / 缩进行（上一个键的嵌套块 —— 真实技能里
      // `metadata:` 就带缩进子键）/ 注释行（技能根跨 harness 共用，别家走真
      // YAML 解析器 ⇒ 注释合法，判坏了是我们制造假阳性）
      if (line.trim() === "" || /^[ \t]/.test(line) || /^\s*#/.test(line)) {
        continue;
      }
      // ⚠️ 顶格、又不像 `key: value` ⇒ 这个"收尾"其实是正文里的分隔线，
      // frontmatter 根本没闭合。返回 null ⇒ 走调用方既有的"跳过 + 诊断"，
      // 绝不能让前半段正文被当成字段静默吞掉（2026-09-17 T8a · a1）。
      return null;
    }
    const [, key, rawValue] = match;
    if (!fields.has(key)) fields.set(key, unquote(rawValue));
  }

  return {
    fields,
    body: lines
      .slice(endIndex + 1)
      .join("\n")
      .replace(/^\n+/, "")
      .trimEnd(),
  };
}

/** 去掉 YAML 里包 value 的引号（真实样本里两种都有：纯文本 / 带转义引号的双引号） */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/**
 * 收集技能目录下的文件（相对路径、递归、字母序）。
 *
 * 为什么递归而不是只列一层：技能的资源长在 `scripts/` 里，只列出一个
 * `scripts/` 对模型没用 —— 它得知道**跑哪个**脚本。
 * 为什么不列 SKILL.md：它的正文已经在同一条消息里给模型了。
 */
function collectFiles(baseDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath =
        prefix === "" ? entry.name : join(prefix, entry.name);
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relativePath);
      } else if (relativePath !== SKILL_FILE) {
        found.push(relativePath);
      }
    }
  };

  try {
    walk(baseDir, "");
  } catch {
    return found; // 目录读不深不算致命：清单残缺总比整个技能加载失败好
  }
  return found.sort(compareNames);
}

/**
 * 清单的引导语。只讲"什么时候用它"，不讲技能是什么（那是各条 description 的活）
 *
 * ⚠️ **这句提到了工具名 `skill`，而且它是手写的 —— 但它是故意留在这里的**（2026-09-16 C34 重验时
 * 专门核过这一处）。理由：它**跟清单同条件存在**（空清单 → 整节省略，见下面 `buildSkillCatalog`
 * 的注释），已经属于"清单自己的一部分"；若按 C34 的归属规则搬进 `lib/tools/skill/` 的
 * `guidelines`，它就会在**一个技能都没装**的时候也照常出现 —— 那反而违反了 T3 定的
 * "空清单整节省略"（会让模型以为"有技能但没列出来"，然后去猜名字）。
 *
 * 判据的优先级：**"不留空标题" > "工具名由工具投稿"**，这一处就是那条优先级的具体落点。
 * 提示词的防线测试（`prompt/index.test.ts`）为此**特意传空清单**，把这一节排除在外。
 */
const CATALOG_LEAD =
  "以下技能可用。开始一项明确匹配某个技能的任务之前，先用 `skill` 工具加载它——不要凭名字猜内容。";

/**
 * 把技能渲染成给模型看的清单（markdown 列表，**只含模型调得动的**），
 * 外加一段「哪些技能没加载成功」的交代。
 *
 * 空清单 + 空诊断 → 空串：调用方据此整节省略，不会在提示词里留一个空标题。
 * ⚠️ **只有诊断、没有清单**时返回的**不是**空串 —— 那是"你装的技能全坏了"，
 * 恰恰最该说出来（见 `renderDiagnosticNote`）。
 *
 * ⚠️ 这里**不写**"若宿主已注入正文就别再加载"那条防重复规则 —— 它只对
 * 手势路径有意义，写成每请求都付的清单成本不划算；由注入那一侧（产品层）
 * 就近说明。
 *
 * ⭐ `diagnostics` 是 2026-09-17 加的（详案 §17）：坏技能"跳过"这条不变，
 * 但"**跳过了这件事**"必须能到人眼前。五家取舍里只有 Reasonix 做到**零 UI
 * 成本还真的到得了人** —— 它的办法是把话**写给模型**，让模型转告用户。
 */
export function buildSkillCatalog(
  skills: Skill[],
  diagnostics: readonly SkillDiagnostic[] = [],
): string {
  const sections: string[] = [];

  const visible = skills.filter((skill) => skill.modelInvocable);
  if (visible.length > 0) {
    sections.push(
      [
        CATALOG_LEAD,
        "",
        ...visible.map((skill) => `- \`${skill.name}\`: ${skill.description}`),
      ].join("\n"),
    );
  }

  if (diagnostics.length > 0) {
    sections.push(renderDiagnosticNote(diagnostics));
  }

  return sections.join("\n\n");
}

/**
 * 诊断段**最多列几条**（⭐ 只封"给模型看的那一份"）。
 *
 * ⚠️ **封的是展示，不是事实**：`loadSkills` 该报几条报几条、服务端日志照打全量、
 * `GET /api/chat/commands` 的响应照给全量 —— **只有进系统提示词这一份封顶**，
 * 因为它有**每请求的 token 成本**。依据是 `PLAN.md` 排期表 **C22** 记的那条：
 * 「**生产者捕获上限与模型输出上限分成两层**……**捕获层要如实报告丢了多少**」。
 *
 * 为什么要有它：诊断是这一节里**唯一会无界增长**的东西（技能清单的长短是 C8 已
 * 拍板接受的，诊断则是"装坏多少就有多少"）。实测今天 0 条，但装机场景可能一次坏一批。
 *
 * ⚠️ 封顶的代价：超出的部分**模型又"不知道"了** —— 所以尾句**必须如实报数**，
 * 让模型把那句也转告出去（否则就退回"只有服务端看得见"）。
 */
const MAX_LISTED_DIAGNOSTICS = 5;

/**
 * 把诊断渲染成一段**给模型看的话** —— 模型会把它转告给用户。
 *
 * 为什么不渲染成人看的告警：我们**没有一个自然的地方放它**（面板是"可选项
 * 列表"，诊断是"出问题了"，两个语义 —— T6 已按此定过），而**能到人眼前的
 * 通道本来就存在**，就是这份清单。于是让模型当传声筒，代价是两行提示词。
 *
 * ⚠️ **已知弱点（诚实记）**：它**依赖模型配合**。模型不提，用户还是不知道 ——
 * 严格说这是"**弱可见**"，不如一个能主动去查的清单硬（pi 的"已加载资源"视图
 * 分节 / codex 的 `skills/list` 带 `SkillErrorInfo` 那样）。所以这里**明说
 * "把下面这条告诉他"**，而不是指望模型自己想到。
 *
 * 带路径是因为**修它要打开那个文件** —— 只给名字，用户还得自己去找。
 */
function renderDiagnosticNote(diagnostics: readonly SkillDiagnostic[]): string {
  const listed = diagnostics.slice(0, MAX_LISTED_DIAGNOSTICS);
  const rest = diagnostics.length - listed.length;

  return [
    `⚠️ 另有 ${diagnostics.length} 个技能**没有加载成功**（原因如下）。`,
    "如果用户问起某个技能为什么不在，或者你要用一个名字却找不到它，**把下面这条告诉他**：",
    ...listed.map((d) => `- \`${d.name}\`（${d.dir}）：${d.reason}`),
    // 封了就要说丢了多少（C22 那条母原则）—— 否则超出的那些又变成"没人知道"
    ...(rest > 0
      ? [
          `- **还有 ${rest} 个没列出**（数量太多）—— 让用户去看服务端日志，那里有全部 ${diagnostics.length} 条`,
        ]
      : []),
  ].join("\n");
}

/**
 * 渲染一条技能的完整内容块。
 *
 * ⭐ **两条加载路径共用这一份渲染**（模型自己调 `skill` 工具 / 宿主按
 * `/名字` 注入），所以模型无论被谁加载，看到的都是同一种形态 —— 抄 DSH
 * 的 `<skill_content>` 信封（`dsh-skill/lib/index.js:57-70`）。
 * 信封的第二个作用是可分辨：轨迹里一眼看得出这段是**宿主塞进来的**，
 * 不是用户手打的字。
 */
export function renderSkillContent(skill: Skill): string {
  const lines = [
    `<skill_content name="${escapeAttr(skill.name)}">`,
    "<skill_resources>",
    `技能目录（绝对路径）：${skill.baseDir}`,
    "正文里提到的相对路径都相对这个目录解析；要用到的脚本 / 参考文件按需再取（脚本用 bash 跑——会弹审批）。",
  ];

  if (skill.files.length > 0) {
    lines.push(
      skill.files.length > MAX_LISTED_FILES
        ? `目录下的文件（共 ${skill.files.length} 个，这里只列前 ${MAX_LISTED_FILES} 个）：`
        : "目录下的文件：",
    );
    lines.push(
      ...skill.files.slice(0, MAX_LISTED_FILES).map((file) => `- ${file}`),
    );
  }

  lines.push(
    "</skill_resources>",
    "",
    "<skill_instructions>",
    skill.content,
    "</skill_instructions>",
    "</skill_content>",
  );

  return lines.join("\n");
}

/** 按名字精确查（名字来自用户输入或模型，**不做模糊/大小写猜测**：猜错比查不到更糟） */
export function findSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find((skill) => skill.name === name);
}

/**
 * 从一条用户消息里找出「裸名手势」点到的技能（C8 T4）。
 *
 * 形状抄 DSH（宿主扫消息里的 `/名字` → 命中就注入一条 user 消息），**但"名字怎么算
 * 命中"不抄它**：DSH 用的是严格 kebab 正则（`(^|\s)/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)`），
 * 照抄会让中文技能名**永远静默失效** —— 而 Q3 已定"身份 = 目录名、不做 kebab 校验"。
 *
 * 规则三条（前两条管"怎么切"，第三条管"怎么判"）：
 *   1. `/` 必须在**串首或空白之后** —— 所以 `5/8` 不是手势
 *   2. 名字 = `/` 之后**到下一个空白或串尾** —— 所以 `/usr/bin` 整段拿去查
 *   3. 拿 `findSkill` **精确查名单**（与身份同一把尺），查不中就静默
 *
 * ⭐ 第 3 条是地基：**"查名单"而不是"用正则猜"**。用正则就得先规定名字长什么样，
 * 而一旦规定了，不符合的名字（中文、带点、带大写）会被**静默忽略** —— 那正是 DSH
 * 那个正则搬到本项目会造成的坏结果。
 *
 * ⚠️ **已知代价**：名字后紧跟中文标点（`/code-review，`）不命中 —— 边界就是空白，
 * 与 DSH 相同。面板选中后插的是 `/名字 `（**带尾空格**，见 `use-command-menu` 的
 * `pickCommand`），所以从面板走踩不到；手打不加空格会静默失效。
 */
export function findSkillInvocations(text: string, skills: Skill[]): Skill[] {
  const found: Skill[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) !== "/") continue;
    // 左边界：串首，或前面紧挨着空白
    if (i > 0 && !isWhitespace(text.charAt(i - 1))) continue;

    // 右边界：下一个空白（或串尾）—— 注意是**空白**不是斜杠
    let end = i + 1;
    while (end < text.length && !isWhitespace(text.charAt(end))) end++;

    const name = text.slice(i + 1, end);
    if (name === "" || seen.has(name)) continue;

    const skill = findSkill(skills, name);
    if (skill === undefined) continue; // 查不中 = 静默：可能是路径 / 分数 / 打错的字
    seen.add(name);
    found.push(skill);
  }

  return found;
}

/** 空白判定：只认 ASCII 空白（用户消息里会出现的分隔就是这四种） */
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** 属性值转义：名字来自**目录名**，而我们明说不做 kebab 校验 ⇒ 引号/& 都可能出现 */
function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

/** 不依赖 locale 的稳定比较（清单顺序要可复现：同样的技能永远同样的提示词） */
function compareNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
