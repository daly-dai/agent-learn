# DSH 会话架构：session / log / surface 三件套（源码精读）

> 精读对象：DSH `packages/core/session/src/index.ts`（Session 类 1157 行）+ `surface.ts`（SurfaceManager 460 行）+ `packages/session/session-persistence-jsonl`（落盘）。
> 配套：`doc/知识点-06-DSH-压缩机制.md`（压缩事务本身）、`workspace/精读走读-24-DSH-压缩对照.md`（我们 vs DSH 对照）。
> 本文回答：**session、log、surface 到底是什么关系？数据怎么流动？重启后怎么恢复？**——理解 DSH 一切机制（压缩、fork、恢复）的地基。

---

## 一、三件套：不是平级，是"包含"

最容易蒙的根源：把三者当成并列的三个东西。**其实是包含关系——session 是个盒子，log 和 surface 都是它的内部零件。**

```
Session（一个会话 = 一个对象，活在内存里）
│
├── header         元数据（id / cwd / 谱系 lineage / 创建时间）
│
├── log            ✅ 全部事件，append-only（真相）       private log: SessionEvent[]
│                    一行一个事件：user/message、assistant/message、
│                    tool/result、turn/start、compaction/start ……
│
└── surfaceManager ✅ log 的"折叠视图"（getter: session.surface）
                     ├── nodes: number[]        ← 当前模型可见的 seq 列表（索引）
                     ├── replaceGeneration      ← 替换版本号
                     └── _lastProcessedSeq      ← 增量折叠进度
```

三个关键认知：

1. **log 和 surface 都是 session 的零件**。session = 容器，log = 内容物，surface = 容器里的"当前展示清单"。
2. **log 是唯一真相**：所有事件（含被压缩掉的、被遮蔽的）都在 log 里，**永不删**。
3. **surface 不是数据副本，是索引 + 折叠状态**：只存"现在该看哪些 seq"（一串编号），消息本体还在 log，读的时候 `log[seq]` 取。

| 角色 | 是什么 | 类比 |
|---|---|---|
| **session** | 一个会话的对象，持有 log + surface + header | 档案室（含总账 + 展示架 + 门牌） |
| **log** | 会话的完整事件流水账，append-only | 总账本：每一笔记录都在 |
| **surface** | log 的增量折叠视图：当前模型可见的 seq 索引 | 展示架上摆着的编号清单（不是文件本身） |

> **模型看到什么 = surface 决定；数据在哪 = log 里。**

---

## 二、三条数据流（核心中的核心）

### 路径 ① 写入（一条新消息进会话）

```
append(type, data, { surfaceOp })
  ├─ ① 校验：surfaceManager.validateNext(event)   ← 坏事件在这就报错，进不了 log
  ├─ ② 落内存：log.push(event)                    ← 真相入库
  └─ ③ 广播：发 session/event 事件                ← 持久化插件收到，追加写磁盘文件
```

### 路径 ② 读取（给模型拼上下文）

```
deriveMessages()
  ├─ ① surface.nodes（若 log 有新增，先惰性折叠 delta）
  ├─ ② 对每个可见 seq：log[seq] 取出事件
  └─ ③ 投影成 Message（deriveEventMessage），带缓存
```

### 路径 ③ 重启/恢复（电脑重启后）

```
磁盘文件（JSONL / sqlite）读回全部事件
  → 作为 seed 构造新 Session（log 重新填满）
  → surface 首次被访问时【全量折叠一次】= O(N)
  → 之后恢复增量 = O(新增)
```

---

## 三、增量折叠 + 惰性更新（一个机制的两面）

### 增量折叠：不是每次全量重放

SurfaceManager 维护一份状态（nodes + replaceGeneration + `_lastProcessedSeq`），**只处理新增的那一小段**：

```ts
get nodes(): readonly number[] {
  if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) {
    this._processDelta()   // 只折叠"上次之后新增"的事件
  }
  return this._state.nodes
}
```

O(新增事件数)，不是 O(全部日志)。

### 惰性更新：写时只校验、读时才应用

看 `append` 内部（index.ts:604-655），**更新分两个时机**：

