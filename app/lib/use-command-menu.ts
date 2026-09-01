"use client";

// ============================================================
// useCommandMenu —— 命令面板 + 输入控制台（C13 前端重构，2026-09-01）
// ============================================================
// 从 page.tsx 拆出（用户吐槽"前端一坨，该封装 hook 没封装"）：
// page 曾把命令面板全套状态 + 过滤 + 键盘导航 + pick + submit 的命令
// 分支堆在组件里（550+ 行）。本 hook 收走"输入框 + 命令面板"这一整块：
//   - input 状态（输入框内容，命令就在输入框里输入，天然同源）
//   - 命令快照（slashCatalog：页面加载 fetch 一次，按键只过滤不重查）
//   - 面板开关 / 高亮 / 过滤 / 键盘导航（↑↓/Enter/Esc/失焦关闭）
//   - pickCommand（填回参数 / 直接执行 / /export 门面触发下载）
//   - submit（命令硬边界校验 + 普通消息回落）
// 依赖注入（不直接 import use-agent-run，保持 hook 可复用可测）：
//   onRunCommand / onSend / onError / sessionId / disabled。
// 未来 C14 @ 文件匹配复用同一套"输入浮层"交互模式。
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { fetchCommands, downloadSessionFile } from "@/app/services/chat";
import {
  isSlashCommandLine,
  parseSlashName,
  validateSubmission,
} from "@/lib/commands/parse";
import type { CommandDescriptor } from "@/lib/commands";

type UseCommandMenuOptions = {
  /** 执行命令（use-agent-run 的 runCommand：POST /api/chat/command + 刷新历史） */
  onRunCommand: (line: string) => Promise<boolean>;
  /** 普通消息发送（use-agent-run 的 send：走 SSE run）——路径回落/非命令形态 */
  onSend: (text: string) => void;
  /** 报错（未知命令横幅；page 传给 use-agent-run 的 setError） */
  onError: (message: string) => void;
  /** 当前会话 id（/export 门面下载用） */
  sessionId: string;
  /** 禁用提交（run 进行中 loading；textarea 同时 disabled） */
  disabled: boolean;
};

