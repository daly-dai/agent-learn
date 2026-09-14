// ============================================================
// bash-runner —— Windows 命令行包装的单元测试
// ============================================================
// 测的是 buildWindowsCommandLine 的纯函数部分：
//   - chcp 65001 前缀存在（输出端统一 UTF-8 的关键）
//   - 命令被 UTF-16LE base64 编码（-EncodedCommand 要求）
//   - base64 不含 cmd 特殊字符（引号/&/| 不会破坏 cmd 解析）
//   - PWSH_PATH 环境变量生效
// 注意：受限语言模式下（本沙箱），Node spawn 子进程 + 捕获输出被禁
//   （EPERM），所以这里只测纯函数，不真 spawn。
// ============================================================

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildWindowsCommandLine } from ".";

const ORIGINAL_PWSH_PATH = process.env.PWSH_PATH;

beforeEach(() => {
  delete process.env.PWSH_PATH;
});

afterEach(() => {
  if (ORIGINAL_PWSH_PATH === undefined) {
    delete process.env.PWSH_PATH;
  } else {
    process.env.PWSH_PATH = ORIGINAL_PWSH_PATH;
  }
});

describe("buildWindowsCommandLine", () => {
  it("以 chcp 65001 开头（输出端统一 UTF-8 的关键）", () => {
    const line = buildWindowsCommandLine("Write-Output 'hi'");
    expect(line.startsWith("chcp 65001 >nul & ")).toBe(true);
  });

  it("用 pwsh -NoProfile -EncodedCommand 传命令", () => {
    const line = buildWindowsCommandLine("Write-Output 'hi'");
    expect(line).toContain("pwsh -NoProfile -EncodedCommand ");
  });

  it("命令被 UTF-16LE base64 编码（-EncodedCommand 要求）", () => {
    const line = buildWindowsCommandLine("Write-Output '中文'");
    const b64 = line.split("EncodedCommand ")[1];
    // base64 解回 UTF-16LE 应还原原命令
    const decoded = Buffer.from(b64, "base64").toString("utf16le");
    expect(decoded).toBe("Write-Output '中文'");
  });

  it("base64 不含 cmd 特殊字符（引号/&/|/% 不会破坏 cmd 解析）", () => {
    const line = buildWindowsCommandLine(
      `Write-Output "a & b | c" ; echo %PATH% ; 'x"y'`,
    );
    const b64 = line.split("EncodedCommand ")[1];
    // base64 字母表只有 A-Za-z0-9+/=
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("中文命令经 base64 往返不变", () => {
    const command = 'Get-Content -Path "精读走读-04-pi-压缩对照.md" -Encoding UTF8';
    const line = buildWindowsCommandLine(command);
    const b64 = line.split("EncodedCommand ")[1];
    expect(Buffer.from(b64, "base64").toString("utf16le")).toBe(command);
  });

  it("PWSH_PATH 环境变量存在时用引号包住真实路径", () => {
    process.env.PWSH_PATH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const line = buildWindowsCommandLine("Write-Output 'hi'");
    expect(line).toContain(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile',
    );
    expect(line).not.toContain(" & pwsh -NoProfile");
  });

  it("PWSH_PATH 未设置时回退到 PATH 里的 pwsh", () => {
    const line = buildWindowsCommandLine("Write-Output 'hi'");
    expect(line).toContain(" & pwsh -NoProfile");
  });
});
