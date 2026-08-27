# E2 详案：route.ts 阶段管线重构（拆解上帝组装器）

> 2026-08-27 创建。评估发现：route.ts 615 行是"上帝组装器"，组装层不可测（E1 误报就是代价）。用户拍板：完整拆解（不是只抽审批），且**涉及核心功能，须有详尽开发方案 + 兜底方案 + 验收方案**。
> 参考（已实读）：codex `request_processors/`（38 个处理器，主入口只分发）；pi `create-harness.ts`（组装点只接线不实现）。

## 一、问题与目标

### 现状
- `app/api/chat/route.ts` 614 行，混合 8 类职责：systemPrompt 常量 / StreamFrame 协议 / POST 主流程 / GET+DELETE / 挂起提问 / 模型选择 / 审批策略 / 挂起确认
- 组装层（route）不可测：审批策略/模型选择/挂起逻辑零测试覆盖（173 用例全绿也测不到）
- 未来功能（C13 斜杠/C14 @注入/B4 diff/C10 goal）会继续往 POST 堆逻辑 → 必然再膨胀

### 目标
1. route.ts 614 → ~100 行（纯路由壳：解析请求 + SSE 包装 + 调管线）
2. 请求逻辑按**阶段切文件**（管线骨架），未来功能往对应阶段文件长，膨胀被结构挡住
3. 审批策略抽成纯函数补单测（E1 误报的直接解药）

## 二、目标结构（阶段管线）

```
app/api/chat/route.ts          → 路由壳：解析 + SSE + 调 runPipeline（~100 行）
app/api/chat/pipeline/
  ├─ index.ts                  → runPipeline 编排（各阶段按序调用）
  ├─ frames.ts                 → StreamFrame 协议 + StreamFrame 类型
  ├─ prompt.ts                 → systemPrompt 常量
  ├─ context.ts                → 建 store + 读上下文（原 1b）
  ├─ tools.ts                  → 组装工具注册表（原 1c）
  ├─ model.ts                  → selectModel（原 ⑥）
  ├─ approval.ts               → 审批策略纯函数 + 挂起确认（原 ⑦⑧，可测）
  └─ compact.ts                → 压缩触发（原 2c）
lib/model-select.ts            → selectModel（可选，与 model.ts 二选一）
```

**阶段边界**：context/tools/approval/compact 尽量**纯函数优先**（不碰 send/SSE），send 留在 route 壳；approval.ts 返回 `ToolDecision`（纯决策），挂起确认（碰 send）单独导出。

## 三、实施步骤（每步独立可验证，绝不一次大改）

### 步骤 0：基线快照
- `git stash` 前先跑 `tsc + pnpm test` 记录基线：22 文件 / 173 用例全绿
- 手动冒烟：POST 一次对话（Mock 模式）+ GET 历史 + DELETE 清空 + approve 拒绝一次

### 步骤 1：抽 frames.ts + prompt.ts（零逻辑，纯移动）
- 把 StreamFrame 类型 + systemPrompt 常量原样搬走，route import
- 验证：tsc + 测试（应零变化）
**风险：极低**（常量移动，无逻辑）

### 步骤 2：抽 approval.ts（最高价值，先写测试）
- **先写单测**（11.5 ②）：
  - `decideToolCall(call, ctx) → ToolDecision` 纯函数：secret 拦截 / bypass / never / 只读 bash 放行 / persist+session 记忆 / list_files 补参
  - 挂起确认 `askUserApproval` 保持 route 内（碰 send，不测）
- 然后抽离：handleToolApproval 拆成 `decideToolCall`（纯决策）+ 调用方（route）把 send/日志包在外面
- 验证：新单测绿 + 原有全绿 + 手动 approve 流程
**风险：中**（决策逻辑有行为细节，靠单测锁住）

### 步骤 3：抽 model.ts + context.ts + tools.ts + compact.ts
- 每个都是"搬函数 + import"，逐一验证 tsc + 测试
- context.ts 依赖 JsonlSessionStore；tools.ts 依赖 createToolRegistry；compact.ts 依赖 prepareCompaction/generateSummary——都是已有模块
- 验证：每步后全量测试
**风险：低-中**（纯搬移，但 compact 有异步/降级路径，注意保留）

### 步骤 4：route.ts 变薄 + runPipeline 编排
- route.ts 只剩：解析请求 → 建 recorder/stream → 调 `runPipeline(ctx)` → SSE 包装
- runPipeline 在 pipeline/index.ts 按序调各阶段
- 验证：完整手动冒烟（对话/审批/提问/压缩/停止/断连）
**风险：中**（编排改动最大的一步，但每阶段已独立验证过）

## 四、兜底方案（失败预案）

### 每步兜底
1. **小步可回退**：每个步骤一个 commit（或至少 git 可 clean 分离）；任一步 tsc/测试红 → 停下修复，不带着红前进
2. **行为不变是铁律**：所有抽出的函数**先复制后删**（同一 commit 内搬移，不跨 commit 留两份）
3. **纯函数优先**：审批决策/上下文构建/压缩准备不碰 send——若发现某阶段必须碰 SSE，留在 route 壳，不硬塞进阶段

### 整体兜底
1. **回滚**：整个重构 = 若干小 commit，任一步出问题 `git revert` 该步即可（不整体回滚）
2. **功能冻结**：重构期间不加新功能、不修新 bug（除重构引入的）——范围锁定，避免混淆
3. **手动冒烟清单**（每步后跑）：
   - [ ] Mock 模式发消息 → SSE 流到 done
   - [ ] 审批：写文件触发弹框 → 允许/拒绝都通
   - [ ] 提问：ask_user_question 弹卡片 → 回答/跳过都通
   - [ ] 压缩：手动把 minCompactTokens 调小触发压缩 → compacting 帧 + 摘要
   - [ ] 停止：run 中点停止 → 中断 + 清理
   - [ ] 断连：中途关页 → 挂起提问被 clearRun 清理
   - [ ] GET 历史 / DELETE 清空
