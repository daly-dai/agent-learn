// ============================================================
// config —— 全项目配置的唯一入口（集中读取 + 默认值）
// ============================================================
//
// 为什么集中：项目里配置零零散散写死在代码里（route.ts 的
// workspaceRoot/压缩阈值/审批超时、deepseekModel 的 DEFAULT_MODEL、
// bash-runner 的超时……）。改一处配置要找遍全项目，且换 provider
// 时要改多个文件。集中到这里，读配置只有这一个入口。
//
// 分层：
//   - 环境变量（服务端秘密 / 部署时决定）：从 process.env 读
//   - 默认值：写在 config 里（可被 env 覆盖）
//   - 将来（C7 设置页）：UI 读写持久化配置，同样经这里
//
// 为什么 provider 是数组（2026-08-25 设计）：以后不止接 DeepSeek。
// 每家模型的上下文窗口/压缩阈值/请求地址都不一样——压缩阈值要按
// provider 配（DeepSeek V4 是 1M 窗口，别的家可能 128K/256K）。
// 结构上留"provider 可扩展"的口子：换模型 = 换 provider key，
// 配置随 provider 走，不散落在引擎里。
//
// 读取工具：env() 取字符串（带默认值），num() 取数字（带默认值）。
// 所有字段都是「字符串入、类型化出」，调用方拿到的永远是安全值。
// ============================================================

import { resolve } from "node:path";

/** 从 process.env 读字符串；没设（含空串）时用默认值 */
function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

