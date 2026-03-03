# Meta-Agent Core 设计文档

> 非必要不复杂，追求简约。

---

## 核心信念

- **复杂性本身是成本。** 只有在简单方案明显不够用时，才引入复杂性。
- **原语必须是原子的。** 能被其他原语组合实现的，不是原语。
- **策略不是核心。** Mode 状态机、权限规则、快照时机是可替换的策略，通过 Hooks 注入。
- **质量信号总规则：所有 `confidence` 和 `uncertainty` 统一写入 Trace。**

---

## 五个信息对象

```
Trace        → 推理轨迹：思考、判断、confidence、uncertainty（为什么）
Terminal Log → 执行记录：命令原文、stdout、stderr、退出码、耗时（做了什么）
Memory       → 长期记忆：用户请求 + 解决结论，跨 Session 结构化存储
State        → 当前快照：目标、子目标、mode、权限、版本号（现在是什么状态）
Workspace    → 项目目录：外部世界的当前事实
```

Trace 和 Terminal Log 通过 `seq` 序号关联：Trace 的 `exec` 条目携带 `terminal_seq` 引用。

---

## 架构三层

```
核心层（接口冻结，永不修改）
├── 四个执行原语：read / write / edit / bash
├── LLMCall（Reason / Judge）
├── Trace + Terminal Log（双流追加写）
├── Collect 协议
└── 项目目录约定

编排层（框架稳定，策略可替换）
├── Loop 骨架（迭代结构 + 终止条件）
└── State 结构体（KV 容器）

策略层（通过 Hooks 注入，可有多套实现）
├── Mode 状态机
├── 权限状态机
├── Harness 快照策略
├── 错误分类策略
└── Interrupt 机制
```

上层应用（与 meta-core 平级，调用 meta-core 实现）：SmartCollect、Survey Agent 等。

---

## 核心层

### 1. 四个执行原语

接口永不修改：

| 原语 | 签名 | 职责 |
|------|------|------|
| read | `read(path) → content` | 读取文件 |
| write | `write(path, content)` | 创建或覆写文件 |
| edit | `edit(path, old, new)` | 精确局部替换，`old` 须唯一匹配 |
| bash | `bash(command) → output` | 执行系统命令 |

`write` 和 `edit` 执行前校验路径白名单，拒绝写入 Core 目录（文件系统权限双重保护）。Agent 合法写入区域仅限 Workspace 和 `.agent/`。

### 2. LLMCall

```
LLMCall(context, input) → { result, uncertainty{ score, reasons } }
```

两种模式：

- **Reason**：生成提案、制定计划。输出含 `riskApproved: boolean` 和可选 `riskReason`，由模型一并完成风险自评。如不确定，优先选副作用最小的行动。
- **Judge(type)**：收敛裁决，`type ∈ { outcome, milestone, capability }`。不确定性高时 Escalate，不执行。每次调用必须显式指定 type。

```typescript
// Reason 输出结构
type ReasonResult = {
  proposal: string;
  uncertainty: { score: number; reasons: string[] };
  riskApproved: boolean;
  riskReason?: string;
}
```

### 3. Trace + Terminal Log

```typescript
type TraceEntry = {
  ts: number;
  seq: number;
  kind: 'collect' | 'reason' | 'judge' | 'exec' | 'state' |
        'escalate' | 'stop' | 'interrupt' | 'narrative';
  data: unknown;
  confidence?: Confidence;
  uncertainty?: Uncertainty;
  riskApproved?: boolean;     // reason 条目使用
  riskReason?: string;
  judge_type?: string;        // judge 条目使用
  terminal_seq?: number;      // exec 条目关联 Terminal Log
  tags?: string[];
};

type TerminalEntry = {
  ts: number;
  seq: number;
  operation: 'llmcall' | 'collect' | 'read' | 'write' | 'edit' | 'bash';
  input?: string;
  output: string;
  command?: string;           // bash 专用
  exitCode?: number;          // bash 专用
  durationMs?: number;
  truncated?: boolean;
};
```

两者共享全局递增序号，均为追加写，跨 Session 累积，不清空。`narrative` 条目在 Mode 切换和 Milestone 时由轻量 LLMCall[Reason] 生成。

输出超过 `maxOutputLength`（默认 100KB）时自动截断并标记 `truncated: true`。