4. **红线自检**：‘git diff --name-only’ 不含 lib/agent.ts（引擎不动）

## 五、验收方案

### 自动化
1. `tsc --noEmit` 通过
2. `pnpm test` 全绿：**原 22 文件 173 用例 + 新增 approval.test.ts**（secret 拦截 / bypass / never / 只读 bash / 记忆 / list_files 补参，预计 +15~25 用例）
3. 新增单测必须覆盖审批策略全部分支（E1 误报证明组装层不可测，现在决策层必须可测）

### 手动（冒烟清单全过）
按上表 7 项手动验证，重点：审批弹框 + 提问卡片 + 压缩提示条（这三项最容易被重构破坏）

### 结构验收
1. route.ts ≤ ~150 行（纯路由壳）
2. pipeline/ 目录 7 个文件职责单一，每个 ≤ ~120 行
3. approval.ts 纯函数可测（不 import send/NextResponse）
4. 未来加功能有明确落点（C13→commands.ts、C14→mentions.ts）

### code-review（11.5 ⑦）
- 双轴子代理：Standards（分层/命名/纯函数）/ Spec（行为等价——原 8 职责一一对应）
- 重点核对：抽离后**无行为变化**（对比抽前抽后相同输入输出）

## 六、参考源码（对照用）

- codex: `E:\agents-read\codex\codex-rs\app-server\src\request_processors/\`（thread_processor / turn_processor / fs_processor…）
- pi: `E:\agents-read\pi\node_modules\@earendil-works\pi-coding-agent\src\server\create-harness.ts`（组装点只接线）

---

## E2 完成记录（2026-08-27，commit 7f8728a）

**结果**：route.ts 614 → 287 行（-53%），`_pipeline/` 10 个文件（frames/prompt/context/tools/model/approval/compact/ask-user/index + approval.test）。

**步骤回顾**：
1. frames/prompt 纯移动（7557c5d）
2. approval 纯决策 + 15 单测（e05f0e7）
3. model/context/tools/compact/ask-user 工厂内聚（7c425f0）
4. runPipeline 编排 + route 薄壳 + hooks 统一（7f8728a）

**过程中用户补充的关键决策**：
1. **hooks 统一内部绑定**：createPipelineTools 两个 hooks（todo/askUser）一处定义，route 只传原料（曾拆两处被用户指出可读性差）
2. **runPipeline 死参数清除**：双轴 review 发现 modelLabel/sessionId/sessionDir 签名撒谎 → 删（接口即契约）
3. **handleToolApproval/askUserApproval 留 route 壳**（用户问"为啥没拆"→ 答案：决策已拆 approval.ts，副作用（碰 send/日志）该留壳，单使用端不抽——纯函数与副作用分离的正确落点）

**验收**：tsc + 188 单测全绿 + 冒烟（对话流/GET/审批闭环文件写入）+ 双轴 code-review 每步通过 + 红线 lib/agent.ts 全程未动。

**落点地图（未来扩展，验收参考）**：
- 加功能（C13 斜杠/C14 @注入）→ `_pipeline/` 新文件 + index.ts 按序插行，route 壳不动
- 加工具（C9 python）→ `lib/tools/` 新文件 + index.ts 两行（import + 注册），引擎/编排/路由全不动
- 加 hooks 工具 → `lib/tools/` 新文件 + ToolHooks 加字段 + `_pipeline/tools.ts` 绑定新闭包
- 加 SSE 帧 → frames.ts 加类型 + index.ts 对应阶段 send


---

## 用户决策记录（2026-08-27 拍板）

| # | 问题 | 决策 |
|---|---|---|
| Q1 | 拆分粒度 | **A 完整拆**：route.ts 614→~100 行，`_pipeline/` 7 阶段文件 |
| Q2 | approval.ts 位置 | **`app/api/chat/_pipeline/approval.ts`**（pipeline 内，纯函数导出）——用户指定放 _pipeline 下 |
| Q3 | send 依赖拆分 | **认可**：`decideToolCall(call, ctx)` 纯决策 + `askUserApproval`（碰 send）留在 route 壳 |
| Q4 | 压缩降级 | **统一**：行为等价，压缩失败仍降级拼贴（防爆窗保留） |
| Q5 | 手动冒烟 | **双方都做**：我验证自动化 + 等价性核对，用户也手动冒烟 |
| Q6 | 提交粒度 | **A 每步一 commit**（5 步 5 commit，回滚精确） |

**关键细节（用户指定）**：目录名用 `_pipeline`（**下划线前缀**）——Next.js 约定下划线开头的目录/文件不会被路由系统扫描，避免被误当 API 端点。

**目标结构（修正）**：

```
app/api/chat/route.ts             → 路由壳：解析 + SSE + 调 runPipeline（~100 行）
app/api/chat/_pipeline/
  ├─ index.ts                     → runPipeline 编排
  ├─ frames.ts                    → StreamFrame 协议
  ├─ prompt.ts                    → systemPrompt 常量
  ├─ context.ts                   → 建 store + 读上下文
  ├─ tools.ts                     → 组装工具注册表
  ├─ model.ts                     → selectModel
  ├─ approval.ts                  → decideToolCall 纯决策（Q3：askUserApproval 留 route 壳，见决策记录）
  └─ compact.ts                   → 压缩触发（降级保留）
```