/** 从 process.env 读数字；非法时用默认值（fail-soft，不崩） */
function num(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 当前启用的 provider 及其配置。
 * 新增模型厂商 = 在 providers 里加一项 + 写一个适配器（lib/ 下）+
 * 在 route.ts 的 selectModel 里按 key 分支。引擎完全无感。
 */
export type ProviderConfig = {
  /** 显示名（SSE run 帧 / 轨迹用） */
  label: string;
  /** OpenAI 兼容 API 地址（主对话，走 `${baseUrl}/chat/completions`） */
  baseUrl: string;
  /** 模型 id */
  model: string;
  /**
   * 服务端搜索端点（Anthropic 兼容，走 `${search.baseUrl}/messages`）。
   *
   * ⚠️ **和上面的 `baseUrl` 不是一个路径，绝不能复用**：`baseUrl` 随
   * `AI_PROVIDER` 变，一旦搜索读了它，切到别家就会把搜索请求发到那家的
   * 地址上。而 DeepSeek 对**不认识**的模型名是**静默映射**的
   * （`claude-opus*` → `deepseek-v4-pro`，按 V4 Pro 收费）——
   * 发错不会报错，只会悄悄变贵。`index.test.ts` 里有一条断言钉这件事。
   *
   * 为什么 `model` 也在这里、而不是复用上面的 `model`：同理。搜索模型
   * 只对**这个搜索端点**有意义。
   */
  search: {
    baseUrl: string;
    model: string;
  };
  /** 上下文窗口（token）——压缩阈值按它算：窗口 - 预留 */
  contextWindow: number;
  /** 压缩触发时预留的 token（给摘要 prompt + 输出） */
  reserveTokens: number;
  /** 压缩后保留的最近 token 预算 */
  keepRecentTokens: number;
  /** 压缩后保留的最近消息条数（教学版简单规则，二期按 token） */
  keepRecentMessages: number;
};

const PROVIDERS: Record<string, ProviderConfig> = {
  // DeepSeek V4：官方 1M 上下文窗口（2026-08 确认）。
  // 触发阈值 = 窗口 - 预留：预留 16K 给摘要，约 984K 才压——几十上百轮才触发。
  // 【测试口子】窗口/预留支持 env 覆盖（CONTEXT_WINDOW / RESERVE_TOKENS）：
  // 想快速触发压缩，设 CONTEXT_WINDOW=3000 之类的小值即可（改 .env.local 后重启 dev）。
  deepseek: {
    label: "deepseek",
    // ⚠️ 这两个**曾经是字面量**，而 `.env.local.example` 里已经写着
    //    "可选：覆盖默认值"——文档承诺了一个不存在的开关（2026-09-14 修）。
    baseUrl: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    model: env("DEEPSEEK_MODEL", "deepseek-v4-flash"),
    // 搜索走 Anthropic 兼容端点（`/anthropic/v1/messages`），
    // 和上面的 OpenAI 兼容端点**不是一条路**。见 ProviderConfig.search 的说明。
    search: {
      baseUrl: env("DEEPSEEK_SEARCH_BASE_URL", "https://api.deepseek.com/anthropic/v1"),
      model: env("DEEPSEEK_SEARCH_MODEL", "deepseek-v4-flash"),
    },
    contextWindow: num("CONTEXT_WINDOW", 1_000_000),
    reserveTokens: num("RESERVE_TOKENS", 16_384),
    keepRecentTokens: 20_000,
    // 保留最近 N 条消息（测试口子：KEEP_RECENT_MESSAGES 可覆盖）
    keepRecentMessages: num("KEEP_RECENT_MESSAGES", 8),
  },
  // 占位：将来加 Anthropic / OpenAI / 本地 ollama……
  // anthropic: { label: "anthropic", baseUrl: "...", model: "...", contextWindow: 200_000, ... },
};

/** 当前 provider key：DEEPSEEK_PROVIDER 或 AI_PROVIDER；默认 deepseek */
const providerKey = env("AI_PROVIDER", "deepseek");

export const config = {
  /** 当前 provider（压缩阈值 / 模型 / 地址都随它走） */
  provider: (PROVIDERS[providerKey] ?? PROVIDERS.deepseek) as ProviderConfig,

  /** 模型秘密（适配层用；provider 字段只在适配层出现） */
  modelSecrets: {
    apiKey: env("DEEPSEEK_API_KEY", ""),
    /** 离线教学模式：MOCK_MODE=true 用 MockModel（无 key 也能跑） */
    mockMode: env("MOCK_MODE", "") === "true",
  },

  /** 路径（环境变量可覆盖；默认工作区/轨迹/会话目录） */
  paths: {
    workspace: env("WORKSPACE_ROOT", resolve(process.cwd(), "workspace")),
    traces: env("TRACE_DIR", resolve(process.cwd(), ".traces")),
    sessions: env("SESSION_DIR", resolve(process.cwd(), ".sessions")),
    /** 参考开源项目根（C15 仓库更新面板：E:\agents-read 下的 git clone） */
    reposRoot: env("REPOS_ROOT", "E:\\agents-read"),
    /** 仓库更新基线（C15：记录每个仓库上次更新到的 commit，增量总结用；gitignore） */
    repoBaselines: env("REPO_BASELINE_DIR", resolve(process.cwd(), ".repo-updates")),
  },

  /** 引擎行为（压缩阈值随 provider 走，见 config.provider） */
  agent: {
    /** 调试：轨迹/SSE 打印请求概览 */
    debugDeepSeek: env("DEBUG_DEEPSEEK", "") === "true",
    /**
     * 压缩经济性检查（Reasonix D6，doc/02）：待压区域低于该 token 数就不压——
     * 省下的 token 不够抵消一次摘要 API 调用的成本/延迟。
     */
    minCompactTokens: num("MIN_COMPACT_TOKENS", 400),
    /** Agent 循环最大轮次（防无限循环的护栏；route.ts 传入 runAgentLoop） */
    // 默认 16（原 6 太紧：长任务常常一轮工具调用就多轮，6 轮容易误触护栏；
    // 16 是实测日常够用的值。MAX_TURNS 可覆盖，测试时可调小观察护栏行为）
    maxTurns: num("MAX_TURNS", 16),
  },

  /** 人工确认（写/改/删弹框） */
  approval: {
    /** 超时兜底：默认 5 小时（前端不展示时间，用户不该有催促感） */
    timeoutMs: num("APPROVAL_TIMEOUT_MS", 5 * 60 * 60 * 1000),
    /** 审批模式（B1-② 分级，抄 CodeWhale approval_mode）：
     *  suggest 默认——只读命令静态分析放行 + 写操作弹框
     *  bypass（YOLO）——除硬性策略外全部放行（调试/教学演示）
     *  never——需确认的工具直接拒绝（演示安全边界）
     *  APPROVAL_MODE 环境变量覆盖 */
    mode: env("APPROVAL_MODE", "suggest"),
  },

  /** bash 命令执行 */
  bash: {
    timeoutMs: num("BASH_TIMEOUT_MS", 30_000),
    maxOutputChars: num("BASH_MAX_OUTPUT_CHARS", 64 * 1024),
  },

  /**
   * 联网工具（web_search / web_fetch）的行为旋钮。
   *
   * ⭐ 为什么这些在这里、而**端点**在 `provider` 段：
   *   判据是「换个厂商会不会变」——**会变**的（在哪、跟谁说）归 provider，
   *   **不会变**的（我们允许它做多少）归这里。`maxResults = 8` 换哪家都是 8。
   */
  web: {
    search: {
      /** 一次搜索请求的生成 token 上限（只要一小段，不需要大） */
      maxTokens: num("WEB_SEARCH_MAX_TOKENS", 4096),
      /** 一次请求内允许模型用几次服务端搜索 */
      maxUses: num("WEB_SEARCH_MAX_USES", 5),
      /** 返回来源数上限（超了砍掉并标记截断） */
      maxResults: num("WEB_SEARCH_MAX_RESULTS", 8),
      /** 一次工具调用接受的查询条数上限（模型可以给多条，并发搜） */
      maxQueries: num("WEB_SEARCH_MAX_QUERIES", 4),
    },
    fetch: {
      timeoutMs: num("WEB_FETCH_TIMEOUT_MS", 15_000),
      /** 读进来的字节上限（1 MiB）；到顶就断开，不把整个响应下完再扔 */
      maxBytes: num("WEB_FETCH_MAX_BYTES", 1024 * 1024),
      /** 重定向跳数上限；每跳都要重新过 SSRF 闸门 */
      maxRedirects: num("WEB_FETCH_MAX_REDIRECTS", 3),
      /** 给模型的完整输出（头 + 声明 + 正文 + 截断提示）字符上限 */
      maxOutputChars: num("WEB_FETCH_MAX_OUTPUT_CHARS", 200_000),
    },
  },
} as const;

/**
 * 压缩触发判断（对齐 pi shouldCompact：接近窗口上限才压）。
 * 压缩是"防爆窗"的保险，不是"勤打扫"——窗口大就不该频繁触发。
 */
export function shouldCompact(
  currentTokens: number,
  provider: ProviderConfig = config.provider,
): boolean {
  return currentTokens > provider.contextWindow - provider.reserveTokens;
}

/** 压缩时保留多少条最近消息（教学版简单规则；二期改按 token 预算） */
export function compactKeepRecent(provider: ProviderConfig = config.provider): number {
  return provider.keepRecentMessages;
}
