# DSH skill 装载机制：两条加载路径（源码精读）

> 精读对象：`@deepseek-ai/dsh-tool-skill@0.1.5-rc.2`（`lib/index.js`，396 行）+ `@deepseek-ai/dsh-skill@0.1.5-rc.2`（`lib/index.js`，565 行）+ `@deepseek-ai/dsh-api-session-controller`（`lib/types/skill-catalog.js`，192 行）。
> 本机路径：`D:\DSH Desktop\resources\app\node_modules\@deepseek-ai\...`。⚠️ **本机只有编译产物**（`lib/index.js`），**没有 `src/`、没有 sourcemap** —— 上游 monorepo 的 TS 路径是 `packages/skill/tool-skill/src/index.ts`（见包 `package.json` 的 `repository.directory`），**行号与本文件不一致**，引用时务必写明是哪个。
> 配套：`doc/plan/c8-skills.md`（我方 C8 讨论稿 —— 本文是它第二层「`/skill:<name>` 的注入形态」那题的证据）。
> 本文回答：**你在输入框打 `/frontend-design` 之后，到模型看到 skill 正文之间，到底发生了什么？模型需要自己调工具吗？**

---

## 一、一句话结论

> **不需要。** `/名字` 是**宿主在模型看不到的地方**直接完成的加载动作 —— 模型收到正文时，**它的工具调用记录里什么都没有**。
> 模型自己调 `skill` 工具是**另一条路**，两条路**共用同一个渲染函数**，所以模型看到的形态完全一致。

这个结论有个直接推论，值得单独记住：

> **"模型能不能加载技能"和"模型会不会加载技能"是两个问题。** 工具路线把第二个问题交给模型的判断力；手势路线**取消了这个问题** —— 你打了就是加载了，不赌模型认不认得出来。

---

## 二、两条路径的分叉点

```
你按下回车：「/frontend-design 帮我看看这个页面」
      │
      ├──────────────── 路径 A：模型裁量（先有目录，再有工具调用）────────────────
      │   pre-step 注入目录（只有 name + description）
      │     → 模型自己判断"任务匹配" → 调 skill 工具 → 工具结果 = 正文
      │
      └──────────────── 路径 B：宿主确定性（你打了就加载）────────────────────────
          你的原话原样进会话（含字面 "/frontend-design"）
            → pre-step 钩子扫这一批消息里的 /名字 token
            → 命中且"用户可调用" → 渲染正文
            → 作为一条 user 消息【追加在该步所有注入的最后】
            → 模型直接收到正文，零工具调用
```

| | 路径 A（工具） | 路径 B（手势） |
|---|---|---|
| 谁发起 | 模型 | 宿主 |
| 到达形态 | **工具结果**（`role: "tool"`），进普通工具历史 | **user 消息**（指令上下文） |
| 正文渲染 | `renderSkillContent` | **同一个** `renderSkillContent` |
| token 谁付 | 模型裁量后才付 | **无条件付**（打了就付） |
| 谁控制时机 | 模型判断力 | 你 |
| 失败长什么样 | 模型没调 → 技能没生效（无报错） | 名字打错 → **静默当普通行文**（见第五节） |

**为什么两条路必须共用一个渲染**：`dsh-skill` 的注释写明，输出被 `skill` 工具结果与"用户显式注入"**逐字共用**，为的是模型在两条路上看到**同一种** `<skill_content>` 形态。→ 模型不需要知道"我是怎么拿到它的"。

---

## 三、手势路径的五个机械细节（最容易被想歪的地方）

### 1. 你的原话**原样**到达，`/名字` 字面还在

手势**不是**替换、不是删除、不是转成结构化载荷。它就是普通用户消息，宿主在旁边**又追加了一条**。所以模型同时看到"你打了什么"和"正文"。

### 2. 只扫 `source.kind === "user"` 的消息 → **注入无法自我触发**

```js
// dsh-tool-skill/lib/index.js:384
if (message.source.kind !== "user") continue;
```

