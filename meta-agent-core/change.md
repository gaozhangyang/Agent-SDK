# change.md — 整合修改建议

> 来源：本次讨论的三个议题——terminal.log 可读性、trace.jsonl 不完备、策略层配置化  
> 原则：非必要不复杂，只修真正有问题的地方

---

## 修改一：trace.jsonl 补齐字段

**问题**：当前 trace.jsonl 存在三处不完备：
1. `read` 等原子操作缺少 `kind` 字段，与文档定义的 `TraceEntry` 不符
2. 检查`LLMCall`,`Collect`,以及四个原子操作的的完整输入输出有没有被记录
3. `uncertainty` 字段从未出现，质量追踪链断裂
4. 总言之, trace.jsonl一定要记录agent的完整思考、运行轨迹

**修改内容**：

所有 TraceEntry 必须包含 `kind` 字段，补齐如下：

```jsonl
// 原子操作（read / write / edit / bash）统一补 kind
{"seq":1,"ts":...,"kind":"exec","operation":"read","input":"...","output":"...","durationMs":1,"truncated":false}

// LLMCall 补完整记录
{"seq":5,"ts":...,"kind":"reason","input":"<完整 context + instruction>","output":"<模型响应原文，含 TOOL_CALL 块>","uncertainty":{"score":0.3,"reasons":["PDF 正文未提取，仅依赖元数据"]},"durationMs":8358}

// Judge 调用同理，附加 judge_type
{"seq":8,"ts":...,"kind":"judge","judge_type":"outcome","input":"...","output":"...","uncertainty":{"score":0.1,"reasons":[]},"durationMs":...}

// collect 补 seq 统一（见修改二）
{"seq":4,"ts":...,"kind":"collect","data":{...},"confidence":{...}}
```

---

## 修改二：统一 seq 序号空间，打通 terminal.log 与 trace.jsonl 的交叉引用

**问题**：当前两个文件各自维护独立序号（trace.jsonl 中 read 的 seq 和 collect 的 seq 均为 1），无法互相引用。文档设计了 `terminal_seq` 字段但实际未落地。

**修改内容**：

两个文件共享同一个全局递增序号，由 Agent Core 统一分配，写入时同步：

```
terminal.log 每条记录：seq 来自全局序号
trace.jsonl  每条记录：seq 来自全局序号，exec 类 kind 附加 terminal_seq 指向对应 terminal.log 条目
```

terminal.log 截断时，在截断标记后补一行引用：

```
[WARNING: truncated — full output at trace.jsonl#seq:3]
```

这样 terminal.log 是人类可读的摘要视图，trace.jsonl 是完整档案，两者通过 seq 双向可达。

---

## 修改三：terminal.log 格式优化（人类可读性）

**问题**：原始 terminal.log 格式信息密度高但视觉噪音大，路径过长、截断无引用、操作类型不直观。

**修改内容**：采用 `.md` 扩展名（`terminal.md`），保持追加写语义不变，改进如下：

- **路径别名**：在 Session 头部声明 `$SA = /长路径/...`，后续记录全部使用别名
- **操作图标**：📖 read · ✏️ write · 🔧 edit · 💻 bash · 🔍 collect · 🤖 llmcall，操作类型一眼可辨
- **折叠块**：用 `<details>` 收纳 input/output 正文，主时间线只显示 seq、时间戳、操作类型、关键路径
- **截断引用**：截断时补 `→ full output at trace.jsonl#seq:N`（依赖修改二的统一 seq）
- **耗时标注**：LLMCall 显示实际耗时（如 `8358ms`），原子操作 durationMs 为 0 时省略

格式示意：

```markdown
## `seq:005` · `00:17:07` · 🤖 llmcall [Reason] · 8358ms

| input  | 注入 3 源上下文，分析论文 2602.24289 |
| output | 生成提案 + TOOL_CALL(bash) |
| uncertainty | score: 0.3 · PDF 正文未提取 |

<details><summary>完整 input / output</summary>...</details>
```

---

## 修改四：AGENT.md 增加策略层配置（可选注入，替代 SDK 写死）

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

## 变更影响范围小结

| 修改 | 影响范围 | 是否破坏现有接口 |
|------|---------|----------------|
| 一：trace.jsonl 补字段 | trace 写入逻辑 | 否（追加字段，向前兼容） |
| 二：统一 seq + 截断引用 | Agent Core seq 分配器、terminal 写入 | 否（seq 逻辑调整，不改接口签名） |
| 三：terminal.md 格式 | 日志渲染层 | 否（格式变更，内容语义不变） |
| 四：AGENT.md strategies | SDK 启动读取逻辑、Hooks 组装 | 否（新增配置项，无配置时沿用现有行为） |
