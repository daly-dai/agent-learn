// ESLint 配置（flat config）。
//
// 为什么是这个形状（来龙去脉见 doc/plan/c45-lint-format.md）：
//   · Next 16 已删除 `next lint` —— 官方路线就是 ESLint CLI + 本文件 + eslint-config-next。
//   · 硬规则那一块抄自同级项目 ai-admin-pro 的 eslint.config.mjs，但**没抄 id-length**
//     （实测 248 条违规里绝大多数是 catch (e) / (e) => 这类惯用短名，是噪音不是坏命名）。
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // 机器目录：不进版本控制，也没有"代码质量"可言
    ".pnpm-store/**",
    ".reasonix/**",
    ".repo-updates/**",
    ".sessions/**",
    ".traces/**",
    ".tmp_pdf/**",
    ".tmp-lint/**",
    "workspace/**",
  ]),

  ...nextVitals,
  ...nextTs,

  // ======================== 硬规则 ========================
  // 为什么抄这些：它们把 AGENTS.md 里"靠记性"的规矩变成"跑一下就报"。
  // 每条都实测过存量代价（见详案 3.2 的表），代价大的（id-length）没抄。
  {
    rules: {
      // —— 把 tsc 查不出的死代码揪出来 ——
      // 为什么值得单列：AGENTS.md「环境与验证」写着「tsc 绿 ≠ 没有垃圾」——
      // tsconfig 没开 noUnusedLocals，删代码后留下的死导入它一个字都不报。实测抓出 21 处。
      // ignoreRestSiblings：`const { [key]: _gone, ...rest } = obj` 是"剔除某个 key"的标准写法，
      // `_gone` 是必然的占位符 —— 没有它这条规则会逼人把这段语义拆散（见 run-store 的 deleteRun）。
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",

      // —— 函数质量：AGENTS.md 第 2 条（函数小而单一）+ 第 5 条（避免深层嵌套）——
      // 为什么是 15 不是 ai-admin-pro 的 10：实测 10 会打在红线文件 lib/agent/index.ts 的
      // runAgentLoop 上（复杂度 11）—— 为一条 lint 阈值去动 agent 内核是本末倒置；
      // 而且最复杂的两个函数（classifyIpv4 32 / measureTagDepth 24）是**查表型**，
      // 拆成 4 个 8 只会让读的人多跳 4 个地方。详见详案 4.1③。
      complexity: ["error", { max: 15 }],
      "max-depth": ["error", { max: 3 }],
      "max-params": ["error", { max: 3 }],

      // —— 防 Bug ——
      eqeqeq: ["error", "always"],
      "guard-for-in": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      "no-promise-executor-return": "error",
      "array-callback-return": "error",
      "no-constructor-return": "error",
      "consistent-return": "error",
      "no-use-before-define": [
        "error",
        { functions: false, classes: true, variables: true },
      ],

      // —— 代码质量 ——
      curly: ["warn", "all"],
      "no-nested-ternary": "error",
      "no-param-reassign": "error",
      "object-shorthand": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-var": "error",
      "no-eval": "error",
      "no-extend-native": "error",
      "no-proto": "error",
    },
  },

  // 组件文件再放宽 —— JSX 条件渲染天然多分支，不代表逻辑复杂
  {
    files: ["**/*.tsx"],
    rules: {
      complexity: ["error", { max: 20 }],
    },
  },

  // 必须最后：关掉 ESLint 里和 Prettier 打架的格式化规则
  prettier,
]);
