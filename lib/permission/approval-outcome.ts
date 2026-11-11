// ============================================================
// 审批结果类型 —— 一个纯类型，住在 lib 是因为**两边都要用**
// ============================================================
// 消费方：
//   - `lib/toolApproval.ts`（挂起的确认 → resolve 成结果）
//   - `app/api/chat/route.ts`（弹框的返回值）
//   - `app/api/chat/_pipeline/approval`（决策纯函数）
//
// 为什么从 lib 出发而不是 app：lib 不许依赖 app（分层）。以前它住在
// `lib/permission/approval-log`，C52 删掉那个模块后，类型单独留在这里。

/** 用户在弹框里的选择：前三种都是"允许"，只是信任期限不同 */
export type ApprovalOutcome =
  | "approved" // 单次允许
  | "approved-session" // 本会话允许（内存记忆）
  | "approved-persist" // 一直允许（持久化规则）
  | "denied"
  | "timeout";
