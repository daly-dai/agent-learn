# C19 · 存量模块「实现与单测同目录」收编

> **这是已完成项的「竣工记录」**（`AGENTS.md` 第 10 条：材料住 `doc/plan/<名>.md`）。**状态在 `PLAN.md` 需求池那一格 —— 本文件不写状态。**
> **素材来源**：`PLAN.md` 需求池 C19 行（2026-09-18 搬入；原行的实质内容只写在池子里，没有家 ⇒ 建本文件）

## 一、要做什么（原文）

**存量模块「实现与单测同目录」收编** —— `AGENTS.md` 6.5 升硬规则**必然产生**的旧账。

规则要求"有单测的文件 → `<模块>/index.ts` + `index.test.ts`"，仓库里**当时有 20 处存量违规**（实现平铺 + 同名 `.test.ts` 挂旁边）：
- `app/lib/` 4（keys / repos-summary / context-occupancy / run-fold）
- `app/api/repos/_lib/` 5
- `lib/tools/` 3（path-utils / shared / bash-runner）
- `lib/permission/` 3
- `lib/session/` 2（manager / store）
- `lib/commands/parse` + `_pipeline/` 2

## 二、做法（原文）

每个模块搬进同名文件夹改成 `index.ts`，单测跟着进去；**外部 `@/…` 引用不动**（目录 index 解析），只改被移动文件**自己**的相对 import（如 `./types` → `../types`）；一把做完后 `tsc` + 全套测试回归。

## 三、⚠️ 为什么不当时做（原文）

迁移会碰 `lib/` 一大片文件（含正在改的 `lib/session/store.ts`），和 A3 的功能改动混在同一个 commit 里会让评审失真。

## 四、实际做了什么（验收）

✅ 完成（2026-09-14，`dea7d1b`）：
- **20 处 / 40 文件**全部搬完，**32 处相对 import** 改写
- `tsc` exit 0；git 全部识别为**改名**（R096–R100，**历史不断**），旧位置零残留
- **几乎零手工**：写了一次性脚本（**先干跑**打印每处待改 import 供核对，再执行）—— 40 个文件的相对路径靠手改必然出错；**`tsc` 在这里就是安全网**（改错必然报"找不到模块"）
- `/…` 别名与目录式引用（`./store` → `store/index.ts`）自动解析、**一行未动**

**依据**：自家 `lib/tools/` 已合规的 13 处（read / write / edit / grep / …）+ `AGENTS.md` 6.5。

> ⭐ **本项立的先例被后来复用**：`PLAN.md` 的表结构迁移、2026-09-18 的池子行压缩，都照它的"**先干跑 → 人核 → 再执行**"。
> 施工过程见 `doc/weekly-review/2026-W38/00-过程日志.md`。
