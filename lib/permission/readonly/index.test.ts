// ============================================================
// readonly.test.ts —— 只读命令静态判定单测
// ============================================================

import { describe, expect, it } from "vitest";
import { classifyReadOnlyCommand, isReadOnlyBash } from ".";

describe("classifyReadOnlyCommand —— 单命令只读表", () => {
  it("PowerShell 观察性 cmdlet 判定只读", () => {
    expect(classifyReadOnlyCommand("Get-Content foo.txt").ok).toBe(true);
    expect(classifyReadOnlyCommand("dir").ok).toBe(true);
    expect(classifyReadOnlyCommand("Get-ChildItem src").ok).toBe(true);
    expect(classifyReadOnlyCommand("Select-String x file.txt").ok).toBe(true);
    expect(classifyReadOnlyCommand("Get-Location").ok).toBe(true);
  });

  it("Unix 常用只读命令", () => {
    expect(classifyReadOnlyCommand("cat foo.txt").ok).toBe(true);
    expect(classifyReadOnlyCommand("ls -la").ok).toBe(true);
    expect(classifyReadOnlyCommand("grep foo bar.txt").ok).toBe(true);
    expect(classifyReadOnlyCommand("pwd").ok).toBe(true);
    expect(classifyReadOnlyCommand("whoami").ok).toBe(true);
    expect(classifyReadOnlyCommand("ps").ok).toBe(true);
    expect(classifyReadOnlyCommand("echo hello").ok).toBe(true);
  });

  it("命令不区分大小写（pwsh 特性）", () => {
    expect(isReadOnlyBash("get-content a.txt")).toBe(true);
    expect(isReadOnlyBash("GET-CONTENT a.txt")).toBe(true);
    expect(isReadOnlyBash("Git STATUS")).toBe(true);
  });
});

describe("classifyReadOnlyCommand —— 子命令只读表", () => {
  it("git 只读子命令放行", () => {
    expect(classifyReadOnlyCommand("git status").ok).toBe(true);
    expect(classifyReadOnlyCommand("git log --oneline").ok).toBe(true);
    expect(classifyReadOnlyCommand("git diff").ok).toBe(true);
    expect(classifyReadOnlyCommand("git show HEAD").ok).toBe(true);
  });

  it("git 写子命令不放行（fail-closed）", () => {
    expect(classifyReadOnlyCommand("git push").ok).toBe(false);
    expect(classifyReadOnlyCommand("git branch new-feature").ok).toBe(false);
    expect(classifyReadOnlyCommand("git commit -m x").ok).toBe(false);
    expect(classifyReadOnlyCommand("git checkout main").ok).toBe(false);
  });

  it("git tag 只在列出现时只读（创建 tag 拦截）", () => {
    expect(isReadOnlyBash("git tag v1.0")).toBe(false); // 创建 tag = 写
    expect(isReadOnlyBash("git tag")).toBe(true); // 无参 = 列出
    expect(isReadOnlyBash("git tag -l")).toBe(true);
    expect(isReadOnlyBash("git tag --list")).toBe(true);
  });

  it("go env -w / npm audit fix 拦截（表里有但参数是写）", () => {
    expect(isReadOnlyBash("go env -w GOBIN=x")).toBe(false);
    expect(isReadOnlyBash("go env")).toBe(true);
    expect(isReadOnlyBash("npm audit fix")).toBe(false);
    expect(isReadOnlyBash("npm audit")).toBe(true);
  });

  it("cargo 整表 fail-closed（check/doc 写构建产物）", () => {
    expect(isReadOnlyBash("cargo check")).toBe(false);
    expect(isReadOnlyBash("cargo doc")).toBe(false);
  });

  it("其他工具链只读子命令", () => {
    expect(classifyReadOnlyCommand("npm ls").ok).toBe(true);
    expect(classifyReadOnlyCommand("npm view react").ok).toBe(true);
    expect(classifyReadOnlyCommand("go vet ./...").ok).toBe(true);
    expect(classifyReadOnlyCommand("node -v").ok).toBe(true);
  });
});

describe("classifyReadOnlyCommand —— fail-closed 走私语法", () => {
  it("管道不自动放行", () => {
    expect(isReadOnlyBash("Get-Content a | Select-String x")).toBe(false);
  });

  it("重定向不自动放行", () => {
    expect(isReadOnlyBash("git status > out.txt")).toBe(false);
    expect(isReadOnlyBash("Get-Content a.txt > b.txt")).toBe(false);
  });

  it("命令链/后台不自动放行", () => {
    expect(isReadOnlyBash("dir; rm x")).toBe(false);
    expect(isReadOnlyBash("dir && whoami")).toBe(false);
    expect(isReadOnlyBash("sleep 5 &")).toBe(false);
  });

  it("命令替换/反引号不自动放行", () => {
    expect(isReadOnlyBash("echo $(whoami)")).toBe(false);
    expect(isReadOnlyBash("echo `whoami`")).toBe(false);
  });
});

describe("classifyReadOnlyCommand —— 只读命令带写参数", () => {
  it("find -exec / -delete 拦截", () => {
    expect(isReadOnlyBash("find . -exec rm {} \\;")).toBe(false);
    expect(isReadOnlyBash("find . -delete")).toBe(false);
    // 纯只读 find 放行
    expect(isReadOnlyBash("find . -name '*.ts'")).toBe(true);
  });

  it("find 其他写参数（-fls/-fprint 等）拦截", () => {
    expect(isReadOnlyBash("find . -fprint out.txt")).toBe(false);
    expect(isReadOnlyBash("find . -fls out.txt")).toBe(false);
  });

  it("sort -o / --output= 变体拦截", () => {
    expect(isReadOnlyBash("sort a.txt -o b.txt")).toBe(false);
    expect(isReadOnlyBash("sort a.txt --output=b.txt")).toBe(false);
    expect(isReadOnlyBash("sort a.txt")).toBe(true);
  });

  it("git diff --output 拦截", () => {
    expect(isReadOnlyBash("git diff --output=patch.diff")).toBe(false);
  });
});

describe("classifyReadOnlyCommand —— 边界", () => {
  it("空命令/空白 fail-closed", () => {
    expect(isReadOnlyBash("")).toBe(false);
    expect(isReadOnlyBash("   ")).toBe(false);
  });

  it("未知命令 fail-closed", () => {
    expect(isReadOnlyBash("rm -rf node_modules")).toBe(false);
    expect(isReadOnlyBash("Set-Content a.txt hello")).toBe(false);
    expect(isReadOnlyBash("Remove-Item a.txt")).toBe(false);
  });

  it("引号包裹路径仍放行（不改只读本质）", () => {
    expect(isReadOnlyBash('Get-Content "my file.txt"')).toBe(true);
  });

  it("通配符仍放行（展开后仍是读）", () => {
    expect(isReadOnlyBash("Get-Content *.txt")).toBe(true);
  });

  it("环境变量引用仍放行", () => {
    expect(isReadOnlyBash("Get-Content $env:USERPROFILE\\a.txt")).toBe(true);
  });
});