双格式输出：`trace.jsonl`（程序解析）、`terminal.md`（人类阅读，含操作图标和折叠块）。

### 4. 项目目录约定

```
{workDir}/
├── .agent/
│   ├── AGENT.md       # 静态上下文，注入每次 LLMCall 的 system prompt
│   ├── state.json     # State 快照，Session 恢复入口
│   ├── trace.jsonl
│   ├── terminal.md
│   ├── memory.jsonl
│   └── sessions/      # 每次运行摘要索引
└── [项目源代码]
```

`.agent/` 加入 `.gitignore`。启动时检测 `state.json` 是否存在，存在则恢复上次状态继续执行。

**AGENT.md 运行时配置（json 代码块）：**

```json
{
  "maxOutputLength": 102400,
  "strategies": {
    "level": "L1",
    "permissions": 2,
    "mode_fsm": "enabled",
    "permission_fsm": "enabled",
    "harness": "standard",
    "error_classifier": "enabled",
    "judge": {
      "outcome": "required",
      "milestone": "enabled",
      "capability": "enabled"
    }
  }
}
```

### 5. Memory 长期记忆

```typescript
type MemoryEntry = {
  ts: number;
  sessionId?: string;
  userRequest: string;
  solutionSummary: string;
  subgoals: Array<{ goal: string; summary: string; outcome: 'completed' | 'voided' }>;
}
```

State 记录"现在"（有界，随迭代覆写），Memory 记录"历史"（无界，只增不改）。检索接口：`search(query)` / `recent(n)`。

### 6. Collect 协议

```
Collect(sources, limits) → { rawContext, confidence{ coverage, reliability, gaps, by_source } }
```

Collect 是静态拉取协议，不是原语，不内置智能探索或 LLM 调用。按 sources 配置机械拉取，做基本 token 截断后返回。

**Source 类型：**

| 类型 | 说明 |
|------|------|
| file | 读取指定文件 |
| bash | 执行命令并获取输出 |
| trace_tag | 按标签过滤 Trace 历史 |
| skills | 从 `skills/{query}/SKILL.md` 加载技能文档 |

**confidence 判断：**

```
coverage 高 + reliability 高 → 继续 Plan
其余任意组合                 → Escalate
```

**SmartCollect（上层应用）**：需要智能探索时，用 runLoop 实现，goal 为「组装足够的 context」，maxIterations 建议 5。内部可自由使用 bash/read/grep 探索文件结构、统计 token 量、分 chunk 采样、摘要压缩。

### 7. Loop 骨架

```
每轮迭代：

[Interrupt 检查]
  有信号 → 快照，切 Paused，执行 onInterrupt 指令

[终止检查]
  iterationCount >= maxIterations  → Stop(budget_exceeded)
  noProgressCount >= maxNoProgress → Escalate
    ← noProgressCount 在 Review 自增；此处触发时 Recovery 已完成清理
  无 currentSubgoal 且 subgoals 为空 → Stop(goal_completed)

[Collect] → rawContext + confidence
  confidence 不足 → Escalate

[Plan]
  LLMCall[Reason] → { proposal, uncertainty, riskApproved }
  riskApproved === false 或 uncertainty 过高 → Escalate
  → 存入 state.pendingProposal，切 Execute

[Execute]
  shouldSnapshot? → Harness.snapshot()
    快照失败 → Escalate(reason: 'snapshot_failed')
    ← 拒绝在无法回滚的状态下执行有副作用的操作
  onBeforeExec → 'block' → Escalate
  executeToolCalls(state.pendingProposal) → state.lastExecResult
  切 Review

[Review]
  LLMCall[Judge(outcome)] → 达成 / 未达成
  达成  → 归档子目标，noProgressCount = 0，切 Plan 或准备 Stop
  未达成 → noProgressCount++，切 Recovery
    ← 不在此处立即 Escalate；先让 Recovery 回滚环境，下轮开头终止条件触发

[Recovery]
  classifyError → retryable → recovery→plan，不回滚
  否则 → Harness.rollback()，清空 pendingProposal，recovery→plan
    ← recovery→plan 不代表一定执行 Plan；
       若 noProgressCount 已达上限，下轮开头会被 Escalate 拦截

[每轮结尾] StateManager.save(state)

[Paused 分支]
  正常不应到达（Interrupt 检查阶段已处理完毕）
  → throw Error('Illegal state: reached paused branch')
```

