// ============================================================
// vitest.config.ts —— A2 测试框架配置
// ============================================================
// environment: "node" —— lib/ 是纯 Node 模块（fs/path/child_process），
// 不碰 React/DOM，所以不需要 jsdom（将来测 app/components/ 时再换）。
// include 只收 lib/** 的测试——app/ 组件测试留到将来单独配。
// ============================================================

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/lib/**/*.test.ts", // B8 ①：app/lib 纯函数层随时可做
      "app/api/**/*.test.ts", // E2：_pipeline 纯函数测试（approval 决策等）
    ],
  },
});
