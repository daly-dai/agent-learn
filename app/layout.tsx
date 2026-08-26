import type { Metadata } from "next";
import "./globals.css";

// 字体策略（2026-08-26 从 next/font/google 改为系统字体栈）：
//   next/font/google 在编译期访问 fonts.googleapis.com 下载字体，国内网络
//   访问不通导致 Turbopack 冷启动编译失败（删 .next 缓存后必现）。
//   本项目中文本就走系统字体（PingFang SC / 微软雅黑），拉丁字符用
//   系统等宽/无衬线栈（见 globals.css :root），视觉退化很小、零网络依赖。

export const metadata: Metadata = {
  title: "Teaching Agent · 观测台",
  description: "观察一个 Agent 如何思考、调用工具、给出答案",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