### 8. State 结构体

```typescript
type AgentState = {
  goal: string;
  subgoals: string[];
  currentSubgoal: string | null;
  archivedSubgoals: Array<{
    goal: string;
    summary: string;
    outcome: 'completed' | 'voided';
  }>;
  pendingProposal?: string;   // Plan 产出，Execute 消费，Review 后清空
  mode: 'plan' | 'execute' | 'review' | 'recovery' | 'paused';
  permissions: 0 | 1 | 2 | 3 | 4;
  iterationCount: number;
  noProgressCount: number;
  version: number;
  custom: Record<string, unknown>;
};
```

---

## Hooks 接口

```typescript
type LoopHooks = {
  onBeforeExec?:     (state, proposal) => Promise<'proceed' | 'block'>
  onAfterObserve?:   (state, result)   => Promise<'continue' | 'recover' | 'escalate'>
  onModeTransition?: (from, to)        => Promise<void>
  shouldSnapshot?:   (state)           => Promise<boolean>
  classifyError?:    (error)           => 'retryable' | 'logic' | 'environment' | 'budget'
  onInterrupt?:      (signal)          => Promise<UserDirective>
}
```

---

## 策略层

### Mode 状态机

```
Plan      → Execute    riskApproved && 权限满足
Execute   → Review     当前批次完成
Review    → Plan       目标达成且仍有子目标，或需重新规划
Review    → Recovery   未达成
Recovery  → Plan       回滚完成
任意      → Paused     Interrupt 到达（迭代边界触发）
Paused    → Plan       用户继续或修改目标
Paused    → Stop       用户终止
```

### 权限状态机

| 级别 | 允许操作 |
|------|---------|
| 0 只读 | read |
| 1 受控写 | write / edit（限工作区） |
| 2 受控执行 | bash（常规，无网络/删除） |
| 3 高风险执行 | bash（网络、删除、系统级变更） |
| 4 自主模式 | 预授权范围内自动执行 |

升级需显式申请，不隐式提升。Level 4 的不可逆操作仍经 `onBeforeExec` 二次确认。

### 错误分类

```
retryable   → 网络超时、文件锁    → 直接重试，不进 Recovery，不回滚
logic       → 方案本身有问题      → Recovery + 回滚 + 重新 Plan
environment → 依赖缺失、权限不足  → Escalate，人工介入
budget      → 超出预算            → Stop
```

### Milestone 快照

`shouldSnapshot` 调用 `LLMCall[Judge(milestone)]`，判断：功能是否完整、回滚是否有意义、与上次快照是否有实质变更。通过时执行 `bash git commit`。

---

## 由原语组合实现的能力

```
版本快照     = bash git commit（Milestone 触发）
版本回退     = bash git checkout（Recovery 触发）
代码搜索     = bash ripgrep
上下文压缩   = LLMCall[Reason]（摘要）+ write
SmartCollect = runLoop（goal=组装context）+ bash/read/grep
多 Agent 协作 = 共享 Workspace + trace_tag 区分来源（无需消息队列）
```

---

## 永远不要做的事

- **修改四个原语的接口签名。**
- **让原语写入 Core 目录。**
- **在 Collect 内部调用 LLM**，或把 Collect 当原语。
- **只维护 Trace，不维护 State**：从日志反推状态既低效又不稳。
- **不定义终止条件**："停不下来"是 agent 系统最常见的故障。
- **在 Loop 骨架里内置策略逻辑**：策略通过 Hooks 注入。
- **让 Judge 承担模糊职责**：每次调用必须显式指定 type。
- **把所有错误都走 Recovery**：retryable 直接重试，不回滚。
- **git 管理 `.agent/` 目录**：日志不需要版本管理。
- **在循环中途打断 LLMCall**：Interrupt 只在迭代边界触发。

---

## 一句话总结

> Collect 组装可信 context，LLMCall[Reason] 产出提案与风险评估，执行后 Judge(outcome) 收敛，Recovery 保证环境干净再 Escalate——推理写 Trace，执行写 Terminal Log，策略通过 Hooks 注入，用户在任意迭代边界打断介入。
