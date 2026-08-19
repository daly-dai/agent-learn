import type { Metadata } from "next";
import { Instrument_Sans, Azeret_Mono } from "next/font/google";
import "./globals.css";

// 字体的角色分工（见 globals.css 顶部的设计说明）：
//   Azeret Mono  —— 仪表盘的「刻字」：标签、事件行、id、读数。这里它同时是标题字。
//   Instrument Sans —— 正文阅读面。中文由系统字体接管（PingFang SC / 微软雅黑）。
const mono = Azeret_Mono({ subsets: ["latin"], variable: "--font-mono-latin" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans-latin" });

export const metadata: Metadata = {
  title: "Teaching Agent · 观测台",
  description: "观察一个 Agent 如何思考、调用工具、给出答案",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
