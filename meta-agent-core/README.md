# Agent 设计原则

> 非必要不复杂，追求简约。模块化设计，可插拔策略。按智能水平分级，层次边界清晰。

---

## 根本原则

- **复杂性本身是成本。** 只有简单方案明显不够用时，才引入复杂性。
- **原语必须是原子的。** 能被其他原语组合实现的，不是原语。
- **策略不是核心。** 所有策略通过 Hooks 注入，核心层不感知。
- **概率性输出需要确定性外壳。** LLM 的不确定性封闭在 LLMCall 内部，架构其余部分保持可预期。
- **质量信号总规则：所有 confidence 和 uncertainty 统一写入 Trace。**

---

## 存储层次与记忆类型

```
寄存器  context window    → 即时推理工作台，一次 LLMCall 的生命周期
Cache   State             → 语义记忆，当前 Session 的信念与目标
RAM     terminal.md       → 工作记忆，当前 Session 的执行流水账
磁盘    Workspace + Trace → 情节记忆，跨 Session 的持久事实
```

**两级检索：**
- terminal.md 是一级，结构简短，同时服务程序检索和人类阅读。回答「做了什么、结果如何」，含 narrative 语义锚点（📍）
- Trace 是二级，信息完整但量大，按需下钻。回答「为什么、置信度多少」
- 两者通过 seq 双向关联，信息不足时从一级跳转二级

---

## 架构四层

```
核心层     接口冻结，永不修改
编排层     Loop 骨架与 State，框架稳定，策略可替换
策略层     六个 Hook，通过注入实现可插拔
上层应用   调用核心层实现，与 meta-core 平级
```

**核心原则：核心层接口一旦确定永不修改；所有上层能力由原语组合实现。**

---

## Loop 设计思想

Loop 是 Agent 的心跳。每一轮迭代回答三个问题：

1. **我现在知道什么？** → 由 LLMCall 的置信度决定是否触发 Collect 补充信息
2. **我应该做什么？** → Plan 产出 proposal，含风险自评与权限声明
3. **我做得对吗？** → Judge 裁决，达成则前进，未达成则 Recovery 清理后重试

Collect 不是每轮必跑的固定步骤，而是被 LLMCall 的低置信度**主动触发**。Recovery 的职责是给下一轮或接手的人留下**干净、可预期的工作空间**，而不是抹除失败历史。

---

## 分级实现路线

智能水平随级别递增，每级纯增量扩展，不改核心层接口。

**L1 · 完整可运行核心**
能跑、能停、能自愈、留完整痕迹。包含全部核心层、编排层、Hooks 骨架、两级检索、StaticCollect。

**L2 · 可控可中断**
人可随时介入，策略可替换，Agent 不越权。新增权限状态机、Interrupt 机制、Hooks 全部实装、AGENT.md 配置激活。

**L3 · 记忆与复用**
从历史学习，同类任务越做越快。新增 Memory、SmartCollect、Judge(capability)。

**L4 · 自我感知**
感知自身弱点，产出优化建议供人审核。新增 PMU、optimization_report。
Agent 不自动修改 AGENT.md——产出证据，人做决策，决策喂回 Agent。

**L5 · 多 Agent 协作**
多个 Agent 并发工作，共享世界，因果有序。新增总线、逻辑时钟、路径级权限隔离。

---

## 永远不要做的事

- 修改四个原语的接口签名
- 不定义终止条件（「停不下来」是 Agent 系统最常见的故障）
- 在 Loop 骨架里内置策略逻辑（策略通过 Hooks 注入）
- 让 Judge 承担模糊职责（每次调用必须显式指定 type）
- 把所有错误都走 Recovery（retryable 直接重试，不回滚）
- 让 Agent 自动写回 AGENT.md（优化建议必须经人工审核）
- 在循环中途打断 LLMCall（Interrupt 只在迭代边界触发）
- 新 Session 覆盖旧 Session（崩溃重启是续接，不是重置）

---

## 一句话总结

> LLMCall 主动触发 Collect 补充信息，Reason 产出含风险自评的 proposal，Execute 后 Judge(outcome) 收敛，Recovery 清理现场保证工作空间干净——推理写 Trace，执行写 Terminal Log，narrative 双写为语义锚点，策略通过六个 Hook 注入，用户在任意迭代边界介入，系统随级别从「能跑」进化到「能学」。


# Agent 工程规范

---

## 信息对象

