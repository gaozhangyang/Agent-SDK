```
Phase 0+1  完整核心
  四原语 + 完整Loop骨架（含Review/Recovery占位）
  Trace + Terminal Log 双流（含 narrative 双写）
  两级检索架构（terminal.md一级，Trace二级，trace_ref双向索引）
  Judge(outcome) + 错误分类 + Recovery
  Hooks 骨架定义（空实现，含 collect hook）
  StaticCollect（支持 degraded 模式）
  State provenance（_src 指向 terminal.md 条目）
  Session 链（sessionId + parentSessionId）
  Boot sequence 占位

Phase 2  控制与策略
  权限状态机 0-4
  Hooks 全部实装（onBeforeExec / onAfterObserve / onModeTransition）
  shouldSnapshot → Judge(milestone) → git commit
  Interrupt 机制（迭代边界触发，Paused 状态）
  Boot sequence 实装（工具自检，最低权限验证）
  AGENT.md 运行时配置激活（strategies 字段真正生效）

Phase 3  记忆层
  Memory 写入（Session 结束时提炼，附 reliability + task_type 字段）
  Memory 检索（search / recent，reliability 降权）
  SmartCollect（独立 maxIterations 配额，onBudgetExceeded 可配置）
  Collect Hook 替换为 SmartCollect
  Judge(capability) 激活
  Collect 的 trace_narrative source 类型激活

Phase 4  自我感知
  PMU（metrics.jsonl，按 task_type 分桶）
  optimization_report.md（人工审核）
  learned_patterns（人工写回 AGENT.md）

Phase 5  多Agent
  bus.jsonl（写操作广播，Lamport timestamp）
  路径级 MMU（私有区域 + 共享区域）
  trace_tag 升级为因果链标记
  跨 Agent Memory 汇聚