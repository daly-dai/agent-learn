// ============================================================
// API 路由 —— POST /api/chat/command：执行一条斜杠命令（C13）
// ============================================================
// 命令执行不走模型（DSH：without sending the command to the model）。
// 流程：解析 → 注册表命中 → handler（api 通道注入 store/model）→ CommandResult。
//   - 语法错/未知命令 → 400（硬边界：命令拼错必须报错，不能让模型收到
//     `/copmact` 当正文——codex SubmissionValidation）
//   - handler 抛错 → 500（命令实现 bug，不是业务错误）
// 成功只返回 result；前端需要刷新消息流（GET /api/chat）拿压缩卡片——
// 命令不推送 SSE，保持"命令 = 独立动作"的简单语义。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { isValidSessionId } from "@/lib";
import { createCommands } from "../_pipeline/commands";
import { createSessionStore } from "../_pipeline/context";
import { selectModelSafe } from "../_pipeline/model";
import { parseSlashName } from "@/lib/commands/parse";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let sessionId = "default";
  let line: unknown;
  try {
    const body = await req.json();

    line = body?.line;

    if (typeof body?.sessionId === "string" && body.sessionId.trim()) {
      sessionId = body.sessionId.trim();
      // 安全：sessionId 会拼进文件路径，必须过白名单校验（同 route.ts）
      if (!isValidSessionId(sessionId)) {
        return NextResponse.json({ error: "非法 sessionId" }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (typeof line !== "string" || line.trim().length === 0) {
    return NextResponse.json({ error: "缺少 line 字段" }, { status: 400 });
  }

  // 命令执行需要 store（/compact 落盘）+ model（生成摘要）——每请求组装。
  const store = createSessionStore(sessionId);

  const selected = selectModelSafe();
  if (!selected.ok) {
    return NextResponse.json({ error: selected.error }, { status: 400 });
  }

  const registry = createCommands();
  // 生命周期日志（DSH command/run ↔ command/done 配对的 console 版，
  // 详案补记 2/3：不引入事件系统，先用日志保可观测性）
  console.log(`[command/run] ${line}`);

  const result = await registry.execute(
    line,
    { store, model: selected.model },
    req.signal, // 客户端断开 → 中止命令（/compact 的摘要生成响应取消）
  );
  
  if (result === null) {
    // 区分两种"执行不了"（review 修复）：
    //   - 解析不出命令名（/、/foo/bar 路径、/9abc）= 不是命令形态，
    //     不能报"未知命令：/src"这种事实错误
    //   - 解析出名字但未注册（/copmact）= 真正的未知命令
    const parsed = parseSlashName(line);
    const error =
      parsed === null
        ? `不是命令：${line.trim().split(/\s/)[0]}`
        : `未知命令：/${parsed.name}`;
    console.log(`[command/done] ${line} → ${error}`);
    return NextResponse.json({ error }, { status: 400 });
  }
  console.log(`[command/done] ${line} → ${result.kind}`);
  return NextResponse.json({ result });
}