```
append(...)
  ├─ validateNext(event)      ← ① 写时：只【校验】surface 元数据（此时视图还没变！）
  ├─ log.push(event)          ←    事件进内存日志
  └─ 发 session/event         ←    持久化插件写文件
  （视图此刻不变）
  ...
  deriveMessages() / surface.nodes
  └─ _processDelta()          ← ② 读时：惰性【应用】——把没处理的 delta 折叠进视图
```

- **写时只校验**：坏事件在 append 处抛错，进不了日志（"校验先行，fail-fast"），但不动视图。
- **读时惰性应用**：发现 log 有新增，才把 delta 折叠进去。

> 这是典型的"写路径零成本（只验证）、读路径按需补算（lazy）"设计。压缩事务里那串 append 全都只做校验，真正让视图变化的是事务之后第一次有人读 `surface.nodes` 或 `deriveMessages()`。

---

## 四、持久化：session log（电脑里那个文件）

**运行期全在内存**（log 是内存数组），**落盘靠持久化插件**：

```
append(事件) → 内存 log → 发 session/event 事件 → 持久化插件（PersistenceCoordinator）
  → 追加写磁盘文件：每会话一个 JSONL 文件（session log），支持 zstd 压缩
```

文件结构（`session-persistence-jsonl` 注释原文："one append-only file per session"）：

```
<sessionId>.jsonl
├── 第 1 行：header（版本 / id / cwd / 谱系）
├── 第 2 行：事件 0
├── 第 3 行：事件 1
├── …… 每行一个事件，按 seq 顺序追加
└── 最后一行：最新事件
```

**术语**：session log（JSONL 会话日志）——内存 log 的落盘拷贝，重启用它重建整个 Session（含 surface）。

---

## 五、压缩的"四条事件"（200 → 204 从哪来）

压缩事务往 log 追加 4 条，**每条一个职责，少一条就有漏洞**：

| # | 事件 | 角色 | 进 surface | 类比 |
|---|---|---|---|---|
| ① | `compaction/start` | **上锁**：占位"压缩进行中" | 否（log-only） | 进厕所挂"有人"的锁 |
| ② | `compaction/summary` | **记账**：总结内容、压了哪些 seq、token、哪个模型 | 否（log-only） | 工作日志 |
| ③ | `user/message`（检查点） | **干活**：真正把旧消息替换成摘要（surfaceOp: replace） | **是** | 交付物 |
| ④ | `compaction/end` | **解锁**：标记结束 | 否（log-only） | 出来摘锁 |

**为什么不能省**：只有③没锁 → 并发乱套；只有③④没② → 没法审计；①②③没④ → 永远锁死（未闭合 start 判忙）；②③④没③ → surface 没变、白压。

**两条关键设计**：
- **锁落日志（durable）而不是内存标志**：崩溃后重放日志能认出"有未闭合的 start"，锁跟着真相走。
- **②记账和③替换分开**：② log-only（给审计/计费看）、③ surface 事件（给模型看），shadow-price 协议——替换消息的价格由紧贴它的 ② 声明；③ 的 `sourceEventSeqs` 引用 `[start.seq, summary.seq, ...被压的seq]`，把四条串成可追溯的链。

---

## 六、两个坐标系：seq（log 下标）vs 表面位置（surface index）

**这是最容易混的地方，也是理解恢复机制的关键。**

```
log 视角（seq，单调递增）：[msg1 .. msg9 | 保留区 | start summary 检查点 end]
                                  检查点 append 在末尾（seq 最大），旧数据不动
surface 视角（位置）：     [检查点 | 保留区]
                                  检查点顶替被压区间、站在最前面
```

- 检查点消息 seq=203（log 末尾），但在 surface 上站在第 0 位——**同一个东西，两个坐标系**。
- 所以 `shadowedRange` 的注释说："start can be GREATER than end"——start/end 是**当时站在那个位置的节点**，不是数值区间。第二次压缩时 start（旧检查点，高 seq）可能大于 end（老消息，低 seq），**正常现象，不是 bug**。
- 这也解释了为什么 `validateSurfaceRegion` 用 `nodes.indexOf(start)` 找位置，而不是把 start 当数组下标直接用。

**一次压缩的数字账**（200 条对话为例）：

| | 压缩前 | 压缩后 |
|---|---|---|
| log 条数（文件） | 200 | **204**（200 旧 + 4 压缩事件，1~100 还在） |
| surface 节点数（模型可见） | 200 | **101**（1 检查点 + 100 保留区） |

