# change.md — 整合修改建议

> 来源：本次讨论的三个议题——策略层配置化  
> 原则：非必要不复杂，只修真正有问题的地方

---

## AGENT.md 增加更多配置（可选注入，替代 SDK 写死）

**问题**：当前策略层（Mode 状态机、权限状态机、Judge 各 type、Harness 等）通过 `LoopHooks` 在代码层注入，不同 Agent 实例（survey_agent、coding_agent 等）的行为差异无法在配置文件层表达，必须改代码。

**修改内容**：在 AGENT.md 增加 `strategies` 配置块，SDK 读取后动态组装 Hooks，本体不写死任何策略默认值：

```yaml
# AGENT.md — 策略层配置
strategies:
  level: L1                      # 基础策略包，决定默认启用范围

  mode_fsm: enabled              # Mode 状态机（Plan/Execute/Review/Recovery/Paused）
  permission_fsm: enabled        # 权限状态机（Level 0-4）

  harness: standard              # 快照策略：standard | aggressive | disabled

  error_classifier: enabled      # 错误分类（retryable / logic / environment / budget）

  judge:
    outcome:    required         # Loop 终止收敛，不可关闭（可降级为 rule_based）
    risk:       enabled          # 高权限操作门卫
    milestone:  enabled          # git commit 时机
    capability: enabled          # 启动时能力边界声明
    selection:  disabled         # 多候选仲裁，单候选场景不需要
```

**说明**：
- `judge.outcome` 是唯一不建议 `disabled` 的项，降级选项是 `rule_based`（规则匹配替代 LLMCall）
- `level: L0` 时所有策略项默认 `disabled`，仅运行核心层 + 编排层骨架
- 此字段提交到 git，团队共享，与现有 `maxOutputLength` 并列

---

其它meta-agent-core里面可被用户自定义配置的组件、参数，都写在AGENT.md里面, 配置内容写在md里面的```json 包裹的字段中
