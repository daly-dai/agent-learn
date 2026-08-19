# Agent Notes

Agent Loop = context -> model -> tools -> toolResult -> next turn.

核心概念：
- ReAct 循环：Reasoning + Acting
- 工具是可选的——模型可以决定直接回答
- 每条工具结果都加入上下文，成为模型的"短期记忆"
