# 知识点-04：精读 DSH `packages/client/AGENTS.md` 对照表

> 2026-08-27（周四）· B3-⑤ 精读任务产出
> 精读对象：`E:\agents-read\deepseek-harness\packages\client\AGENTS.md`（"Web client stack"，150 行）
> 背景：2026-08-26 用户问"参考项目是怎么约束 AI 对页面的开发的，总不能想一出是一出"——查证发现 DSH 为 Web client 专门写了一份 AGENTS.md，**约束 AI 写前端是显式工程实践**。§10.6 已把它归纳为五层约束；本表逐区精读，回答"我们缺什么"。

---

## 一句话结论

**我们的五层约束（§10.6）方向与 DSH 完全同构，已验证；但缺三样显式化：组件测试"测什么"的标准、新组件 checklist、导出最小化纪律。** 不适用的是 DSH 插件化架构的产物（slot 系统/模块图/多包依赖），不是我们需要的。

---

## 逐区对照表（15 个纪律区）

| # | DSH 纪律区 | 核心主张 | 我们项目现状 | 归类 |
|---|---|---|---|---|
| 1 | **Slot & props discipline** | 组件经 `slots.register` 组合；props 四份派生不手写；hooks 框架造 | 组件组合>发明（§10.6 ②）；props 手写但单页简单 | 思想同构 · 机制不借 |
| 2 | **Reactive read**（数据流） | 渲染只走框架 hook；业务组件零订阅；数据访问阶梯 hook→store→inject | `lib/` 纯函数 + `app/lib/use-*` hooks；无 store | ✅ 已一致（我们更简） |
| 3 | **Export discipline**（导出最小化） | 公共导出加一条要用户签字；测试直连内部 | 无显式规则 | 🔺 **可借**（轻） |
| 4 | **ctx discipline** | **组件永远不见服务/上下文**，数据全走 props | 组件收 props（page.tsx 注入），一致 | ✅ 已一致 |
| 5 | **Layering red lines** | 对象层(业务数据) / 渲染机件 / 展示组件；**业务数据永不进 store** | `lib/` 内核 vs `app/` 产品层（AGENTS.md 6）；无 store 天然满足 | ✅ 已一致 |
| 6 | **Dependency declaration** | peer/dev/deps 严格区分 + 检查脚本 `verify-client-packages.ts` | 单包项目，无多包依赖 | 不适用 |
| 7 | **Build-time env** | `DSH_CLIENT_*` 构建期环境变量 | 无此需求 | 不适用 |
| 8 | **Shared modules & module graph** | 动态插件模块表 + 请求供应验证 | 单包项目 | 不适用 |
| 9 | **Conversation Node discipline** | 一个业务 feature 一个 node；match/update 纯函数、可回放 | `lib/trace-fold.ts` 折叠纯函数（同思想！） | ✅ 已一致（已抄） |
| 10 | **Directory regime** | 一 feature 一目录；域间不互相 import；单点组装 | `app/components/<组件>/` + 08-27 SessionRow 抽取 | ✅ 已一致（有雏形） |
| 11 | **Styling** | `--dsw-*` 令牌 + CSS Modules；无字面色值/组件库/Tailwind；产品中文、注释英文 | `--plate/--pen-*` + CSS Modules + 无第三方库；注释中文（主动差异） | ✅ 已一致（注释语言是教学项目拍板差异） |
| 12 | **Testing and coverage** | 三层测试；**组件测试断言用户可见行为，不断言 class name/hook 内部**；jsdom per-file pragma；覆盖率门 | A2 vitest node 层（22 文件 173 用例）；B8 组件层排队等冻结 | 🔺 **可借（最有价值）** |
| 13 | **Before you push** | 检查阶梯：秒级内环 → snapshot 回放 → 提交前精选；`test:gui` "run it as freely as a typecheck" | tsc 每步 + `pnpm test` 全量 | 🔺 可借（显式化最窄优先） |
| 14 | **New plugin package checklist** | 新插件包 6 步 | 单包项目 | 不适用 |
| 15 | **New component checklist** | 新组件 6 步（组合→props→测试→令牌→test:gui→**Agent Note**） | 无显式清单（SessionRow 抽取靠 review 提醒） | 🔺 **可借** |

---

## 三分类结论

### ✅ 已一致（验证我们的方向对了）
- **Stling**：令牌 + CSS Modules + 无组件库——DSH 同款，我们 B3 原语库走对
- **Layering**：`lib/` 内核 vs `app/` 产品层——DSH 三层红线的简化版
- **ctx discipline**：组件收 props 不见服务——我们一直如此
- **Conversation Node 思想**：折叠纯函数（trace-fold.ts）——已抄
- **Directory regime**：一组件一目录——已具备

### 🔺 可借（我们缺的，按价值排序）
1. **组件测试"测什么"的标准**（第 12 区）——"断言用户可见行为，不断言 class name/hook 内部"。直接回答 B8 排队时悬而未决的问题；配置方式可借：`// @vitest-environment jsdom` per-file pragma（不用全局换环境）
2. **新组件 checklist**（第 15 区）——把"组合→props→测试→令牌→test→沉淀(Agent Note)"显式成清单，进 `doc/plan/ui-design.md` 或 AGENTS.md；避免再靠 review 事后提醒
3. **导出最小化纪律**（第 3 区，轻）——公共 API 面小，AI 不容易误用；适合教学项目
4. **检查阶梯显式化**（第 13 区）——我们已有"tsc 每步 + 测试"，可把"先跑最窄的"写显式

