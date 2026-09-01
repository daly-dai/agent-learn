// ============================================================
// API 路由 —— GET /api/chat/commands：命令列表（C13 前端发现用）
// ============================================================
// 命令面板的数据源：前端页面加载时 fetch 一次缓存（Reasonix slashCatalog
// 快照思路——静态列表只过滤不重查）。返回前端安全的 descriptor 视图
// （不含 handler，DSH list() 同款）。
// 查询走 commandDescriptors()（工厂数组直接取元数据）——不建注册表，
// 查个列表不需要"注册"这个动作（review 吐槽修复）。
// ============================================================

import { NextResponse } from "next/server";
import { commandDescriptors } from "../_pipeline/commands";

export async function GET() {
  return NextResponse.json({ commands: commandDescriptors() });
}
