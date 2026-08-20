// ============================================================
// HTTP 客户端 —— 全项目唯一的 fetch 样板
// ============================================================
// 只服务 JSON 接口（会话 CRUD、审批、停止……）。
// SSE 流式接口（POST /api/chat）不走这里——它要原始 res.body 交给
// readStream，在 plugins/http/chat/index.ts 里单独实现。
//
// 三个设计点（做中学）：
// 1. 泛型 <T>：返回类型由调用方声明，函数自己不猜响应形状
// 2. body 有值才加 Content-Type + JSON.stringify：GET/DELETE 零样板
// 3. !res.ok 抛 ApiError（带服务端 error 消息）：区分「业务拒绝」
//    和「网络故障」（fetch 自己抛的 TypeError），不混为一谈
// ============================================================

/** 业务错误：服务端明确拒绝（!res.ok），带状态码和消息 */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(
  url: string,
  options?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown; // 有值 → 自动 JSON.stringify + Content-Type
    signal?: AbortSignal; // 组件卸载取消请求（替代手写 cancelled 标志）
  },
): Promise<T> {
  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers:
      options?.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options?.signal,
  });

  if (!res.ok) {
    // 服务端明确拒绝了：尽量带出它的 error 消息（如「非法会话 id」「已超时」）
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }

  return (await res.json()) as T;
}
