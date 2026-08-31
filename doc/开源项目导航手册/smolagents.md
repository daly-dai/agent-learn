# smolagents —— 轻量 Python 对照

> [返回索引](index.md)

- **定位**：HuggingFace 的 Python 轻量 agent 框架。学"工具/多步/代码执行"的另一种取舍。
- **组织哲学**：一文件一能力，`src/smolagents/` 下文件名即功能名。

## 功能 → 位置映射（按 ETCLOVG 七层）

| 层 | 功能 | 位置 | 已读 |
|---|---|---|---|
| **L** 生命周期 | agent 循环（多步推理） | `agents.py` + `agent_types.py` | 未精读 |
| **E** 执行 | 代码执行器（本地/远程） | `local_python_executor.py` + `remote_executors.py` | 未精读 |
| **T** 工具 | 工具系统 + 默认工具 + 校验 | `tools.py` + `default_tools.py` + `tool_validation.py` | ✅ 走读 19（web tools 对照） |
| **T** 工具 | MCP 客户端 | `mcp_client.py` | 未精读 |
| **C** 上下文 | 记忆 | `memory.py` | 未精读 |
| **O** 可观测 | 监控（token 统计/步骤追踪） | `monitoring.py` | 未精读 |
| **V** 验证 | 测试 | 仓库根 `tests/` | 未精读 |
| 附加 | 模型接入 | `models.py` | 未精读 |

- **搜索**：`src/smolagents/` 下文件名即功能名。
- **已读**：✅ 走读 19（web tools 对照）。