### 不适用（DSH 插件化架构的产物，不借）
slot 系统、module graph、dependency declaration、build-time env、plugin package checklist——都是多包插件化架构的约束，我们单页项目不需要（借了就是 Speculative Generality，违背自己立的判据）。

---

## 可落地的下一步（挑一条就够）

1. **B8 组件测试标准**：把"断言用户可见行为"写进 B8 详案（等冻结信号时直接用）
2. **新组件 checklist**：改写 DSH 版为我们的（去掉 slot/register 机制，保留组合>发明/令牌/测试/沉淀），进 `doc/plan/ui-design.md` §10.6 旁
3. **周五分享素材**：本表就是"讲出来"的骨架——"参考项目怎么约束 AI 写前端"= 五层约束 + 这份对照

---

## 附：DSH 约束 AI 写前端的完整脉络（八道闸）

> 2026-08-27 追加。对照表回答"他有哪些纪律"，本节回答"这些纪律怎么串成一条链"。核心思路一句话：**把每个决策点都变成"已定的"，让 AI 没有自由发挥的余地。**

### 八道闸逐层收紧

| # | 闸 | 锁死什么 | 机制（代码即约束优先） |
|---|---|---|---|
| 1 | **文件即约束** | 知识有唯一出处 | 根 AGENTS.md → client AGENTS.md → 架构 notes → cookbook，三级引用，不重复写 |
| 2 | **组合模型**（slot system） | "怎么搭" | 一切 UI 只能 `slots.register` 组合；渲染未声明的 slot = 加载失败；冲突禁止绕开 |
| 3 | **props 纪律** | "数据怎么进" | props 四份派生禁止手写；hooks 框架造；数据三通道各归其位；**组件永远见不到 ctx**（物理隔离） |
| 4 | **分层红线** | "数据住哪" | 对象层(业务数据) / 渲染机件 / 展示组件；业务数据永不进 store；红线 grep-assertable |
| 5 | **导出纪律** | "AI 能碰什么" | 公共导出最小化，加一条要用户签字；测试直连内部；跨包引用原则上禁止 |
| 6 | **样式令牌** | "长什么样" | `--dsw-*` + CSS Modules；无字面色值/组件库/Tailwind——没有自创视觉的理由 |
| 7 | **测试** | "行为必须对" | 三层测试；**断言用户可见行为，不断言实现**；jsdom per-file pragma |
| 8 | **提交阶梯 + checklist** | "怎么交付/新东西怎么进" | test:gui 秒级内环 → snapshot 回放 → 精选检查；新组件 6 步 checklist；**非平凡改动必带 Agent Note** |

### 为什么这样写（动机分析，08-27 我的理解，欢迎质疑）

**最深的动机：AI 写的代码是"一次性协作产物"，不是"团队长期维护"。**
传统团队靠文化/默契/老带新约束风格；AI 没有这些——**只能靠显式规则 + 代码强制**。这就是"他为什么要写这么细"的答案：不是过度设计，是"没有文化兜底，就要用规则把文化钉死"。

逐条动机：

1. **为什么用"代码即约束"而非口头约定**：口头约定（文档）靠 review 抓，有滞后；代码约束（加载失败/编译报错）在**写的当下**就拦。AI 和人都容易忽略文档，但没法忽略报错。越靠近"写的时候"，约束越强。

2. **为什么 slot 系统这么严格**：DSH 是插件化架构，UI 由几十个独立插件组成——必须有一个统一的组合模型，否则插件互相踩踏。`children = 声明 + 授权` 把"你只能渲染你声明的"在编译期钉死，这是**架构安全**，不是洁癖。

3. **为什么 props 四份派生、ctx 对组件隐藏**：组件拿不到服务就摸不着（物理隔离 > 约定）；一切数据走 props → 组件变纯展示 → **可测试、可替换、可复用**。props 派生是给 AI 一个"照着填"的模板，减少自由发挥。

4. **为什么导出最小化、跨包禁止**：公共 API 是"合同"，面越小耦合越小；加导出要用户签字 = 合同不能随便改。跨包直接 import 会形成意大利面依赖，只能走 slot/ctx 两条正路。

5. **为什么令牌 + 无组件库**：令牌 = 设计系统自动生效；无组件库 = **不把视觉决策外包给第三方**（风格独特 + 可控，也正是我们 B3 自研原语库的出处）。AI 没有理由自创颜色，视觉自由度被锁到最低。

6. **为什么测试断言行为不断言实现**：断言 class name/hook 内部 = 测试与实现耦合，改样式就爆测试；断言用户可见行为 = 测试真正保护"用户看到什么"，重构不怕。

7. **为什么 Agent Note 制度**：非平凡改动不留痕 = 架构决策丢失，下一个 AI 不知道为什么这么写。过程日志 = 机器记不住的理由，给未来的 AI 和人类看——**和我们的过程日志同源思想**（AGENTS.md 11.5 ⑧）。

8. **为什么分三层（对象层/渲染机件/展示组件）**：业务数据住在 React-free 的对象层 → 业务逻辑不被 React 生命周期绑架，可测、可回放（trace-fold.ts 就是我们的对象层纯函数）；展示组件纯 props → 可整体重写（"expected to be rewritten wholesale"）而不动业务。

**一句话收尾**：DSH 的每个"为什么"都能落回同一句话——**"在 AI 会自由发挥的地方，把自由换成模板和报错"**。模板给方向，报错给边界。

> 这份"为什么"是我 08-27 精读时的理解，不是 DSH 官方声明。学到深处若发现不对，请回来改这里——这就是它存在的意义（活文档）。