export function useCommandMenu({
  onRunCommand,
  onSend,
  onError,
  sessionId,
  disabled,
}: UseCommandMenuOptions) {
  const [input, setInput] = useState(""); // 输入框内容
  // ---- 命令快照（slashCatalog，Reasonix）：加载一次，按键只过滤 ----
  const [commands, setCommands] = useState<CommandDescriptor[]>([]);
  // 快照是否加载成功：失败/未完成时跳过前端命令校验、直接交后端判
  // （review 修复：快照不可用时不能拿空名单误杀合法 /compact）
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);
  const commandMenuRef = useRef<HTMLDivElement>(null); // 失焦关闭判定用
  const inputRef = useRef<HTMLTextAreaElement>(null); // 聚焦/自适应高度用

  useEffect(() => {
    fetchCommands()
      .then((r) => {
        setCommands(r.commands);
        setCommandsLoaded(true);
      })
      .catch(() => {
        /* 命令面板不可用不阻塞聊天（命令快照是增强，不是依赖）；
           保持 commandsLoaded=false：提交时跳过前端校验交给后端判 */
      });
  }, []);

  // 输入框随内容长高（上限由 CSS 的 max-height 兜住）
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [input]);

  // ---- 过滤（slashCatalog 快照只过滤不重查）----
  const commandPrefix = input.startsWith("/") ? input.slice(1) : "";
  const filteredCommands = useMemo(() => {
    if (!commandMenuOpen) return [];
    const prefix = commandPrefix.toLowerCase();
    return commands.filter(
      (c) =>
        c.name.startsWith(prefix) ||
        c.aliases?.some((a) => a.startsWith(prefix)), // 别名只认不显（codex）
    );
  }, [commands, commandMenuOpen, commandPrefix]);

  /** textarea onChange：更新输入 + 命令形态（/ 开头、行首无空格）弹面板 */
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setCommandMenuOpen(isSlashCommandLine(value));
    setCommandActiveIndex(0);
  }, []);

  /** 选中命令：接受参数（/model gpt-4o）→ 填回输入框补参数；
   *  无参数命令（/compact）→ 直接执行（验收：选 /compact → 压缩卡片出现） */
  const pickCommand = useCallback(
    (command: CommandDescriptor) => {
      setCommandMenuOpen(false);
      if (command.supportsInlineArgs) {
        setInput(`/${command.name} `);
        inputRef.current?.focus();
        return;
      }
      setInput("");
      // /export 门面模式（DSH session-log-export）：命令只校验（handler
      // 不产文件），runCommand 业务成功后触发独立 GET 下载会话 JSONL。
      if (command.name === "export") {
        void onRunCommand(`/${command.name}`).then((ok) => {
          if (ok) downloadSessionFile(sessionId);
        });
        return;
      }
      void onRunCommand(`/${command.name}`);
    },
    [onRunCommand, sessionId],
  );

  /** 提交（表单 / 回车都走这里）：命令硬边界校验 + 普通消息回落。
   *  用原始文本判命令形态（行首空格是退出符，trim 会吃掉它） */
  const submit = useCallback(() => {
    if (!input.trim() || disabled) return;
    const raw = input;
    setInput("");
    setCommandMenuOpen(false);
    if (isSlashCommandLine(raw)) {
      // 先解析：/ 开头但解析不出名字 = 路径（/foo/bar）、只有斜杠（/）、
      // 大写/数字开头——都不是命令，按普通消息发（详案补记1：
      // "name 含 /（路径）→ 不拦截"，review 修复：ok:true 含"按普通
      // 消息发"语义，不能一律 runCommand）。
      if (parseSlashName(raw) === null) {
        onSend(raw.trim());
        return;
      }
      // 命令形态 → 硬边界（codex SubmissionValidation）：名字未注册
      // 报错不进模型（`/copmact` 不能当正文发给模型）。
      // 快照未就绪（加载中/失败）时跳过前端校验，直接交后端判——
      // 空名单会误杀合法命令（review 修复）
      if (commandsLoaded) {
        const names = new Set(
          commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
        );
        const check = validateSubmission(raw, names);
        if (!check.ok) {
          onError(`未知命令：/${check.name}，输入 / 查看可用命令`);
          return;
        }
      }
      void onRunCommand(raw);
      return;
    }
    onSend(raw.trim());
  }, [input, disabled, commandsLoaded, commands, onSend, onError, onRunCommand]);

  /** textarea onKeyDown：面板打开时 ↑↓ 移高亮 / Enter 选中 / Esc 关闭；
   *  否则回车发送（Shift+Enter 换行；中文输入法选词的回车不算发送） */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (commandMenuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCommandActiveIndex((i) =>
            Math.min(i + 1, filteredCommands.length - 1),
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCommandActiveIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setCommandMenuOpen(false);
          return;
        }
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.nativeEvent.isComposing &&
          filteredCommands.length > 0
        ) {
          e.preventDefault();
          pickCommand(filteredCommands[commandActiveIndex]);
          return;
        }
        // 无匹配的命令形态 → 落到下方发送逻辑（submit 会报未知命令）
      }
      if (e.key !== "Enter" || e.shiftKey) return;
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      submit();
    },
    [commandMenuOpen, filteredCommands, commandActiveIndex, pickCommand, submit],
  );

  /** textarea onBlur：焦点移到补全面板内（点命令项）不算失焦；移出则关闭 */
  const handleBlur = useCallback((e: FocusEvent<HTMLTextAreaElement>) => {
    if (!commandMenuRef.current?.contains(e.relatedTarget as Node)) {
      setCommandMenuOpen(false);
    }
  }, []);

  return {
    input,
    setInput, // 空态例句（pickSeed）等外部填输入框用
    inputRef,
    commandMenuOpen,
    commandActiveIndex,
    setCommandActiveIndex, // CommandMenu onActiveChange（onMouseEnter 移高亮）
    commandMenuRef,
    filteredCommands,
    handleInputChange,
    handleKeyDown,
    handleBlur,
    pickCommand,
    submit,
  };
}
