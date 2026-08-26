# doc/plan/a2-vitest —— A2 测试框架 vitest（施工补记）

> 来源：PLAN.md 第十三节 A2 行 + "A2 实现前补记"段（2026-08-26 PLAN 拆解时移入 doc/plan/）。**✅ 已实现并提交**（17 文件 118 用例，2026-08-26），保留作施工历史。

**目标**：搭 vitest 框架 + `lib/tools/` 单测全绿。边界：**只测 lib/ 纯 TS（零 Next.js 集成）**，不做 agent loop mock（留以后专门学 mock）。验收：`pnpm test` 全绿、每工具一个 `.test.ts`、关键边界用例覆盖、`lib/tools/` 覆盖率 ≥80%。

- **vitest 支持 Next.js 吗**：支持（官方有 App Router 指南），但 **lib/ 是纯 Node 模块不需要任何集成**——`environment: "node"` 零配置直测；将来测 `app/components/` 才需要 `@testing-library/react` + jsdom + mock `next/*` 导入。**A2 明确不做组件测试**。
- **第 1 层框架**：装 `vitest`（devDependency）；`vitest.config.ts`（`environment: "node"`，include `lib/**/*.test.ts`）；package.json 加 `"test": "vitest run"` + `"test:watch": "vitest"`。
- **第 2 层纯函数**（零 mock）：`path-utils.ts`（resolveInsideWorkspace：越界拒绝/相对解析/workspace 内放行）、`todo.ts` 的 `validateTodos`/`countTodos`（trim/去重/单 active 抛错）。
- **第 3 层 fs 工具**（临时目录 fixture）：`read`/`list`/`find`/`write`/`edit` 等——`beforeAll` 建 tmpdir 当 workspace、`afterAll` 清理；测写入 workspace 内成功、越界失败。**学 fixture 管理**。
- **第 4 层顺带（可选）**：`sessionStore`（临时 `.sessions` 目录：appendEntry/叶子回溯/appendTodo/getLatestTodos/compactIfNeeded）。agent loop mock 测试**明确不做**。
- **测试文件位置**：与源码同目录（`lib/tools/path-utils.test.ts`）——vitest 默认 include，就近可读，符合"一工具一文件"的组织。
- **学习点**（做中学）：断言 expect / 生命周期 beforeAll-afterAll / fixture 临时目录 / **测试倒逼可测试性**（测时发现耦合 I/O 的函数该拆——这回答"要不要先拆模块"：测了才知道，不是先拆再测）。
- **验收**：① `pnpm test` 全绿 ② 每工具 ≥1 `.test.ts` ③ 边界用例覆盖（越界/重复/双 in_progress）④ `pnpm vitest --coverage` 时 `lib/tools/` ≥80%。

## 2026-08-26 更新

- 全量 17 文件 118 用例全绿（含新增 `bash-runner.test.ts` 7 用例、`summarize.test.ts` 9 用例、`store.test.ts` 7 用例）。
- **沙箱经验**：vitest spawn 子进程在受限沙箱被 EPERM 拦截，测 bash-runner 要 `sandbox_permissions: "danger-full-access"`。