"101"是 surface 的（可见节点数），"204"是 log 的（文件条数）——两个数字别混。

---

## 七、恢复机制：全量重放，不是"看最后一个 replace"

**surface 索引顺序不存文件**——它每次都是从 log 重放"算出来"的：

```
恢复：文件读回 204 条 → seed 构造 Session → 首次访问 surface.nodes 时全量折叠：
  for 每个事件（按 seq 顺序）：
    append        → push 到 nodes 末尾
    replace{start,end} → 在【当前累积的 nodes 里】找位置 → splice 替换
    log-only      → 跳过
  最终 nodes = [检查点, 保留区...]  ← 正确的初始索引数组
```

**为什么必须全量重放而不是看最后一个 replace**：

1. **可能有多次压缩**（多个 replace）——只看最后一个，前面替换产生的"表面位置"无从定位。
2. **replace 的 start/end 是表面位置，依赖之前的折叠结果**：第二次压缩的 start 可能是第一次压缩的检查点（高 seq 站在老位置）。**顺序即状态，跳一步就全错。**

类比：surface 是"操作历史"不是"照片"。存的是操作指令（append/replace），结果每次重放算出——照片会丢，指令不会（log 永不删）。这也解释了为什么"重启后视图一定正确"：**同一个 log + 同一个算法 = 同一个结果。**

---

## 八、和你们项目（agent-learn）的对照

| 概念 | 你们 | DSH |
|---|---|---|
| session | `JsonlSessionStore`（内存 entries + 磁盘 JSONL） | `Session` 类（内存 log + header） |
| log（真相） | `entries: SessionEntry[]`（同步写文件） | `log: SessionEvent[]`（插件异步写文件） |
| surface（视图） | **没有独立对象**：`buildContext()` 每次从叶子回溯现算 | `SurfaceManager`：增量维护的独立对象 |
| "哪些进上下文" | buildContext 里的过滤逻辑（跳过被压消息） | surface.nodes（replace 遮蔽） |
| 磁盘文件 | `.sessions/<id>.jsonl` | session log（JSONL，zstd 压缩） |
| 重启恢复 | 读 JSONL 重建 entries + byId | 文件读回 → seed → 重建 log + surface 全量折叠 |

**你们的 `buildContext()` ≈ DSH 的 `deriveMessages()`**——差别只有一点：你们每次全量回溯（O(N)），DSH 增量缓存（O(新增)）。**同一个思想，DSH 多了个性能优化。**

**session 不是"增删改查的实体类"，是"只有增和查的聚合根"**：没有 update、没有 delete（append-only）——这正是它"永不删、可审计、可重建、fork 可复活"的根源。压缩时不能"改"旧消息，只能追加，这个限制恰恰是所有能力的来源。

---

## 九、一句话总结

> **session 是一个装东西的盒子：log 是盒子里永不清空的流水账（真相），surface 是盒子里根据流水账现算的"当前展示清单"（视图）；写东西进盒子走 log，看东西给模型走 surface；盒子可以整个搬进内存，账本还会被插件抄一份到磁盘（session log），重启后从磁盘把盒子重新搭起来——surface 不是存出来的，是按顺序重放 log 算出来的（全量一次 + 增量之后），顺序即状态。**

---

## 十、自检题

1. session / log / surface 是平级关系吗？各是什么？（提示：包含关系 / 真相 vs 视图）
2. 一条新消息从"用户输入"到"落盘"经过哪几步？（提示：append → 校验 → 内存 → 广播 → 插件写文件）
3. "写时只校验、读时才应用"是什么意思？为什么这么设计？（提示：fail-fast / lazy / 写路径零成本）
4. 电脑重启后，surface 的索引顺序从哪来？（提示：不存文件，全量重放）
5. 为什么恢复必须全量重放、不能只看最后一个 replace？（提示：多次压缩 / 表面位置依赖累积状态）
6. "start 可以大于 end"是什么意思？为什么不是 bug？（提示：两个坐标系 / 旧检查点高 seq 站老位置）
7. 压缩追加 4 条事件各是什么角色？少一条会怎样？（提示：锁 / 记账 / 替换 / 解锁）
8. 你们的 buildContext 和 DSH 的 deriveMessages 差在哪？（提示：全量回溯 vs 增量缓存）
9. 为什么 session 没有"删"和"改"？（提示：append-only 是一切能力的根源）
