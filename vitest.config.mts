// ============================================================
// vitest.config.ts —— A2 测试框架配置
// ============================================================
// environment: "node" —— lib/ 是纯 Node 模块（fs/path/child_process），
// 不碰 React/DOM，所以不需要 jsdom（将来测 app/components/ 时再换）。
// include 只收 lib/** 的测试——app/ 组件测试留到将来单独配。
//
// resolve.alias（2026-09-01 修）：vite 不读 tsconfig paths，而 repos 测试
// 是第一批用 `@/lib/config` 别名（vi.mock 路径 + 被测模块 import）的——
// 之前全绿的测试（approval/keys 等）都用相对路径，从没暴露过。
// Next.js 用 tsconfig paths 解析 @/，vitest 必须显式配 alias 保持一致，
// 否则模块解析失败、测试文件整体加载即崩。
// ============================================================

import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/lib/**/*.test.ts", // B8 ①：app/lib 纯函数层随时可做
      "app/api/**/*.test.ts", // E2：_pipeline 纯函数测试（approval 决策等）
    ],
  },
});
