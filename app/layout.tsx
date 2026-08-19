import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent 学习",
  description: "学习搭建 AI Agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
