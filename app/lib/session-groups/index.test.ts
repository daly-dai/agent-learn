// ============================================================
// 会话分组（C49）—— 纯函数用例
// ============================================================
// 这一层的"会错且不报错"的形状有三种，用例就盯这三件事：
//   ① 归属判错（会话落到错的工作空间，或该进未登记却没进）
//   ② 顺序错（组的顺序 / 组内顺序 —— 用户看到的"最近在哪"直接错）
//   ③ 空组消失（刚建的空工作空间看不见，用户以为没建成）

import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace";
import {
  INITIAL_VISIBLE_SESSIONS,
  UNREGISTERED_TITLE,
  foldGroup,
  groupSessions,
  type GroupableSession,
} from "./index";

function workspace(
  overrides: Partial<Workspace> & { path: string },
): Workspace {
  return {
    id: `id-${overrides.path}`,
    title: overrides.path.split(/[\\/]/).pop() ?? overrides.path,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    ...overrides,
  };
}

function session(
  cwd: string,
  updatedAt: number,
  id = `s-${cwd}-${updatedAt}`,
): GroupableSession {
  return { id, cwd, updatedAt };
}

const projA = workspace({
  path: "E:\\proj-a",
  updatedAt: "2026-11-11T01:00:00.000Z",
});
const projB = workspace({
  path: "D:\\proj-b",
  updatedAt: "2026-11-11T02:00:00.000Z",
});
const emptyWs = workspace({
  path: "E:\\empty",
  updatedAt: "2026-11-11T03:00:00.000Z",
});

describe("groupSessions —— 归属", () => {
  it("cwd 与记录 path 相同 → 归到那个组，标题用记录的显示名", () => {
    const groups = groupSessions([session("E:\\proj-a", 100)], [projA]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("E:\\proj-a");
    expect(groups[0].title).toBe("proj-a");
    expect(groups[0].workspaceId).toBe(projA.id);
  });

  it("匹配不到的 cwd（含空串）→ 未登记组，且排最后", () => {
    const groups = groupSessions(
      [session("E:\\proj-a", 100), session("E:\\gone", 900), session("", 800)],
      [projA],
    );

    expect(groups).toHaveLength(2);
    expect(groups[1].key).toBe("");
    expect(groups[1].title).toBe(UNREGISTERED_TITLE);
    expect(groups[1].workspaceId).toBeUndefined();
    expect(groups[1].sessions.map((item) => item.cwd)).toEqual([
      "E:\\gone",
      "",
    ]);
  });

  it("没有工作空间、只有会话 → 一个未登记组", () => {
    const groups = groupSessions([session("E:\\x", 1)], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe(UNREGISTERED_TITLE);
  });

  it("什么都没有 → 空列表（不造一个空组出来）", () => {
    expect(groupSessions([], [])).toEqual([]);
  });
});

describe("groupSessions —— 顺序与空组", () => {
  it("组按工作空间 updatedAt 倒序（未登记组压最后）", () => {
    const groups = groupSessions(
      [
        session("E:\\proj-a", 100),
        session("D:\\proj-b", 100),
        session("E:\\gone", 999),
      ],
      [projA, projB, emptyWs],
    );

    expect(groups.map((group) => group.title)).toEqual([
      "empty",
      "proj-b",
      "proj-a",
      UNREGISTERED_TITLE,
    ]);
  });

  it("组内按会话 updatedAt 倒序", () => {
    const groups = groupSessions(
      [
        session("E:\\proj-a", 100, "old"),
        session("E:\\proj-a", 300, "new"),
        session("E:\\proj-a", 200, "mid"),
      ],
      [projA],
    );

    expect(groups[0].sessions.map((item) => item.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("空工作空间仍然出现（0 条会话）——先建空间的人必须看得见", () => {
    const groups = groupSessions([], [emptyWs]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toEqual([]);
  });
});

describe("groupSessions —— 不丢原对象", () => {
  it("会话对象原样带出去（title / preview 等字段不受影响）", () => {
    const rich = {
      id: "s1",
      cwd: "E:\\proj-a",
      updatedAt: 100,
      title: "我的会话",
      preview: "第一句",
    };
    const groups = groupSessions([rich], [projA]);

    expect(groups[0].sessions[0]).toBe(rich);
    expect(groups[0].sessions[0].title).toBe("我的会话");
  });

  it("不打乱传进来的数组", () => {
    const input = [session("E:\\proj-a", 100), session("E:\\proj-a", 300)];
    const snapshot = input.map((item) => item.id);

    groupSessions(input, [projA]);

    expect(input.map((item) => item.id)).toEqual(snapshot);
  });
});

describe("foldGroup —— 每组先 5 条", () => {
  it("不超过 5 条：全展示，没有「展开」这一行", () => {
    const sessions = Array.from({ length: 5 }, (_, index) =>
      session("E:\\proj-a", index),
    );
    expect(foldGroup(sessions, false)).toEqual({
      visible: sessions,
      hiddenCount: 0,
    });
  });

  it("超过 5 条且未展开：只给前 5 条 + 其余数量", () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      session("E:\\proj-a", index),
    );
    const folded = foldGroup(sessions, false);

    expect(folded.visible).toHaveLength(INITIAL_VISIBLE_SESSIONS);
    expect(folded.hiddenCount).toBe(3);
  });

  it("展开后全给，隐藏数为 0", () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      session("E:\\proj-a", index),
    );
    const folded = foldGroup(sessions, true);

    expect(folded.visible).toHaveLength(8);
    expect(folded.hiddenCount).toBe(0);
  });
});