这条守卫是个**安全不变式**，不只是过滤：注入消息自身带 `source: { kind: "skill-invocation" }`，**所以一条注入永远不可能撞出下一次注入**（防递归、防伪造）。源码注释原话：*"Every text block of direct user input is scanned; **no other source can forge a gesture**."*

→ **可复用判据**：凡是"能被文本触发、且会往上下文里塞东西"的机制，触发源必须**白名单化**（只认人类输入这一种来源）。

### 3. 渲染是唯一的（`renderSkillContent`）

```
<skill_content name="frontend-design">
<skill_resources>
Base directory for this skill: C:\Users\25082\.agents\skills\frontend-design
Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
</skill_resources>

<skill_instructions>
（SKILL.md 正文，逐字嵌入）
</skill_instructions>
</skill_content>
```

三个细节：**①** 资源提示是**按 provider 类型分叉**的（`directory` / `url` / `opaque`，见 `dsh-skill/lib/index.js:71-81`）—— 目录型给绝对路径 + "相对路径按它解析"；**②** 名字走转义属性、正文**逐字嵌入**（技能是可信本地内容，而用户手打的文本**不进**这个包装）；**③** 模型侧的 prose 会被转义，**防 provider 提供的文字伪造闭合标签**（`escapeText` 转 `<` `>`）。

### 4. 注入位置在**最后** —— 有语义，不是随手

```js
// dsh-tool-skill/lib/index.js:200
messages: [...decision.messages, ...injections]
```

上游 README 的原话是：*"追加在该步骤所有其他注入之后 —— **背景在前，模型要着手处理的材料在最后**"*。→ 这条对我们排布"背景知识 / 本轮任务"有直接参考价值。

### 5. 注入带**来源标记**，所以轨迹里分得清

```js
source: { kind: "skill-invocation", name, form: "instructions" }
```

⭐ 这条对我们**直接有用**：我们在做 A3 轨迹视图，如果 `/skill:<name>` 的注入也照这么做，轨迹里就能区分「**用户真打的字**」和「**宿主注入的块**」，而不是混成一坨 user 消息、事后查不出正文哪来的。

---

## 四、目录（progressive disclosure 的落地点）

目录是**路径 A 的唯一入口**，形态比想象中克制：

