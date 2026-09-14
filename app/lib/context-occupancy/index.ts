// ============================================================
// context-occupancy.ts —— 上下文占用计算（C13，抄 DSH ContextMeter）
// ============================================================
// 抄 DSH `packages/client/ui-conversation/src/client/context-occupancy.ts`：
// 发送按钮旁的占用圆环的数据源——后端推 contextPressure（分子/容量），
// 这里算展示用的百分比。纯函数、无依赖、可单测。
// 设计要点（DSH 原样）：
//   - projectedTokens 优先（预测占用，含正在生成的响应），否则 pressureTokens
//   - percent 封顶 100（超窗显示满，不爆表）
//   - 分子或容量未知 → null（组件不渲染，优雅降级）
// ============================================================

/** 后端提供的上下文占用数据（fetchHistory / done 帧携带） */
export interface ContextPressure {
  /** 当前上下文 token 数（estimateTokens(buildContext)）；与 projected 都缺 → 不渲染 */
  pressureTokens?: number;
  /** 预测占用（可选）：含正在生成的响应的估计值，优先于 pressureTokens */
  projectedTokens?: number;
  /** 模型上下文窗口上限（config.provider.contextWindow） */
  contextWindow: number;
}

/** 展示用的占用结果 */
export interface ContextOccupancy {
  /** 占用百分比（0-100，封顶 100） */
  percent: number;
  /** 实际采用的 token 数（projected ?? pressure） */
  usedTokens: number;
  /** 窗口上限 */
  contextWindow: number;
}

/**
 * 解析有界展示占用。分子（projectedTokens ?? pressureTokens）或容量未知
 * → null（组件不渲染）。
 */
export function contextOccupancy(
  pressure: ContextPressure | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
  if (usedTokens === undefined || pressure?.contextWindow === undefined) {
    return null;
  }
  return {
    percent: Math.min(
      100,
      Math.round((usedTokens / pressure.contextWindow) * 100),
    ),
    usedTokens,
    contextWindow: pressure.contextWindow,
  };
}
