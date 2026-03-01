# 参考文献摘要 2：Agent 设计原则

- **主题**：Coding Agent 的分层设计原则
- **要点**：原语（read/write/edit/bash）与 LLMCall（Reason/Judge）分离；Collect 为编排协议；终止条件为一等概念；Mode 状态机（Plan/Execute/Review/Recovery）。
- **方法**：质量信号写入 Trace，权限与 Mode 显式切换。