```js
// dsh-tool-skill/lib/index.js:294
`- \`${entry.name}\`: ${entry.description}`
```

**只有名字 + 描述，没有路径。** 四周包一层 `<system-reminder>`，结尾两句是**行为约束**（`lib/index.js:250-251`）：

> If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name **before taking task actions**. … This catalog contains summaries only; **do not infer or follow a skill's instructions until it has been loaded.**
> A user may also invoke a skill directly; its `<skill_content>` block then appears in this conversation. **Follow it, and do not call the `skill` tool again for that skill.**

第二句就是**防双载**：模型已经从注入里拿到正文了，再调一次工具纯属重复付钱。

### 目录是"持久投影 + digest 差异"，不是每步重发

| 机制 | 位置 | 为什么这么设计 |
|---|---|---|
| 按 `[name, description]` 的 **sha256** 比较，不比较渲染后的正文 | `lib/index.js:301-304` | 包装（`<system-reminder>` 那些字）是给模型看的，**它变了不该触发重新发布** |
| 变了才发，且发的是**完整替换目录**："This complete catalog replaces every earlier available-skills list" | `lib/index.js:262-286` | 旧清单还躺在历史里 → 必须有一句话作废它 |
| 技能全没了 → 发**空目录**，并明说 "Do not use names from earlier skill catalogs" | `lib/index.js:263` | 否则历史里的旧名字继续生效 |
| 快照不完整（`!snapshot.complete`）→ **本步什么都不发**，保留上一份可用视图 | `lib/index.js:216` | 宁可旧，不可缺 |
| `skill` 工具被同名作用域工具遮蔽 → 目录一并撤掉 | `lib/index.js:207-214` | 可见性按**精确工具定义**判定，schema 和指引一起消失 |

⭐ **这一段是"被架构逼出来的"，不是"设计得好"**：DSH 的会话是**日志 + 投影**架构（凡模型看到的都要能重放），所以清单只能当**历史消息**存在；一旦它在历史里，就必须回答"换了一份怎么办"。**我们 `doc/plan/c8-skills.md` 的 Q1 选了 system prompt 每请求现拼，就没有这个问题** —— 这也是那题"不抄 digest 差异"的根据（本文与它结论一致，且现在有了代码级证据）。

---

## 五、它什么时候会失败（这一节比前面都重要）

| 失效场景 | 实际行为 | 判断 |
|---|---|---|
| `/名字` **打错**（`/frontend-desgin`） | **静默当普通行文**，无报错、无提示 | ⚠️ **本机制最大的坑** |
| `/名字` 命中的技能 **`userInvocable: false`** | 同样静默跳过 | 设计如此，但用户无从得知 |
| 名字**不是 kebab**（含下划线/大写/中文） | 正则根本不匹配 → 静默 | 见下 |
| `/usr/bin`、`5/8` | 正则**排除**（要求空白边界 + 单一 `/`） | ✅ 刻意为之，避免误伤路径与分数 |
| 目录提供方快照不完整 | 本步不发布，沿用旧目录 | ✅ 优雅降级 |

手势的正则（`lib/index.js:373`）：

```js
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
```

→ **两条边界要记住**：**① 必须空白为界**（句中的 `/名字` 也算，但紧跟别的非空白字符就不算）；**② 名字语法是严格 kebab-case**。

⚠️ **第 ② 条对我们是个真问题**：我们 Q3 已经明确**不抄** kebab 校验，理由是"本项目技能是中文场景，非 kebab 的名字是正常的，正则只会制造假失败"。**那么我们的手势就不能照抄这个正则** —— 照抄了，中文技能名**永远触发不了手势**（且是静默的）。→ 这是本文对我们最硬的一条结论。

另外两条不可忽略的边界：

- **正文是不受审的外部指令**：手势路径**不经过任何批准**就把正文塞进了上下文（我们的 Q6 也是自动放行）。兜底只能是"**动手**（bash / 写文件）仍然弹框"。
- **它不认识"工作区"**：DSH 按 `cwd` + 作用域解析技能根；我们的 `read_file` 被 `resolveInsideWorkspace` 关在工作区内，所以**资源层必须靠工具返回绝对路径 + bash**（我们 Q5 已定）。

---

## 六、对我们 C8 的映射（继承 / 不继承）

> 本节是**证据**，不是决定 —— 按 `AGENTS.md`，设计仍须用户拍板。

| 项 | 我们的动作 | 依据 |
|---|---|---|
| **一条渲染服务两条入口** | ✅ **继承** | 正文形态一致 ⇒ 模型不需分辨来源；避免两套模板漂移 |
| **注入是 user 消息（指令上下文），不是 toolResult** | ✅ **建议继承** | 这正是 C8 第二层「`/skill:<name>` 的注入形态」那题；DSH 的答案是 user 消息，且**代码级验证过**（`createUserMessage` + `source`） |
| **注入带来源标记** | ✅ **建议继承** | 直接服务 A3 轨迹视图（区分"用户打的"与"宿主注入的"） |
| **注入排在该步注入的最后** | ✅ **建议继承** | "背景在前、待办材料在最后" |
| **`/skill:<name>` = `disable-model-invocation` 的唯一入口** | ✅ **已是我们 Q4 的理由** | DSH README 明写：手势是这类技能**唯一**的入口 |
| 目录按 digest 差异 + 空目录停用 | ❌ **不抄** | Q1 选了 system prompt 现拼 ⇒ 无历史消息 ⇒ **没有要解决的问题**（见本文「目录」那节的 ⭐ 段） |
| 六层 rank 优先级 | ❌ **不抄** | 我们单根（Q2） |
| kebab-case 名字语法 | ❌ **不抄**；且**手势正则也不能照抄** | Q3 已定；照抄会让中文技能名**静默失效** |
| 未知名字静默忽略 | ❌ **应改成可见诊断** | 与我们 Q3 的原则冲突（"静默失败禁止" —— 幽灵会话那个 bug 的翻版） |

**留给我们下一轮的两件事**：

1. **注入点落在我们代码的哪里？** DSH 用的是 `agent/pre-step` 钩子（每个 step 都有机会注入）。我们的引擎是 `runAgentLoop`，`c8-skills.md` 已实测 `route.ts:156` 每请求现拼 system prompt。→ **"我们有没有 pre-step 这个接缝"是一个真问题**，若没有，注入只能落在**请求装配处**（一次性追加），语义上比 DSH 弱一层（DSH 每步都能重新判定）。**这条需要实读代码确认，本文不下结论。**
2. **未知 `/skill:<name>` 要不要报错、报给谁？** （对齐 Q3 的"诊断必须可见"）

---

## 七、自检题（能答上来才算读懂）

1. 我打了 `/frontend-design`，模型这一轮的**工具调用列表**里有 `skill` 吗？为什么？
2. 两条路径为什么**必须**共用一个渲染函数？如果各写一套，会出什么问题？
3. 为什么注入消息**不能**触发下一次注入？这个守卫同时挡住了什么别的风险？
4. 目录为什么要按 `[name, description]` 算 digest，而不是按渲染后的文本？
5. 技能全被删掉时，为什么必须发一条**空目录**，而不是什么都不发？
6. 我的技能叫「前端设计」（中文），照抄 DSH 的手势正则会发生什么？**报错还是静默？**
7. 手势路径不弹审批，那"技能正文让模型去装个包"这件事，最后是哪一道闸挡住的？

---

## 附录：代码坐标全表（本机 `lib/index.js`）

| 事实 | 位置 |
|---|---|
| `renderSkillContent`（规范渲染，两条路共用） | `dsh-skill/lib/index.js:57-70` |
| 资源提示按 provider 分叉（directory / url / opaque） | `dsh-skill/lib/index.js:71-81` |
| `isModelInvocable` / `isUserInvocable` | `dsh-skill/lib/index.js:37-47` |
| `invocation` 默认两档全 true | `dsh-skill/lib/index.js:203-205` |
| 工具结果 = `renderSkillContent` | `dsh-tool-skill/lib/index.js:135` |
| **手势 pre-step 钩子（注入主体）** | `dsh-tool-skill/lib/index.js:168-202` |
| 只认 `source.kind === "user"`（防伪造） | `dsh-tool-skill/lib/index.js:384` |
| 手势正则（空白边界 + kebab） | `dsh-tool-skill/lib/index.js:373` |
| `invokedSkillNames`（去重、首见顺序） | `dsh-tool-skill/lib/index.js:381-394` |
| 目录 pre-step 钩子（digest 差异 + 空目录） | `dsh-tool-skill/lib/index.js:203-236` |
| 目录文案 + 防双载那句 | `dsh-tool-skill/lib/index.js:238-261` |
| 替换目录 / 空目录文案 | `dsh-tool-skill/lib/index.js:262-286` |
| 目录条目渲染（只有 name + description） | `dsh-tool-skill/lib/index.js:293-295` |
| 目录 digest = sha256(name, description) | `dsh-tool-skill/lib/index.js:301-304` |
| UI 菜单的技能来源（**不加载正文**、只要 user 可调用） | `dsh-api-session-controller/lib/types/skill-catalog.js:116-171` |
| 上游设计说明：`/name` 是 `disable-model-invocation` 唯一入口 | `dsh-tool-skill/README.zh.md:88`、`:226` |
| 上游设计说明：token / KV cache 影响 | `dsh-client-ui-skill/README.zh.md:83-87` |