| 对象 | 职责 | 格式 |
|---|---|---|
| Trace | 推理轨迹：思考、判断、confidence、uncertainty | `.jsonl`，程序检索 |
| Terminal Log | 执行记录：命令、输出、退出码、耗时 | `.md`，一级检索 + 人类阅读 |
| Memory | 长期记忆：请求 + 结论，跨 Session 存储 | `.jsonl` |
| State | 当前快照：目标、mode、权限、版本号 | `state.json` |
| Workspace | 项目目录：外部世界的当前事实 | 文件系统 |

---

## 核心层

### 四个执行原语（接口永不修改）

| 原语 | 签名 | 职责 |
|---|---|---|
| read | `read(path) → content` | 读取文件 |
| write | `write(path, content)` | 创建或覆写文件 |
| edit | `edit(path, old, new)` | 精确局部替换，`old` 须唯一匹配 |
| bash | `bash(command) → output` | 执行系统命令 |
| noop | `noop() → `[Noop] | 空操作，当没有工具需要执行时使用 |

合法写入区域仅限 Workspace 和 `.agent/`，其余路径白名单拒绝。git 为必要前置依赖，Boot 阶段检测不可用时直接 fail。

### LLMCall

```
LLMCall(context, input) → { result, uncertainty{ score, reasons } }
```

- **Reason**：产出 proposal，含 `riskApproved: boolean`、`riskReason?`、`proposalValid: boolean`、`uncertainty`。模型在 system prompt 约束下同时完成风险自评与权限校验。**只输出 JSON，不输出工具调用**。
- **Execute**：根据 Reason 阶段的 proposal 生成工具调用。**只输出 `<invoke>` 格式的工具调用，禁止输出 JSON 或自然语言**。如果无操作可执行，输出 `<invoke name="Noop"></invoke>`。
- **Judge(type)**：收敛裁决，`type ∈ { outcome, milestone, capability }`。uncertainty 高时 Escalate。每次调用必须显式指定 type。

**AGENT.md section 过滤：** 按调用类型只注入相关 section，不全量注入。

```
# [all]            基础上下文
# [reason]         策略与风险偏好
# [judge:outcome]  验收标准
# [judge:milestone] 里程碑判断标准
# [judge:capability] 能力边界
# [learned_patterns] 历史提炼的策略参数（人工写入，Agent 只读）
```

**ContextBudget：** 每次 LLMCall 前检查 token 预算。超出时压缩 rawContext（优先保留 narrative），不静默截断。

### Trace + Terminal Log

```typescript
type TraceEntry = {
  ts: number; seq: number;
  kind: 'collect' | 'reason' | 'judge' | 'exec' | 'execute' | 'execute_retry' | 'state' |
        'escalate' | 'stop' | 'interrupt' | 'narrative';
  data: unknown;
  confidence?: Confidence;
  uncertainty?: Uncertainty;
  riskApproved?: boolean;
  judge_type?: string;
  terminal_seq?: number;   // exec 条目关联 Terminal Log
  tags?: string[];
};

type TerminalEntry = {
  ts: number; seq: number;
  operation: 'llmcall' | 'collect' | 'read' | 'write' | 'edit' | 'bash';
  input?: string; output: string;
  command?: string; exitCode?: number;
  durationMs?: number; truncated?: boolean;
  trace_ref?: number;      // 关联 Trace seq，两级检索跳转用
};
```

两者共享全局递增 seq，均为追加写，跨 Session 累积，不清空。输出超过 `maxOutputLength`（默认 100KB）时截断并标记 `truncated: true`。

**narrative 双写：** Mode 切换和 Milestone 时由轻量 LLMCall[Reason] 生成，同时追加到 Trace（`kind: 'narrative'`）和 terminal.md（📍 图标）。内容一致，是同一次生成的两个投影。terminal.md 作为一级检索入口，narrative 条目是跨迭代的语义锚点，SmartCollect 优先命中；Trace 作为二级，按需下钻获取完整推理细节。

**Tag 命名空间（L1 起强制）：**
```
type:{task_type}    PMU 分桶
agent:{agentId}     多 Agent 因果链
milestone:{name}    Milestone 标记
goal:{goalId}       子目标追踪
```

### 项目目录约定

```
{workDir}/
├── .agent/
│   ├── AGENT.md        # 静态上下文 + 运行时配置
│   ├── state.json      # State 快照
│   ├── trace.jsonl
│   ├── terminal.md
│   ├── memory.jsonl
│   ├── metrics.jsonl   # PMU（L4 启用）
│   ├── backups/        # 危险操作备份 {seq}_{filename}
│   └── sessions/       # 每次运行摘要索引
└── [项目源代码]
```

