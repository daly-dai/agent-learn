// ============================================================
// API 路由 —— GET /api/chat/commands：命令清单（C13 前端发现用）
// ============================================================
// 命令面板的数据源：前端页面加载时 fetch 一次缓存（Reasonix slashCatalog
// 快照思路——静态列表只过滤不重查）。返回前端安全的 descriptor 视图
// （不含 handler，DSH list() 同款）。
// 查询走 commandCatalog()（工厂数组直接取元数据）——不建注册表，
// 查个列表不需要"注册"这个动作（review 吐槽修复）。
// C8 T5：清单 = 内置命令 + **技能**（`source:"skill"`），诊断一起带回去。
// ============================================================

import { NextResponse } from "next/server";
import { commandCatalog } from "../_pipeline/commands";
import { toolContext } from "../_pipeline/context";

export async function GET() {
  const { commands, diagnostics } = commandCatalog(toolContext.skillsRoot);

  // 坏技能 / 撞名**不阻塞**清单，但必须留痕。这条路径每次开页面才走一次，
  // 日志量可忽略；诊断同时随响应回去（T6 在面板里显示）。
  for (const diagnostic of diagnostics) {
    console.warn(
      `[skill] ${diagnostic.name}：${diagnostic.reason}（${diagnostic.dir}）`,
    );
  }

  return NextResponse.json({ commands, diagnostics });
}