`.agent/` 加入 `.gitignore`。

**AGENT.md 运行时配置：**

```json
{
  "maxOutputLength": 102400,
  "contextBudget": { "total": 200000, "reservedSystemPrompt": 10000, "reservedOutput": 4000 },
  "smartCollect": { "maxIterations": 5, "maxTokenBudget": 40000, "onBudgetExceeded": "degrade" },
  "strategies": {
    "level": "L1",
    "permissions": 2,
    "judge": { "outcome": "required", "milestone": "enabled", "capability": "enabled" }
  }
}
```

---

## 编排层

### Loop 骨架

```
[Boot]
  git 可用性检测 → 不可用则 fail
  读取 environmentCapabilities
  读取 state.json
    不存在              → 初始化新 Session
    mode === 'paused'   → 执行 onInterrupt，切 Plan 或 Stop，进 Loop
    otherwise           → 续接 Session 链，进 Loop

每轮迭代：

[Interrupt 检查]
  收到信号 → 快照 State，切 Paused，执行 onInterrupt → 继续或 Stop

[终止检查]
  iterationCount ≥ maxIterations          → Stop(budget_exceeded)
  noProgressCount ≥ maxNoProgress         → Escalate
  subgoals 清空                           → Judge(outcome)[整体目标]
    达成   → Stop(goal_completed)
    未达成 → 回 Plan，补充子目标

[Plan]
  ContextBudget.check()
  LLMCall[Reason] → { proposal, uncertainty, riskApproved, proposalValid }
  uncertainty 过高                        → 触发 Collect，重新 Plan
  riskApproved = false                    → Escalate
  proposalValid = false                   → 重新 Plan（计入重试次数，超限则 Escalate）
  通过                                    → 存入 pendingProposal，切 Execute

[Execute]
  LLMCall[Execute] → 生成工具调用
    检测到无工具调用 → 重新生成（带纠正提示）
  shouldSnapshot?  → git commit（失败 → Escalate: snapshot_failed）
  onBeforeExec(state, proposal)           → 'proceed' | 'block'
    危险操作 + 置信度低 → 备份到 backups/，写 Trace ⚠️
    'block'            → Escalate
  执行所有 tool calls  → lastExecResult
  切 Review

[Review]
  buildEvidenceBundle(state, lastExecResult) → evidenceBundle
  ContextBudget.check()
  Judge(outcome)(evidenceBundle)          → 达成 | 未达成
  达成   → 归档子目标，noProgressCount = 0，切 Plan
  未达成 → 切 Recovery

[Recovery]
  classifyError(error) →
    retryable   → 直接重试，noProgressCount 不变
    logic       → 重置当前子目标字段，contextStale = true，noProgressCount 不变
                  ← 留失败现场，给下一轮干净的起点
                  ← 若下轮 Plan 再次失败，Review 触发时 noProgressCount++
    environment → Escalate
    budget      → Stop

[每轮结尾]
  StateManager.save(state)

[Paused 分支]
  不应到达 → throw Error('Illegal state: reached paused branch')

[Stop]
  Stop(goal_completed) 时提炼 Memory
  → 返回 LoopResult
```

**Collect 触发规则：** Plan 阶段 LLMCall 返回 uncertainty 过高时主动触发，不是每轮固定执行。触发后由 hooks.collect() 实现，完成后重新 Plan。

**noProgressCount 语义：** 度量「无效迭代次数」。Recovery 后给一次重新 Plan 的机会，该次 Plan 仍失败才自增。

### LoopResult

```typescript
type LoopResult = {
  outcome: 'completed' | 'escalated' | 'interrupted' | 'budget_exceeded';
  finalState: AgentState;
  terminalSeq: number;
  escalationReason?: string;
  humanActionRequired?: string;
};
```

### State 结构体

```typescript
type AgentState = {
  sessionId: string;
  parentSessionId?: string;

  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  currentSubgoal_src: string;      // "T#N"：子目标来源 + 开始时的 seq（崩溃续接用）
  archivedSubgoals: Array<{
    goal: string; summary: string;
    outcome: 'completed' | 'voided';
  }>;

  pendingProposal?: string;
  completedToolCalls: string[];    // 当前子目标已完成的 tool calls，崩溃续接用
  lastExecResult?: string;
  mode: 'plan' | 'execute' | 'review' | 'recovery' | 'paused';

  permissions: 0 | 1 | 2 | 3 | 4;
  iterationCount: number;
  noProgressCount: number;
  version: number;

  environmentCapabilities: {
    networkAvailable: boolean;
    writePermission: boolean;
    availableTools: string[];
  };

  custom: Record<string, unknown>;
};
```

**Provenance 规则：** LLMCall 产出或 Judge 裁决修改的字段，附 `_src: "T#N"` 指向 terminal.md 条目。Recovery 只重置 `_src > checkpoint_seq` 的字段。

---

## Hooks 接口（策略层）

```typescript
type LoopHooks = {
  collect: CollectFn;
  buildEvidenceBundle: EvidenceBundleFn;
  onBeforeExec:   (state, proposal) => Promise<'proceed' | 'block'>;
  shouldSnapshot: (state) => Promise<boolean>;
  classifyError:  (error: ClassifiableError) => ErrorClass;
  onInterrupt:    (signal) => Promise<UserDirective>;
};

type ClassifiableError =
  | { kind: 'execution'; error: Error; terminalSeq: number }
  | { kind: 'semantic';  judgeResult: JudgeResult; subgoal: string };

type ErrorClass = 'retryable' | 'logic' | 'environment' | 'budget';
```

### Collect 策略

```typescript
type CollectFn = (sources: Source[], limits: Limits) => Promise<{
  rawContext: string;
  confidence: Confidence;
  mode: 'normal' | 'degraded';
}>;
```

**StaticCollect（L1 默认）：** 机械拉取。Source 类型：`file` / `bash` / `trace_tag` / `trace_narrative` / `skills` / `memory`。confidence 不足时返回 `degraded`，不 Escalate。

**SmartCollect（L3 替换）：** 内部跑独立 Loop，独立预算（不消耗外层 iterationCount）。维护单次调用生命周期的 working set（不持久化）：

```typescript
type WorkingSet = {
  pulledSources: Array<{ sourceId: string; pulledAt: number; summaryHash: string }>;
  rollbackUsed: boolean;   // 每次调用只允许一次回溯
};
```

增量逻辑：新 source 直接拉；已拉 source 比对 hash，有变化才重拉；置信度极低且未用过回溯时，走两级索引回溯一次，之后不再回溯。

### Mode 状态机

```
Plan      → Execute    proposalValid && riskApproved && 权限满足
Execute   → Review     tool calls 执行完毕
Review    → Plan       Judge 达成
Review    → Recovery   Judge 未达成
Recovery  → Plan       清理完毕
任意      → Paused     Interrupt（迭代边界）
Paused    → Plan/Stop  onInterrupt 指令
```

### 权限状态机

| 级别 | 允许操作 |
|---|---|
| 0 只读 | read |
| 1 受控写 | write / edit（限工作区）|
| 2 受控执行 | bash（无网络 / 删除）|
| 3 高风险 | bash（网络、删除、系统级）|
| 4 自主 | 预授权范围内自动执行 |

升级需显式申请，不隐式提升。Level 4 不可逆操作仍经 `onBeforeExec` 二次确认。

### 错误分类

```
retryable   → 网络超时、文件锁    → 直接重试
logic       → 方案有问题          → 重置子目标字段，保留失败现场
environment → 依赖缺失、权限不足  → Escalate
budget      → 超出预算            → Stop
```

---

## Memory

```typescript
type MemoryEntry = {
  ts: number;
  sessionId: string; parentSessionId?: string;
  task_type: string;          // PMU 分桶依据
  userRequest: string;
  solutionSummary: string;
  reliability: number;        // 0-1，由本 Session Judge 翻转率推算
  subgoals: Array<{ goal: string; summary: string; outcome: 'completed' | 'voided' }>;
};
```

写入时机：`Stop(goal_completed)` 时提炼，崩溃续接不提炼。检索时 reliability 低的条目降权，不排除。接口：`search(query)` / `recent(n)`。

---

## 由原语组合实现的能力

```
版本快照      = bash git commit        （shouldSnapshot 触发）
版本回退      = bash git checkout      （Recovery logic 触发）
危险操作备份  = write .agent/backups/  （onBeforeExec 触发）
代码搜索      = bash ripgrep
上下文压缩    = LLMCall[Reason] + write
SmartCollect  = 独立 Loop + bash/read/grep + working set
多 Agent 协作 = 共享 Workspace + bus.jsonl + trace_tag 因果链
```